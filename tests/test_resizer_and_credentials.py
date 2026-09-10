import unittest
from app import create_app

class TestResizerAndCredentials(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()

    def test_index_elements(self):
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        # 1. Check ide-editor-pane and resizer
        self.assertIn('id="ide-editor-pane"', html)
        self.assertIn('class="ide-resizer-horizontal"', html)
        self.assertIn('id="ide-result-panel"', html)

        # 2. Check Connection Modal Form & Password manager attributes
        self.assertIn('id="connectionForm"', html)
        self.assertIn('method="post"', html)
        self.assertIn('name="username"', html)
        self.assertIn('autocomplete="username"', html)
        self.assertIn('name="password"', html)
        self.assertIn('autocomplete="current-password"', html)
        self.assertIn('type="submit"', html)
        self.assertNotIn('autocomplete="new-password"', html)
        self.assertNotIn('data-lpignore="true"', html)
        self.assertNotIn('data-form-type="other"', html)

        # 3. Check Reconnect Password Modal Form & Hidden Username
        self.assertIn('id="reconnectPasswordForm"', html)
        self.assertIn('id="reconnectHiddenUser"', html)
        self.assertIn('id="btnConfirmReconnect"', html)

if __name__ == '__main__':
    unittest.main()
