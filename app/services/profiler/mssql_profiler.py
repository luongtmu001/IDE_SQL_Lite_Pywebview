# -*- coding: utf-8 -*-
"""
SQL Server Trace Profiler implementation using Extended Events (package0.ring_buffer).
Complies with specs in .SKILL/profiler.md:
- Target: package0.ring_buffer (16MB-32MB on RAM)
- Server-side filter: client_app_name <> 'luoBTool_Profiler'
- Deduplication via hash keys in circular set
- Clean teardown: DROP EVENT SESSION ON SERVER
"""

import collections
import datetime
import logging
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional

from .base import BaseProfilerSession

logger = logging.getLogger("luobtool.profiler.mssql")


class MssqlProfilerSession(BaseProfilerSession):
    def __init__(
        self,
        session_id: str,
        conn_config: Dict[str, Any],
        xe_session_name: Optional[str] = None,
        **kwargs,
    ):
        super().__init__(session_id, conn_config, **kwargs)
        self.xe_session_name = xe_session_name or f"luoBTool_XE_{session_id.replace('-', '_')}"
        self._raw_conn = None
        self._seen_keys = collections.deque(maxlen=15000)
        self._seen_set = set()

    def _create_connection(self):
        """Creates an independent dedicated connection for the profiler session with specific APP name."""
        from app.database.sqlserver import SqlServerAdapter

        cfg = dict(self.conn_config)
        # Force APP name so server-side filter suppresses own queries
        cfg["app_name"] = "luoBTool_Profiler"

        adapter = SqlServerAdapter(cfg)
        adapter.connect()
        return adapter.connection

    def _init_session(self):
        """Creates and starts the Extended Events session on SQL Server."""
        self._raw_conn = self._create_connection()
        cursor = self._raw_conn.cursor()

        # 1. Clean up old orphaned session with the same name if exists
        check_and_drop_sql = f"""
        IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'{self.xe_session_name}')
        BEGIN
            DROP EVENT SESSION [{self.xe_session_name}] ON SERVER;
        END;
        """
        try:
            cursor.execute(check_and_drop_sql)
        except Exception as e:
            logger.warning("Could not pre-drop existing XE session: %s", e)

        # 2. Create the Extended Events session with ring_buffer target
        create_xe_sql = f"""
        CREATE EVENT SESSION [{self.xe_session_name}] ON SERVER
        ADD EVENT sqlserver.sql_statement_completed(
            ACTION(sqlserver.session_id, sqlserver.database_name, sqlserver.client_app_name)
            WHERE ([sqlserver].[client_app_name] <> N'luoBTool_Profiler')
        ),
        ADD EVENT sqlserver.rpc_completed(
            ACTION(sqlserver.session_id, sqlserver.database_name, sqlserver.client_app_name)
            WHERE ([sqlserver].[client_app_name] <> N'luoBTool_Profiler')
        ),
        ADD EVENT sqlserver.sp_statement_completed(
            ACTION(sqlserver.session_id, sqlserver.database_name, sqlserver.client_app_name)
            WHERE ([sqlserver].[client_app_name] <> N'luoBTool_Profiler')
        )
        ADD TARGET package0.ring_buffer(SET max_memory=(16384))
        WITH (
            MAX_DISPATCH_LATENCY = 1 SECONDS,
            TRACK_CAUSALITY = ON,
            STARTUP_STATE = OFF
        );
        """
        cursor.execute(create_xe_sql)

        # 3. Start the session
        start_xe_sql = f"ALTER EVENT SESSION [{self.xe_session_name}] ON SERVER STATE = START;"
        cursor.execute(start_xe_sql)
        cursor.close()
        logger.info("SQL Server Extended Events session '%s' started", self.xe_session_name)

    def _collector_loop(self):
        """Reads ring buffer XML periodically, parses events, and pushes to queue."""
        query_ring_buffer_sql = f"""
        SELECT CAST(xst.target_data AS NVARCHAR(MAX)) AS target_data
        FROM sys.dm_xe_session_targets xst
        JOIN sys.dm_xe_sessions xs ON xs.address = xst.event_session_address
        WHERE xs.name = N'{self.xe_session_name}' AND xst.target_name = 'ring_buffer';
        """

        while self.is_running:
            try:
                if not self._raw_conn:
                    break

                cursor = self._raw_conn.cursor()
                cursor.execute(query_ring_buffer_sql)
                row = cursor.fetchone()
                cursor.close()

                if row and row[0]:
                    xml_str = row[0]
                    self._parse_ring_buffer_xml(xml_str)

            except Exception as e:
                if self.is_running:
                    logger.warning("Error querying XE ring buffer: %s", e)
                time.sleep(0.5)

            time.sleep(0.25)

    def _parse_ring_buffer_xml(self, xml_str: str):
        """Parses ring buffer XML and deduplicates events."""
        try:
            root = ET.fromstring(xml_str)
        except Exception as e:
            logger.debug("XML parse error in ring buffer: %s", e)
            return

        for ev in root.findall("event"):
            try:
                name = ev.attrib.get("name", "unknown")
                timestamp_str = ev.attrib.get("timestamp", "")

                actions = {}
                for action in ev.findall("action"):
                    a_name = action.attrib.get("name")
                    val_el = action.find("value")
                    actions[a_name] = val_el.text if val_el is not None else ""

                data = {}
                for d in ev.findall("data"):
                    d_name = d.attrib.get("name")
                    val_el = d.find("value")
                    data[d_name] = val_el.text if val_el is not None else ""

                spid = int(actions.get("session_id") or 0)
                db_name = actions.get("database_name") or "—"
                app_name = actions.get("client_app_name") or "—"

                # Filter out our own profiler tool connection if not caught by server
                if app_name == "luoBTool_Profiler":
                    continue

                duration_raw = int(data.get("duration") or 0)
                # duration in XE sql_statement_completed is in microseconds; convert to ms
                duration_ms = round(duration_raw / 1000.0, 2)

                sql_text = data.get("statement") or data.get("sql_text") or actions.get("sql_text") or ""
                if not sql_text and "batch_text" in data:
                    sql_text = data["batch_text"]

                # Deduplication key: timestamp + session_id + event + duration
                dedup_key = f"{timestamp_str}:{spid}:{name}:{duration_raw}:{sql_text[:60]}"
                if dedup_key in self._seen_set:
                    continue

                if len(self._seen_keys) == self._seen_keys.maxlen:
                    oldest = self._seen_keys.popleft()
                    self._seen_set.discard(oldest)

                self._seen_keys.append(dedup_key)
                self._seen_set.add(dedup_key)

                # Format time to HH:mm:ss
                time_display = ""
                if timestamp_str:
                    try:
                        # e.g., 2026-09-13T16:20:01.123Z
                        dt = datetime.datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                        time_display = dt.strftime("%H:%M:%S")
                    except Exception:
                        time_display = timestamp_str[-12:-4]
                if not time_display:
                    time_display = datetime.datetime.now().strftime("%H:%M:%S")

                self.emit_event(
                    time_str=time_display,
                    event_type=name,
                    spid=spid,
                    db_name=db_name,
                    app_name=app_name,
                    duration_ms=duration_ms,
                    sql_text=sql_text,
                )
            except Exception as item_err:
                logger.debug("Error parsing single event: %s", item_err)

    def _cleanup_session(self):
        """Stops and drops the Extended Events session on SQL Server."""
        if not self._raw_conn:
            return

        try:
            cursor = self._raw_conn.cursor()
            drop_sql = f"""
            IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'{self.xe_session_name}')
            BEGIN
                ALTER EVENT SESSION [{self.xe_session_name}] ON SERVER STATE = STOP;
                DROP EVENT SESSION [{self.xe_session_name}] ON SERVER;
            END;
            """
            cursor.execute(drop_sql)
            cursor.close()
            logger.info("SQL Server Extended Events session '%s' dropped successfully", self.xe_session_name)
        except Exception as e:
            logger.warning("Error dropping XE session '%s': %s", self.xe_session_name, e)
        finally:
            try:
                self._raw_conn.close()
            except Exception:
                pass
            self._raw_conn = None
