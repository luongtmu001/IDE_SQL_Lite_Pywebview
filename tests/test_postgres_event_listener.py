# -*- coding: utf-8 -*-
import unittest
from app.utils.iis_discovery import discover_local_backends
from app.services.profiler.bravo_backend_adapter import BravoBackendAdapter
from app.services.profiler.redis_adapter import RedisEventAdapter
from app.services.profiler.base import TraceEvent
from app.services.profiler.profiler_service import ProfilerService


class TestPostgresEventListener(unittest.TestCase):

    def test_local_backend_discovery(self):
        backends = discover_local_backends()
        self.assertIsInstance(backends, list)
        self.assertGreater(len(backends), 0)
        first = backends[0]
        self.assertIn("id", first)
        self.assertIn("name", first)
        self.assertIn("host", first)
        self.assertIn("port", first)
        self.assertIn("status", first)

    def test_bravo_backend_adapter_offline_check(self):
        # Testing a non-existent port should fail gracefully without unhandled exception
        adapter = BravoBackendAdapter("127.0.0.1", 59999, "invalid_token")
        report = adapter.test_connection(timeout=0.2)
        self.assertIsInstance(report, dict)
        self.assertFalse(report["success"])
        self.assertIsNotNone(report["error"])
        self.assertGreater(len(report["steps"]), 0)

    def test_redis_adapter_offline_check(self):
        # Testing a non-existent port should fail gracefully
        adapter = RedisEventAdapter("127.0.0.1", 59998, "pass", "test_channel")
        report = adapter.test_connection(timeout=0.2)
        self.assertIsInstance(report, dict)
        self.assertFalse(report["success"])
        self.assertIsNotNone(report["error"])

    def test_trace_event_unified_schema(self):
        ev = TraceEvent(
            id=1,
            time="14:30:00",
            event="COMMAND_UPDATE",
            spid=55,
            db="BravoDB",
            app="BravoBackend",
            duration=12.5,
            sql="UPDATE B20Customer SET Active = 1;",
            user="admin",
            node_id="Node-1",
            connection="127.0.0.1:8001",
            operation="UPDATE",
            table="B20Customer",
            parameters=[{"name": "@p0", "type": "int", "value": 1}],
            event_type="DATABASE_EVENT",
            source="backend",
        )
        d = ev.to_dict()
        self.assertEqual(d["id"], 1)
        self.assertEqual(d["row_num"], 1)
        self.assertEqual(d["user"], "admin")
        self.assertEqual(d["database"], "BravoDB")
        self.assertEqual(d["table"], "B20Customer")
        self.assertEqual(d["operation"], "UPDATE")
        self.assertEqual(d["command_text"], "UPDATE B20Customer SET Active = 1;")
        self.assertEqual(len(d["parameters"]), 1)
        self.assertEqual(d["event_type"], "DATABASE_EVENT")

    def test_profiler_service_bravo_backend(self):
        service = ProfilerService()
        res = service.start_trace({
            "type": "bravo_backend",
            "host": "127.0.0.1",
            "port": 8001,
            "database": "BravoDB"
        })
        self.assertTrue(res["success"])
        session_id = res["session_id"]
        status = service.get_status(session_id)
        self.assertTrue(status["is_running"])
        service.stop_trace(session_id)
        self.assertNotIn(session_id, service.active_sessions)


if __name__ == "__main__":
    unittest.main()
