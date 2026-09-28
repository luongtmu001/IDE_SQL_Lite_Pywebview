import unittest
from unittest.mock import MagicMock, patch
from app import create_app
from app.services.connection_manager import ConnectionManager

class TestCredentialCache(unittest.TestCase):

    def setUp(self):
        self.cm = ConnectionManager()
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def test_cache_keys_generation(self):
        cfg = {
            "type": "sqlserver",
            "server": "192.168.1.50",
            "port": 1433,
            "username": "bravo",
            "name": "Bravo Server"
        }
        keys = self.cm._make_credential_keys(cfg)
        self.assertIn("sqlserver:192.168.1.50:1433:bravo", keys)
        self.assertIn("name:bravo server:bravo", keys)

    def test_cache_set_and_get(self):
        cfg = {
            "type": "sqlserver",
            "server": "localhost",
            "port": 1433,
            "username": "bravo",
            "name": "Dev"
        }
        self.assertFalse(self.cm.has_cached_password(cfg))
        self.assertIsNone(self.cm.get_cached_password(cfg))

        self.cm.set_cached_password(cfg, "Secret123")
        self.assertTrue(self.cm.has_cached_password(cfg))
        self.assertEqual(self.cm.get_cached_password(cfg), "Secret123")

        # Test clear
        self.cm.clear_cached_password(cfg)
        self.assertFalse(self.cm.has_cached_password(cfg))
        self.assertIsNone(self.cm.get_cached_password(cfg))

    def test_create_connection_caches_password_and_reuses_it(self):
        cfg_with_pass = {
            "type": "sqlserver",
            "server": "192.168.1.100",
            "username": "bravo",
            "password": "BravoPassword!",
            "name": "Bravo DB"
        }

        mock_adapter = MagicMock()
        mock_adapter.connect.return_value = None

        with patch("app.services.connection_manager.create_adapter", return_value=mock_adapter) as mock_create:
            # 1. First connection has password
            conn1 = self.cm.create("session_1", cfg_with_pass)
            self.assertNotIn("password", conn1.config)
            self.assertTrue(self.cm.has_cached_password(cfg_with_pass))

            # 2. Simulate disconnect
            self.cm.close("session_1", conn1.connection_id)
            # Cache must still remain in RAM
            self.assertTrue(self.cm.has_cached_password(cfg_with_pass))

            # 3. Second connection (reconnect) WITHOUT password
            cfg_without_pass = {
                "type": "sqlserver",
                "server": "192.168.1.100",
                "username": "bravo",
                "name": "Bravo DB"
            }
            conn2 = self.cm.create("session_1", cfg_without_pass)
            # Verify create_adapter was called with the cached password
            last_call_cfg = mock_create.call_args[0][0]
            self.assertEqual(last_call_cfg.get("password"), "BravoPassword!")
            self.assertNotIn("password", conn2.config)

    def test_check_credential_endpoint(self):
        # Trusted connection / SQLite -> no password needed
        res = self.client.post("/api/connections/check-credential", json={
            "type": "sqlserver",
            "trusted_connection": True
        })
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json["requires_password"])
        self.assertTrue(res.json["has_password"])

        # SQL Server with user/pass before password entered
        res = self.client.post("/api/connections/check-credential", json={
            "type": "sqlserver",
            "server": "10.0.0.1",
            "username": "test_user"
        })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json["requires_password"])
        self.assertFalse(res.json["has_password"])

        # Cache password through ConnectionManager
        cm = self.app.extensions["connection_manager"]
        cm.set_cached_password({
            "type": "sqlserver",
            "server": "10.0.0.1",
            "username": "test_user"
        }, "mypassword")

        # Now check again
        res = self.client.post("/api/connections/check-credential", json={
            "type": "sqlserver",
            "server": "10.0.0.1",
            "username": "test_user"
        })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json["requires_password"])
        self.assertTrue(res.json["has_password"])

        # Clear credential
        res_clear = self.client.post("/api/connections/clear-credential", json={
            "type": "sqlserver",
            "server": "10.0.0.1",
            "username": "test_user"
        })
        self.assertEqual(res_clear.status_code, 200)

        # Check again -> false
        res_after = self.client.post("/api/connections/check-credential", json={
            "type": "sqlserver",
            "server": "10.0.0.1",
            "username": "test_user"
        })
        self.assertFalse(res_after.json["has_password"])

    def test_ui_includes_password_modal_and_warning(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        # Verify password modal is in HTML
        self.assertIn(b'id="reconnectPasswordModal"', res.data)
        self.assertIn(b'id="btnToggleReconnectPass"', res.data)
        self.assertIn(b'id="btnToggleConnPass"', res.data)
        # Verify default schema and fetch buttons in HTML
        self.assertIn(b'id="connSchema"', res.data)
        self.assertIn(b'id="btnFetchDbs"', res.data)
        self.assertIn(b'id="btnFetchSchemas"', res.data)
        # Verify security warning note
        html_text = res.data.decode("utf-8")
        self.assertIn("Mật khẩu chỉ được lưu tạm", html_text)

    def test_fetch_metadata_endpoint(self):
        with patch.object(self.app.extensions["connection_manager"], "create") as mock_create, \
             patch.object(self.app.extensions["connection_manager"], "close") as mock_close:
            mock_conn = MagicMock()
            mock_conn.connection_id = "temp_conn_123"
            mock_conn.metadata_service.list_databases.return_value = ["master", "model", "Bravo10Setup_Data"]
            mock_conn.metadata_service.list_schemas.return_value = ["dbo", "guest", "cdc"]
            mock_create.return_value = mock_conn

            res = self.client.post("/api/connections/fetch-metadata", json={
                "type": "sqlserver",
                "server": "localhost",
                "database": "Bravo10Setup_Data"
            })
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertTrue(data.get("success"))
            self.assertIn("Bravo10Setup_Data", data.get("databases", []))
            self.assertIn("dbo", data.get("schemas", []))
            mock_close.assert_called_once()

if __name__ == "__main__":
    unittest.main()
