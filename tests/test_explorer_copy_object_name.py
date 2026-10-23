import unittest
from pathlib import Path

class TestExplorerCopyObjectName(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parent.parent
        self.explorer_js = (self.root / "static" / "js" / "explorer.js").read_text(encoding="utf-8")
        self.clipboard_js = (self.root / "static" / "js" / "clipboard-bridge.js").read_text(encoding="utf-8")
        self.explorer_css = (self.root / "static" / "css" / "explorer.css").read_text(encoding="utf-8")

    def test_explorer_has_clean_object_name_extractor(self):
        """Verify extractCleanObjectName function exists and handles various SQL object types."""
        self.assertIn("function extractCleanObjectName", self.explorer_js)
        self.assertIn("window.getCleanTreeItemName = extractCleanObjectName", self.explorer_js)
        # Checks baseName for procedures/functions
        self.assertIn("nodeData.baseName", self.explorer_js)
        # Checks columns
        self.assertIn("nodeData.column", self.explorer_js)
        # Checks tables
        self.assertIn("nodeData.tableName", self.explorer_js)
        # Checks users/roles
        self.assertIn("nodeData.principal_name", self.explorer_js)

    def test_explorer_tree_item_is_focusable(self):
        """Verify .tree-item elements are focusable (tabIndex = 0)."""
        self.assertIn("item.tabIndex = 0;", self.explorer_js)

    def test_explorer_has_ctrl_c_handler(self):
        """Verify Ctrl+C keydown handler is attached to copy object name."""
        self.assertIn("copyTreeItemName", self.explorer_js)
        self.assertIn("window.copyTreeItemName = copyTreeItemName", self.explorer_js)
        self.assertIn("e.key !== 'c' && e.key !== 'C'", self.explorer_js)
        self.assertIn("copyTreeItemName(targetItem)", self.explorer_js)

    def test_clipboard_bridge_integrates_tree_item_fallback(self):
        """Verify clipboard-bridge.js checks focused/selected tree-item as a fallback."""
        self.assertIn("activeTreeItem", self.clipboard_js)
        self.assertIn(".tree-item.selected", self.clipboard_js)
        self.assertIn("getCleanTreeItemName", self.clipboard_js)

    def test_explorer_css_has_copied_animation_and_focus(self):
        """Verify CSS contains .tree-item:focus and .tree-item-copied flash styles."""
        self.assertIn(".tree-item:focus", self.explorer_css)
        self.assertIn(".tree-item.tree-item-copied", self.explorer_css)
        self.assertIn("@keyframes treeItemCopiedFlash", self.explorer_css)

    def test_explorer_ctrl_c_requires_focus_in_tree(self):
        """Verify explorer Ctrl+C keydown handler only runs when focus is inside the explorer tree."""
        self.assertIn("isInExplorerTree", self.explorer_js)
        self.assertIn("if (!isInExplorerTree)", self.explorer_js)

    def test_clipboard_bridge_prevents_explorer_hijack_when_typing_sql(self):
        """Verify clipboard bridge checks isEditorActive and isExplorerFocused before copying tree items."""
        self.assertIn("isEditorActive", self.clipboard_js)
        self.assertIn("isExplorerFocused", self.clipboard_js)
        self.assertIn("!isEditorActive", self.clipboard_js)

    def test_clipboard_bridge_handles_monaco_cut(self):
        """Verify clipboard bridge executes edits in Monaco when cutting text (Ctrl+X)."""
        self.assertIn("clipboard-cut", self.clipboard_js)
        self.assertIn("targetEd.executeEdits('clipboard-cut'", self.clipboard_js)

if __name__ == "__main__":
    unittest.main()
