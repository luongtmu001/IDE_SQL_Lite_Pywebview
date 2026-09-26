# -*- coding: utf-8 -*-
"""
PostgreSQL Trace Profiler implementation.
Complies with specs in .SKILL/profiler.md:
- Mode 1: High-Resolution Real-Time Live Activity & Query Sampler (via pg_stat_activity).
  Captures both in-flight active queries and completed queries (state transition to idle/idle in transaction)
  with microsecond-level duration accuracy and sub-50ms sampling.
- Mode 2: CSVLog Tailer (RFC 4180 parsing, multiline query preservation, log rotation) when explicitly configured.
- Clean suppression of internal profiler connection (application_name = 'luoBTool_Profiler').
- Bounded ring buffer for deduplication.
- Thread-safe and graceful shutdown.
"""

import collections
import csv
import datetime
import io
import logging
import os
import re
import time
from typing import Any, Dict, Optional

from .base import BaseProfilerSession

logger = logging.getLogger("luobtool.profiler.postgres")


class PostgresProfilerSession(BaseProfilerSession):
    def __init__(
        self,
        session_id: str,
        conn_config: Dict[str, Any],
        log_directory: Optional[str] = None,
        force_mode: Optional[str] = None,
        **kwargs,
    ):
        super().__init__(session_id, conn_config, **kwargs)
        self.log_directory = log_directory
        self._raw_conn = None
        self._seen_keys = collections.deque(maxlen=20000)
        self._seen_set = set()
        # Default to high-performance real-time activity sampler
        self.mode = force_mode or "activity"

    def _create_connection(self):
        """Creates dedicated connection for the profiler session with specific application_name."""
        from app.database.postgresql import PostgreSqlAdapter

        cfg = dict(self.conn_config)
        cfg["application_name"] = "luoBTool_Profiler"
        adapter = PostgreSqlAdapter(cfg)
        adapter.connect()
        return adapter.connection

    def _init_session(self):
        """Initializes connection, detects features, and seeds pre-existing queries."""
        self._raw_conn = self._create_connection()
        cursor = self._raw_conn.cursor()

        # If user explicitly specified csvlog mode, check log directory
        if self.mode == "csvlog":
            detected_log_dir = self.log_directory
            try:
                if not detected_log_dir:
                    cursor.execute("SHOW log_directory;")
                    row_dir = cursor.fetchone()
                    if row_dir and row_dir[0]:
                        detected_log_dir = row_dir[0]
                        if not os.path.isabs(detected_log_dir):
                            cursor.execute("SHOW data_directory;")
                            row_data = cursor.fetchone()
                            if row_data and row_data[0]:
                                detected_log_dir = os.path.join(row_data[0], detected_log_dir)
            except Exception as e:
                logger.debug("Error checking PG log configs: %s", e)

            if detected_log_dir and os.path.isdir(detected_log_dir):
                csv_files = [f for f in os.listdir(detected_log_dir) if f.endswith(".csv")]
                if csv_files:
                    self.log_directory = detected_log_dir
                    cursor.close()
                    logger.info("Postgres profiler using CSVLog mode at: %s", detected_log_dir)
                    return

            # Fallback to activity mode if csvlog is not accessible
            self.mode = "activity"

        # In Activity mode: Seed existing queries in pg_stat_activity so we don't emit stale historical events
        try:
            cursor.execute("""
                SELECT pid, query_start 
                FROM pg_stat_activity 
                WHERE query_start IS NOT NULL;
            """)
            for pid, q_start in cursor.fetchall():
                if q_start is not None:
                    seed_key = f"{pid}:{q_start}"
                    self._seen_set.add(seed_key)
                    self._seen_keys.append(seed_key)
            logger.info("Postgres profiler initialized with %d pre-existing seed queries", len(self._seen_set))
        except Exception as e:
            logger.warning("Error seeding existing PG queries: %s", e)
        finally:
            cursor.close()

        logger.info("Postgres profiler using Real-time Activity Sampler mode (pg_stat_activity)")

    def _collector_loop(self):
        """Runs the active collector mode."""
        if self.mode == "csvlog":
            self._csvlog_tailer_loop()
        else:
            self._activity_polling_loop()

    def _activity_polling_loop(self):
        """
        High-resolution live query polling from pg_stat_activity.
        Captures active executing queries AND recently completed queries (state transition to idle).
        """
        query_sql = """
        SELECT
            pid,
            to_char(query_start, 'HH24:MI:SS') AS time_str,
            state,
            COALESCE(application_name, '—') AS app,
            COALESCE(datname, '—') AS db,
            CASE
                WHEN state = 'active' THEN
                    GREATEST(0, ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000, 2))
                WHEN state_change IS NOT NULL AND query_start IS NOT NULL AND state_change >= query_start THEN
                    GREATEST(0, ROUND(EXTRACT(EPOCH FROM (state_change - query_start)) * 1000, 2))
                ELSE 0
            END AS duration_ms,
            query,
            query_start
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND (application_name IS NULL OR application_name <> 'luoBTool_Profiler')
          AND state IS NOT NULL
          AND query IS NOT NULL
          AND TRIM(query) <> ''
          AND TRIM(query) <> ';'
          AND query NOT ILIKE '%pg_stat_activity%'
          AND query NOT ILIKE '%pg_backend_pid()%'
        ORDER BY query_start ASC;
        """

        while self.is_running:
            try:
                if not self._raw_conn:
                    break

                cursor = self._raw_conn.cursor()
                cursor.execute(query_sql)
                rows = cursor.fetchall()
                cursor.close()

                for row in rows:
                    pid, time_str, state, app, db, duration_ms, sql, query_start = row
                    if not sql or not sql.strip():
                        continue

                    # Deduplication key based on pid and microsecond-precision query_start
                    dedup_key = f"{pid}:{query_start}"
                    if dedup_key in self._seen_set:
                        continue

                    if len(self._seen_keys) >= self._seen_keys.maxlen:
                        oldest = self._seen_keys.popleft()
                        self._seen_set.discard(oldest)

                    self._seen_keys.append(dedup_key)
                    self._seen_set.add(dedup_key)

                    # Determine descriptive event type tag
                    first_word = sql.strip().split()[0].upper() if sql.strip() else "QUERY"
                    if first_word in ("BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT"):
                        event_tag = "TRANSACTION"
                    elif first_word in ("SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE"):
                        event_tag = f"COMMAND_{first_word}"
                    elif first_word in ("EXECUTE", "CALL"):
                        event_tag = "RPC_CALL"
                    elif first_word in ("SET", "SHOW", "RESET"):
                        event_tag = "CONFIG"
                    else:
                        event_tag = f"STATEMENT_{first_word}" if first_word.isalnum() else "STATEMENT"

                    self.emit_event(
                        time_str=time_str or datetime.datetime.now().strftime("%H:%M:%S"),
                        event_type=event_tag,
                        spid=int(pid),
                        db_name=db or "—",
                        app_name=app or "—",
                        duration_ms=float(duration_ms or 0),
                        sql_text=sql,
                    )

            except Exception as e:
                if self.is_running:
                    logger.warning("Error in PG activity polling: %s", e)
                    # Reconnect if connection dropped
                    try:
                        time.sleep(0.5)
                        self._raw_conn = self._create_connection()
                    except Exception:
                        pass
                time.sleep(0.2)

            time.sleep(0.05)  # 50ms polling cycle for sub-second responsiveness

    def _csvlog_tailer_loop(self):
        """Tails the newest PostgreSQL CSV log file with RFC 4180 parsing and log rotation."""
        current_file_path = None
        current_file_handle = None

        def get_latest_csv_file():
            if not self.log_directory or not os.path.isdir(self.log_directory):
                return None
            csvs = [
                os.path.join(self.log_directory, f)
                for f in os.listdir(self.log_directory)
                if f.endswith(".csv")
            ]
            if not csvs:
                return None
            return max(csvs, key=os.path.getmtime)

        try:
            latest = get_latest_csv_file()
            if latest:
                current_file_path = latest
                current_file_handle = open(latest, "r", encoding="utf-8", errors="replace")
                current_file_handle.seek(0, os.SEEK_END)

            buf = ""
            while self.is_running:
                latest_check = get_latest_csv_file()
                if latest_check and latest_check != current_file_path:
                    logger.info("Log rotation detected. Switching to %s", latest_check)
                    if current_file_handle:
                        try:
                            current_file_handle.close()
                        except Exception:
                            pass
                    current_file_path = latest_check
                    current_file_handle = open(latest_check, "r", encoding="utf-8", errors="replace")

                if current_file_handle:
                    chunk = current_file_handle.read()
                    if chunk:
                        buf += chunk
                        csv_reader = csv.reader(io.StringIO(buf))
                        valid_records = []
                        try:
                            for record in csv_reader:
                                valid_records.append(record)
                            buf = ""
                        except Exception:
                            pass

                        for rec in valid_records:
                            self._process_csv_record(rec)
                    else:
                        time.sleep(0.1)
                else:
                    time.sleep(0.5)

        except Exception as e:
            logger.warning("Error in CSVLog tailer: %s", e)
        finally:
            if current_file_handle:
                try:
                    current_file_handle.close()
                except Exception:
                    pass

    def _process_csv_record(self, record: list):
        """Processes a single RFC 4180 CSV log record according to standard PG csvlog format."""
        if len(record) < 14:
            return

        try:
            log_time = record[0]
            db_name = record[2] or "—"
            spid = int(record[3]) if record[3].isdigit() else 0
            command_tag = record[7] or "STATEMENT"
            message = record[13] or ""
            app_name = record[22] if len(record) > 22 else "—"

            if app_name == "luoBTool_Profiler":
                return

            duration_ms = 0.0
            sql_text = ""

            dur_match = re.search(r"duration:\s*([\d.]+)\s*ms", message)
            if dur_match:
                duration_ms = float(dur_match.group(1))

            stmt_match = re.search(r"statement:\s*(.*)", message, re.DOTALL)
            if stmt_match:
                sql_text = stmt_match.group(1).strip()
            elif "execute" in message.lower():
                sql_text = message.strip()
            else:
                sql_text = message.strip()

            if not sql_text:
                return

            time_display = log_time[:19].split()[-1] if log_time else datetime.datetime.now().strftime("%H:%M:%S")

            self.emit_event(
                time_str=time_display,
                event_type=command_tag,
                spid=spid,
                db_name=db_name,
                app_name=app_name,
                duration_ms=duration_ms,
                sql_text=sql_text,
            )
        except Exception as e:
            logger.debug("Error processing csvlog record: %s", e)

    def _cleanup_session(self):
        """Cleans up DB connection."""
        if self._raw_conn:
            try:
                self._raw_conn.close()
            except Exception:
                pass
            self._raw_conn = None
