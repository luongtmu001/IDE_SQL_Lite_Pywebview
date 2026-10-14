import unittest
import os
from app import create_app

class TestResizerAndCredentials(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()

    def test_index_elements(self):
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        # 1. Check ide-editor-pane, resizer, and ide-result-panel
        self.assertIn('id="ide-editor-pane"', html)
        self.assertIn('class="ide-resizer-horizontal"', html)
        self.assertIn('id="ide-result-panel"', html)

        # 2. Check Connection Selector element ID
        self.assertIn('id="ide-ctx-connection"', html)
        self.assertIn('id="ide-ctx-conn-label"', html)

        # 3. Check Connection Modal & Reconnect Modal suppress browser save password prompt
        self.assertIn('id="connectionForm"', html)
        self.assertIn('autocomplete="off"', html)
        self.assertIn('id="connPass"', html)
        self.assertIn('autocomplete="new-password"', html)
        self.assertIn('data-lpignore="true"', html)

        self.assertIn('id="reconnectPasswordForm"', html)
        self.assertIn('id="reconnectPassInput"', html)

    def test_no_navigator_credentials_store(self):
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        for js_file in ['static/js/connections.js', 'static/js/explorer.js']:
            path = os.path.join(base_dir, js_file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            self.assertNotIn('navigator.credentials.store', content, f"{js_file} should not call navigator.credentials.store")

    def test_query_and_tabs_instant_action_bar_update(self):
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        with open(os.path.join(base_dir, 'static/js/query.js'), 'r', encoding='utf-8') as f:
            query_js = f.read()
        self.assertIn('window.updateActionBar = updateActionBar', query_js)
        self.assertIn('updateActionBar();', query_js)

        with open(os.path.join(base_dir, 'static/js/tabs.js'), 'r', encoding='utf-8') as f:
            tabs_js = f.read()
        self.assertIn('window.updateActionBar()', tabs_js)

    def test_result_panel_restore_on_query_execution(self):
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        with open(os.path.join(base_dir, 'static/js/app.js'), 'r', encoding='utf-8') as f:
            app_js = f.read()
        self.assertIn('window.ensureResultPanelVisible = ensureResultPanelVisible', app_js)
        self.assertIn('window.showResultPanel = showResultPanel', app_js)
        self.assertIn('window.hideResultPanel = hideResultPanel', app_js)
        self.assertIn('panel.style.setProperty(\'flex\', \'1 1 0%\', \'important\')', app_js)
        self.assertIn('editorPane.style.setProperty(\'flex\', \'1 1 0%\', \'important\')', app_js)

        with open(os.path.join(base_dir, 'static/js/query.js'), 'r', encoding='utf-8') as f:
            query_js = f.read()
        self.assertIn('window.ensureResultPanelVisible(true)', query_js)

    def test_sidebar_vertical_resizer_theme_styling(self):
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        # 1. Verify index.html uses --ide-bg-main and has vertical resizer
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)
        self.assertIn('class="ide-sidebar-resizer"', html)
        self.assertIn('id="ide-sidebar-resizer"', html)
        self.assertIn('background-color: var(--ide-bg-main', html)

        # 2. Verify explorer.css styles .ide-sidebar-resizer with theme tokens
        with open(os.path.join(base_dir, 'static/css/explorer.css'), 'r', encoding='utf-8') as f:
            explorer_css = f.read()
        self.assertIn('.ide-sidebar-resizer {', explorer_css)
        self.assertIn('background: var(--ide-bg-toolbar', explorer_css)
        self.assertIn('border-left: 1px solid var(--ide-border', explorer_css)
        self.assertIn('border-right: 1px solid var(--ide-border', explorer_css)
        self.assertIn('.ide-sidebar-resizer:hover,', explorer_css)
        self.assertIn('.ide-sidebar-resizer.dragging {', explorer_css)
        self.assertIn('background: var(--ide-accent', explorer_css)

        # 3. Verify theme-variables.css provides --ide-bg-base token
        with open(os.path.join(base_dir, 'static/css/theme-variables.css'), 'r', encoding='utf-8') as f:
            theme_css = f.read()
        self.assertIn('--ide-bg-base:', theme_css)

if __name__ == '__main__':
    unittest.main()


