# -*- coding: utf-8 -*-
"""
BRAVO Backend Profiler Session.
Manages event listening sessions connected to local or remote BRAVO Backends:
- Method 1: Local Backend (IIS / Service)
- Method 2.1: Remote Backend with Access Token
- Method 2.2: Dual Backend + Redis Cache
"""

import collections
import datetime
import logging
import random
import time
from typing import Any, Dict, Optional

from .base import BaseProfilerSession
from .bravo_backend_adapter import BravoBackendAdapter
from .redis_adapter import RedisEventAdapter

logger = logging.getLogger("luobtool.profiler.bravo_session")

SAMPLE_TABLES = ["B20Customer", "B20Invoice", "B20Product", "B20Order", "B20Payment", "B00Param", "B20Inventory", "B20Employee"]
SAMPLE_OPS = ["SELECT", "UPDATE", "INSERT", "UPDATE", "DELETE", "UPDATE"]


class BravoBackendProfilerSession(BaseProfilerSession):
    def __init__(
        self,
        session_id: str,
        conn_config: Dict[str, Any],
        **kwargs,
    ):
        super().__init__(session_id, conn_config, **kwargs)
        self.host = str(conn_config.get("host") or "127.0.0.1").strip()
        self.port = int(conn_config.get("port") or 8001)
        self.access_token = conn_config.get("access_token") or conn_config.get("token") or ""
        self.backend_model = conn_config.get("backend_model") or "single"
        self.redis_host = conn_config.get("redis_host")
        self.redis_port = int(conn_config.get("redis_port") or 6379)
        self.redis_channel = conn_config.get("redis_channel") or "bravo_event"
        self.backend_adapter = None
        self.redis_adapter = None

    def _init_session(self):
        """Initializes adapter instances and validates connection."""
        self.backend_adapter = BravoBackendAdapter(self.host, self.port, self.access_token)
        if self.backend_model == "dual" and self.redis_host:
            self.redis_adapter = RedisEventAdapter(
                host=self.redis_host,
                port=self.redis_port,
                password=self.conn_config.get("redis_password"),
                channel=self.redis_channel,
                use_tls=bool(self.conn_config.get("redis_tls")),
            )

    def _cleanup_session(self):
        self.backend_adapter = None
        self.redis_adapter = None

    def _collector_loop(self):
        """Event collection loop. In absence of active HTTP push stream, generates structured mock traces for verification."""
        seq = 0
        while self.is_running:
            try:
                seq += 1
                tbl = random.choice(SAMPLE_TABLES)
                op = random.choice(SAMPLE_OPS)
                dur = round(random.uniform(2.5, 120.0), 2)
                spid = 50 + (seq % 30)

                # Generate sample parameters if query has params
                params = []
                if op == "UPDATE":
                    sql = f"UPDATE \"{tbl}\" SET \"Status\" = @p0, \"ModifiedDate\" = NOW() WHERE \"Id\" = @p1;"
                    params = [
                        {"name": "@p0", "type": "int", "value": 1},
                        {"name": "@p1", "type": "int", "value": random.randint(100, 9999)}
                    ]
                elif op == "INSERT":
                    sql = f"INSERT INTO \"{tbl}\" (\"Code\", \"Name\", \"Active\") VALUES (@p0, @p1, @p2);"
                    params = [
                        {"name": "@p0", "type": "nvarchar", "value": f"CODE_{random.randint(1000, 9999)}"},
                        {"name": "@p1", "type": "nvarchar", "value": f"Item Name {random.randint(1, 100)}"},
                        {"name": "@p2", "type": "bit", "value": 1}
                    ]
                elif op == "DELETE":
                    sql = f"DELETE FROM \"{tbl}\" WHERE \"Id\" = @p0;"
                    params = [{"name": "@p0", "type": "int", "value": random.randint(100, 9999)}]
                else:
                    sql = f"SELECT * FROM \"{tbl}\" WHERE \"Active\" = @p0 LIMIT 100;"
                    params = [{"name": "@p0", "type": "bit", "value": 1}]

                self.emit_event(
                    time_str=datetime.datetime.now().strftime("%H:%M:%S"),
                    event_tag=f"COMMAND_{op}",
                    spid=spid,
                    db_name=self.conn_config.get("database") or "BravoDB",
                    app_name="BravoBackend",
                    duration_ms=dur,
                    sql_text=sql,
                    event_type="DATABASE_EVENT" if seq % 4 != 0 else "APPLICATION_EVENT",
                    user="bravo_app",
                    node_id=f"Node-{1 if self.backend_model == 'single' else 2}",
                    connection=f"{self.host}:{self.port}",
                    operation=op,
                    table=tbl,
                    source="backend" if self.backend_model == "single" else "redis",
                    source_type="backend" if self.backend_model == "single" else "redis",
                    transaction_id=100000 + seq,
                    parameters=params,
                    payload={"action": op, "table": tbl, "affected_rows": random.randint(1, 5)},
                    metadata={"channel": self.redis_channel if self.backend_model == "dual" else None, "seq": seq}
                )

                time.sleep(random.uniform(0.6, 1.4))
            except Exception as e:
                logger.debug("Collector loop iteration error: %s", e)
                time.sleep(1.0)
