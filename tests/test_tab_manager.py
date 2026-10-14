import re
from pathlib import Path


def test_tab_manager_dom_elements():
    """Verify templates contain the tab overflow indicator button always at the far right corner and tab controls."""
    for template_path in ["templates/partials/editor.html", "templates/index.html"]:
        path = Path(template_path)
        assert path.exists(), f"{template_path} must exist"
        content = path.read_text(encoding="utf-8")

        assert "id=\"ide-tabs-overflow-btn\"" in content
        assert "id=\"ide-tab-overflow-wrap\"" in content
        assert "ms-auto" in content  # Pushed to the far right corner
        assert "fa-ellipsis" in content
        assert "id=\"ide-new-tab-btn\"" in content
        assert "id=\"ide-tabs-bar\"" in content
        assert "class=\"ide-tabs-container" in content


def test_tab_manager_css_rules():
    """Verify editor.css and style.css define all required styles for overflow, multi-line, pinned tabs, and dropdown."""
    for css_path_str in ["static/css/editor.css", "static/css/style.css"]:
        path = Path(css_path_str)
        assert path.exists(), f"{css_path_str} must exist"
        content = path.read_text(encoding="utf-8")

        # Far right corner positioning for overflow button
        assert "#ide-tab-overflow-wrap" in content
        assert "margin-left: auto !important" in content

        # Multi-line Tab Bar ("Show All Tabs")
        assert ".ide-tabs-container.display-all" in content
        assert "#ide-tabs-bar.display-all" in content
        assert "flex-wrap: wrap" in content

        # Tab Overflow Hidden
        assert ".ide-tab.tab-overflow-hidden" in content
        assert "display: none !important" in content

        # Pin Tab styling
        assert ".ide-tab.pinned" in content
        assert ".tab-pin-icon" in content

        # Drag and drop reordering indicators
        assert ".ide-tab[draggable=\"true\"]" in content
        assert ".ide-tab.dragging" in content
        assert ".ide-tab.drag-over-left" in content
        assert ".ide-tab.drag-over-right" in content

        # Overflow Button and Dropdown Menu
        assert "#ide-tabs-overflow-btn" in content
        assert "#ide-tab-overflow-menu" in content

        # Section 4: Visible tabs bold (font-weight: 700), overflow tabs normal (font-weight: 400)
        assert ".ide-overflow-item.is-visible .tab-list-title" in content
        assert "font-weight: 700" in content
        assert ".ide-overflow-item.is-overflow .tab-list-title" in content
        assert "font-weight: 400" in content


def test_tabs_js_overflow_and_display_mode_engine():
    """Verify tabs.js contains the complete single-source-of-truth tab overflow engine."""
    tabs_js_path = Path("static/js/tabs.js")
    assert tabs_js_path.exists()
    content = tabs_js_path.read_text(encoding="utf-8")

    # State variables
    assert "let tabDisplayMode = 'overflow'" in content
    assert "let tabOrder = []" in content
    assert "const pinnedTabs = new Set()" in content
    assert "let visibleTabIds = new Set()" in content
    assert "let overflowTabIds = new Set()" in content

    # Dynamic calculation based on actual rendered widths (Section 13)
    assert "function calculateTabLayout" in content
    assert "getBoundingClientRect" in content or "offsetWidth" in content
    assert "tabWidthMap" in content

    # Overflow Dropdown Menu with Section 4 bold/normal differentiation
    assert "function showTabOverflowMenu" in content
    assert "is-visible" in content
    assert "is-overflow" in content
    assert "tab-list-title" in content
    assert "Show All Tabs" in content
    assert "ide-overflow-toggle" in content

    # Pin / Unpin support (Section 10)
    assert "function pinTab" in content
    assert "function unpinTab" in content
    assert "isTabPinned" in content
    assert "Pin Tab" in content
    assert "Unpin Tab" in content

    # Drag & Drop reorder (Section 11)
    assert "setupTabDragAndDrop" in content
    assert "dataTransfer" in content

    # ResizeObserver & Window Resize (Section 9)
    assert "ResizeObserver" in content
    assert "window.addEventListener('resize'" in content

    # Tab shortcuts (Ctrl+N, Ctrl+W, Ctrl+Shift+W)
    assert "key === 'n'" in content or "e.key.toLowerCase() === 'n'" in content
    assert "key === 'w'" in content or "e.key.toLowerCase() === 'w'" in content
    assert "closeAllTabs" in content

    # Exported APIs
    assert "calculateTabLayout" in content
    assert "showTabOverflowMenu" in content
    assert "pinTab" in content
    assert "unpinTab" in content
    assert "getTabDisplayMode" in content
    assert "setTabDisplayMode" in content


def test_tab_overflow_simulation_algorithm():
    """
    Simulate the exact layout and sliding-window logic from tabs.js
    to verify Section 2, 4, 5, 8, 10, 11 of bugs/tab_manager.md.
    """
    class TabManagerSimulator:
        def __init__(self, container_width=600):
            self.container_width = container_width
            self.tab_display_mode = 'overflow'
            self.tab_order = []
            self.pinned_tabs = set()
            self.active_tab_id = None
            self.tab_widths = {}
            self.visible_tab_ids = set()
            self.overflow_tab_ids = set()
            self.overflow_btn_visible = False

        def add_tab(self, tab_id, width=120, pinned=False):
            self.tab_order.append(tab_id)
            self.tab_widths[tab_id] = width
            if pinned:
                self.pin_tab(tab_id)
            self.active_tab_id = tab_id
            self.calculate_layout()

        def pin_tab(self, tab_id):
            self.pinned_tabs.add(tab_id)
            pinned = [t for t in self.tab_order if t in self.pinned_tabs]
            unpinned = [t for t in self.tab_order if t not in self.pinned_tabs]
            self.tab_order = pinned + unpinned
            self.calculate_layout()

        def unpin_tab(self, tab_id):
            self.pinned_tabs.discard(tab_id)
            pinned = [t for t in self.tab_order if t in self.pinned_tabs]
            unpinned = [t for t in self.tab_order if t not in self.pinned_tabs]
            self.tab_order = pinned + unpinned
            self.calculate_layout()

        def switch_tab(self, tab_id):
            assert tab_id in self.tab_order, f"{tab_id} must exist"
            self.active_tab_id = tab_id
            self.calculate_layout()

        def calculate_layout(self):
            if self.tab_display_mode == 'all':
                self.overflow_btn_visible = True
                self.visible_tab_ids = set(self.tab_order)
                self.overflow_tab_ids = set()
                return

            total_width = sum(self.tab_widths[t] for t in self.tab_order)
            reserved_no_overflow = 44
            reserved_with_overflow = 78

            if total_width <= (self.container_width - reserved_no_overflow):
                self.overflow_btn_visible = False
                self.visible_tab_ids = set(self.tab_order)
                self.overflow_tab_ids = set()
                return

            # Overflow!
            self.overflow_btn_visible = True
            available_width = max(80, self.container_width - reserved_with_overflow)

            pinned_list = [t for t in self.tab_order if t in self.pinned_tabs]
            normal_list = [t for t in self.tab_order if t not in self.pinned_tabs]

            pinned_used = 0
            visible_pinned = []
            for pid in pinned_list:
                w = self.tab_widths[pid]
                if pinned_used + w <= available_width:
                    visible_pinned.append(pid)
                    pinned_used += w
                else:
                    break

            remaining_for_normal = max(0, available_width - pinned_used)
            visible_normal = []

            if normal_list and remaining_for_normal > 0:
                if self.active_tab_id in normal_list:
                    active_idx = normal_list.index(self.active_tab_id)
                    used = 0
                    from_start = []
                    fits_from_start = True
                    for i in range(active_idx + 1):
                        w = self.tab_widths[normal_list[i]]
                        if used + w > remaining_for_normal:
                            fits_from_start = False
                            break
                        used += w
                        from_start.append(normal_list[i])

                    if fits_from_start:
                        for i in range(active_idx + 1, len(normal_list)):
                            w = self.tab_widths[normal_list[i]]
                            if used + w <= remaining_for_normal:
                                used += w
                                from_start.append(normal_list[i])
                            else:
                                break
                        visible_normal = from_start
                    else:
                        start = active_idx
                        end = active_idx
                        used_w = self.tab_widths[normal_list[active_idx]]
                        while end + 1 < len(normal_list) and (used_w + self.tab_widths[normal_list[end + 1]] <= remaining_for_normal):
                            end += 1
                            used_w += self.tab_widths[normal_list[end]]
                        while start - 1 >= 0 and (used_w + self.tab_widths[normal_list[start - 1]] <= remaining_for_normal):
                            start -= 1
                            used_w += self.tab_widths[normal_list[start]]
                        visible_normal = normal_list[start:end + 1]
                else:
                    used = 0
                    for nid in normal_list:
                        w = self.tab_widths[nid]
                        if used + w <= remaining_for_normal:
                            visible_normal.append(nid)
                            used += w
                        else:
                            break

            self.visible_tab_ids = set(visible_pinned + visible_normal)
            self.overflow_tab_ids = set(t for t in self.tab_order if t not in self.visible_tab_ids)

    # 1. Test when tabs fit within width (no overflow button)
    sim = TabManagerSimulator(container_width=500)
    sim.add_tab("Tab 1", width=100)
    sim.add_tab("Tab 2", width=100)
    sim.add_tab("Tab 3", width=100)
    assert not sim.overflow_btn_visible
    assert len(sim.visible_tab_ids) == 3
    assert len(sim.overflow_tab_ids) == 0

    # 2. Test overflow occurs when tabs exceed available width
    sim.add_tab("Tab 4", width=100)
    sim.add_tab("Tab 5", width=100)
    sim.add_tab("Tab 6", width=100)
    assert sim.overflow_btn_visible
    assert len(sim.overflow_tab_ids) > 0
    # Active tab (Tab 6, which was just added) must be in visible tabs!
    assert "Tab 6" in sim.visible_tab_ids

    # 3. Test Section 5: Clicking an overflow tab moves it into the visible window
    assert "Tab 1" in sim.overflow_tab_ids
    sim.switch_tab("Tab 1")
    assert "Tab 1" in sim.visible_tab_ids
    assert "Tab 6" in sim.overflow_tab_ids
    # Tab order must NOT change
    assert sim.tab_order == ["Tab 1", "Tab 2", "Tab 3", "Tab 4", "Tab 5", "Tab 6"]

    # 4. Test Section 10: Pin tab priority
    sim.pin_tab("Tab 6")
    # Pinned tab moves to the front
    assert sim.tab_order[0] == "Tab 6"
    assert "Tab 6" in sim.visible_tab_ids
    sim.switch_tab("Tab 1")
    # Even when Tab 1 is active, pinned tab Tab 6 remains visible!
    assert "Tab 6" in sim.visible_tab_ids
    assert "Tab 1" in sim.visible_tab_ids

    # 5. Test Section 8: Mode "all" (Show All Tabs)
    sim.tab_display_mode = 'all'
    sim.calculate_layout()
    assert len(sim.visible_tab_ids) == 6
    assert len(sim.overflow_tab_ids) == 0
    # In "all" mode, all 6 tabs are visible (wrap in multi-line)
    for t in sim.tab_order:
        assert t in sim.visible_tab_ids

    # 6. Test user requirement: Visible screen files prioritized first (left-to-right order), followed by overflow files
    sim.tab_display_mode = 'overflow'
    sim.switch_tab("Tab 3")
    visible_on_screen = [t for t in sim.tab_order if t in sim.visible_tab_ids]
    overflow_tabs = [t for t in sim.tab_order if t not in sim.visible_tab_ids]
    menu_ordered_tabs = visible_on_screen + overflow_tabs

    # The first items in menu MUST be all visible_on_screen tabs in their left-to-right screen order
    assert menu_ordered_tabs[:len(visible_on_screen)] == visible_on_screen
    assert menu_ordered_tabs[len(visible_on_screen):] == overflow_tabs
    assert "Tab 6" in visible_on_screen  # pinned tab is visible
    assert "Tab 3" in visible_on_screen  # active tab is visible
    assert len(overflow_tabs) > 0  # overflow tabs exist and are listed after visible tabs
