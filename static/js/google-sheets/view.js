/**
 * Google Sheets View Component.
 * Implements Grouped Projects & Sheets Accordion Sidebar, Tag Filter Chips,
 * and Live Direct View & Edit Area integrated with Independent Sheet Tabs.
 */

window.GoogleSheetsView = (function () {
  'use strict';

  let _dom = {};
  let _cachedProjects = [];
  let _expandedProjectIds = new Set();
  let _selectedSheet = null;
  let _selectedCell = null;
  let _dirty = false;
  let _urlDebounceTimer = null;
  let _activeTagFilter = null; // null means 'Tất cả'
  let _targetAddProjectId = null;

  const DEFAULT_GRID_ROWS = 25;
  const DEFAULT_GRID_COLS = 8; // A to H

  const SAMPLE_DATA = [
    ['Mã', 'Tên danh mục / Cột', 'Kiểu dữ liệu', 'Bắt buộc', 'Độ dài', 'Mặc định', 'Ghi chú nghiệp vụ'],
    ['C001', 'id', 'BIGINT', 'YES', '8', 'IDENTITY(1,1)', 'Khóa chính tự tăng'],
    ['C002', 'customer_code', 'NVARCHAR', 'YES', '50', "''", 'Mã khách hàng ERP'],
    ['C003', 'customer_name', 'NVARCHAR', 'YES', '255', "''", 'Tên đầy đủ công ty / cá nhân'],
    ['C004', 'tax_code', 'VARCHAR', 'NO', '20', 'NULL', 'Mã số thuế doanh nghiệp'],
    ['C005', 'address', 'NVARCHAR', 'NO', '500', 'NULL', 'Địa chỉ xuất hóa đơn'],
    ['C006', 'credit_limit', 'DECIMAL', 'NO', '18,2', '0', 'Hạn mức công nợ tối đa'],
    ['C007', 'is_active', 'BIT', 'YES', '1', '1', '1: Đang hoạt động, 0: Khóa'],
    ['C008', 'created_at', 'DATETIME2', 'YES', '7', 'GETDATE()', 'Thời điểm tạo bản ghi'],
    ['C009', 'updated_at', 'DATETIME2', 'NO', '7', 'NULL', 'Thời điểm cập nhật cuối']
  ];

  let _activeMenuProject = null;
  let _currentViewMode = 'editor'; // 'editor' (default /edit in-place), 'live', or 'grid'
  let _isResizing = false;
  let _editorResizeObserver = null;

  function init() {
    if (document.getElementById('gs-app-container')) {
      _cacheDom();
      _bindEvents();
      _initSidebarResizer();
      _initSidebarToggle();
      _initDropdownMenu();
      _initEditorResizeObserver();
      _initTabsIntegration();
    }

    if (window.GoogleSheetsTabs && typeof window.GoogleSheetsTabs.subscribe === 'function') {
      window.GoogleSheetsTabs.subscribe(() => {
        if (_selectedSheet) {
          _updateOpenStatusBadge(_selectedSheet.id);
        }
      });
    }
  }

  function _cacheDom() {
    const appContainer = document.getElementById('gs-app-container');
    _dom = {
      appContainer,
      backdrop: null,
      btnToggleSidebar: document.getElementById('gs-btn-toggle-sidebar'),
      btnUncollapseSidebar: document.getElementById('gs-btn-uncollapse-sidebar'),
      btnUncollapseSidebarEmpty: document.getElementById('gs-btn-uncollapse-sidebar-empty'),
      leftPanel: document.getElementById('gs-left-panel'),
      resizer: document.getElementById('gs-resizer'),
      btnAddProject: document.getElementById('gs-btn-add-project'),

      // Grouped Tree, Search & Tag Filter
      projectTree: document.getElementById('gs-project-tree'),
      tagFilterBar: document.getElementById('gs-tag-filter-bar'),
      searchInput: document.getElementById('gs-search-input'),
      searchClearBtn: document.getElementById('gs-search-clear-btn'),

      // Independent Tabs Bar
      sheetTabsBar: document.getElementById('gs-sheet-tabs-bar'),
      sheetTabsScroll: document.getElementById('gs-sheet-tabs-scroll'),
      btnTabsAdd: document.getElementById('gs-btn-tabs-add'),

      // Pane 2/3 Main View elements
      paneEmpty: document.getElementById('gs-pane-empty'),
      paneActiveContent: document.getElementById('gs-pane-active-content'),
      activeSheetTitle: document.getElementById('gs-active-sheet-title'),
      activeSheetTypeBadge: document.getElementById('gs-active-sheet-type-badge'),
      activeSheetIcon: document.getElementById('gs-active-sheet-icon'),
      activeSheetOpenBadge: document.getElementById('gs-active-sheet-open-badge'),
      activeSheetProject: document.getElementById('gs-active-sheet-project'),
      activeSheetId: document.getElementById('gs-active-sheet-id'),
      activeSheetTags: document.getElementById('gs-active-sheet-tags'),
      btnOpenCompanionWin: document.getElementById('gs-btn-open-companion-win'),
      btnOpenBrowser: document.getElementById('gs-btn-open-browser'),
      btnEditSheetMeta: document.getElementById('gs-btn-edit-sheet-meta'),
      btnDeleteSheet: document.getElementById('gs-btn-delete-sheet'),

      // View Mode Switcher
      tabViewEditor: document.getElementById('gs-tab-view-editor'),
      tabViewLive: document.getElementById('gs-tab-view-live'),
      tabViewGrid: document.getElementById('gs-tab-view-grid'),
      btnSyncData: document.getElementById('gs-btn-sync-data'),
      btnReloadEmbed: document.getElementById('gs-btn-reload-embed'),

      // Native Editor Container
      nativeEditorWrap: document.getElementById('gs-native-editor-wrap'),
      editorLoading: document.getElementById('gs-editor-loading'),
      editorLoadingMsg: document.getElementById('gs-editor-loading-msg'),
      editorAnchor: document.getElementById('gs-editor-anchor'),

      // Live Embed container
      embedWrap: document.getElementById('gs-embed-wrap'),
      embedLoading: document.getElementById('gs-embed-loading'),
      liveFrame: document.getElementById('gs-live-frame'),

      // Grid container & formula elements
      gridContainer: document.getElementById('gs-grid-container'),
      cellCoords: document.getElementById('gs-cell-coords'),
      formulaInput: document.getElementById('gs-formula-input'),
      tableHead: document.getElementById('gs-table-head'),
      tableBody: document.getElementById('gs-table-body'),
      btnSaveDraft: document.getElementById('gs-btn-save-draft'),
      saveDraftLabel: document.getElementById('gs-save-draft-label'),
      gridSaveStatus: document.getElementById('gs-grid-save-status'),
      toolBold: document.getElementById('gs-btn-tool-bold'),
      toolItalic: document.getElementById('gs-btn-tool-italic'),

      // Dropdown Menu
      projectDropdownMenu: document.getElementById('gs-project-dropdown-menu'),
      menuEditProject: document.getElementById('gs-menu-edit-project'),
      menuAddSheetToProject: document.getElementById('gs-menu-add-sheet-to-project'),
      menuDeleteProject: document.getElementById('gs-menu-delete-project'),

      // Dialogs
      projectOverlay: document.getElementById('gs-dialog-project-overlay'),
      sheetOverlay: document.getElementById('gs-dialog-sheet-overlay'),
      inputProjectName: document.getElementById('gs-input-project-name'),
      inputProjectColor: document.getElementById('gs-input-project-color'),
      inputProjectDesc: document.getElementById('gs-input-project-desc'),
      btnSaveProject: document.getElementById('gs-btn-save-project'),
      btnCancelProject: document.getElementById('gs-btn-cancel-project'),
      inputSheetTitle: document.getElementById('gs-input-sheet-title'),
      inputSheetUrl: document.getElementById('gs-input-sheet-url'),
      inputSheetTags: document.getElementById('gs-input-sheet-tags'),
      inputSheetNotes: document.getElementById('gs-input-sheet-notes'),
      urlValidation: document.getElementById('gs-sheet-url-validation'),
      btnSaveSheet: document.getElementById('gs-btn-save-sheet'),
      btnCancelSheet: document.getElementById('gs-btn-cancel-sheet'),
    };
  }

  function _initTabsIntegration() {
    if (!window.GoogleSheetTabsManager) return;

    window.GoogleSheetTabsManager.onTabChange((activeTab, allTabs) => {
      _handleTabChange(activeTab);
    });

    // Check if there is already an active tab restored on load
    const currentActive = window.GoogleSheetTabsManager.getActiveTab();
    if (currentActive) {
      _handleTabChange(currentActive);
    }
  }

  function _getTypeConfig(type) {
    switch (type) {
      case 'doc':
        return { icon: 'fa-file-lines', color: '#3B82F6', label: 'Docs' };
      case 'slide':
        return { icon: 'fa-file-powerpoint', color: '#F59E0B', label: 'Slides' };
      case 'pdf':
        return { icon: 'fa-file-pdf', color: '#EF4444', label: 'PDF', readOnly: true };
      case 'task':
        return { icon: 'fa-square-check', color: '#8B5CF6', label: 'Tasks' };
      case 'sheet':
      default:
        return { icon: 'fa-table-cells', color: '#10B981', label: 'Sheet' };
    }
  }

  function _handleTabChange(tab) {
    if (!tab) {
      _selectedSheet = null;
      if (_dom.paneActiveContent) _dom.paneActiveContent.style.display = 'none';
      if (_dom.paneEmpty) _dom.paneEmpty.style.display = 'flex';
      if (_dom.liveFrame) _dom.liveFrame.src = 'about:blank';
      _updateTreeSelection(null);
      syncEditorHostBounds(false);
      return;
    }

    _selectedSheet = tab;
    const typeCfg = _getTypeConfig(tab.type);
    const isSpreadsheet = (!tab.type || tab.type === 'sheet');

    if (_dom.paneEmpty) _dom.paneEmpty.style.display = 'none';
    if (_dom.paneActiveContent) _dom.paneActiveContent.style.display = 'flex';

    // Topbar Metadata
    if (_dom.activeSheetTitle) _dom.activeSheetTitle.textContent = tab.title || 'Untitled';
    if (_dom.activeSheetId) {
      const docId = tab.spreadsheetId || tab.doc_id || '';
      _dom.activeSheetId.textContent = docId ? `${docId.substring(0, 18)}...` : '';
      _dom.activeSheetId.title = `Full ID: ${docId}`;
    }
    if (_dom.activeSheetProject) {
      _dom.activeSheetProject.textContent = tab.projectName || 'Dự án';
      _dom.activeSheetProject.style.backgroundColor = tab.projectColor || '#3B82F6';
    }

    // Type Badge & Icon
    if (_dom.activeSheetIcon) {
      _dom.activeSheetIcon.className = `fa-solid ${typeCfg.icon} gs-active-sheet-type-icon`;
      _dom.activeSheetIcon.style.color = typeCfg.color;
    }
    if (_dom.activeSheetTypeBadge) {
      _dom.activeSheetTypeBadge.textContent = typeCfg.label;
      _dom.activeSheetTypeBadge.className = `gs-type-badge gs-type-${tab.type || 'sheet'}`;
    }

    // Show/hide grid-specific features
    if (_dom.btnSyncData) {
      _dom.btnSyncData.style.display = isSpreadsheet ? 'inline-flex' : 'none';
    }
    if (_dom.tabViewGrid) {
      _dom.tabViewGrid.style.display = isSpreadsheet ? 'inline-flex' : 'none';
    }

    // Tags
    if (_dom.activeSheetTags) {
      _dom.activeSheetTags.innerHTML = (tab.tags || [])
        .map((t) => `<span class="gs-tag">${_escapeHtml(t)}</span>`)
        .join('');
    }

    _updateOpenStatusBadge(tab.id);
    _updateTreeSelection(tab.id);

    // Prepare Live Embed fallback
    if (_dom.liveFrame) {
      let embedUrl = 'about:blank';
      const docId = tab.spreadsheetId || tab.doc_id;
      if (tab.type === 'doc' && docId) {
        embedUrl = `https://docs.google.com/document/d/${docId}/preview`;
      } else if (tab.type === 'slide' && docId) {
        embedUrl = `https://docs.google.com/presentation/d/${docId}/embed`;
      } else if (tab.type === 'pdf') {
        embedUrl = tab.previewUrl || tab.url || 'about:blank';
      } else if (tab.type === 'task') {
        embedUrl = tab.url || 'about:blank';
      } else if (docId) {
        embedUrl = `https://docs.google.com/spreadsheets/d/${docId}/htmlembed?widget=true&headers=true` + (tab.gid ? `&gid=${tab.gid}` : '');
      }

      if (_dom.embedLoading) _dom.embedLoading.style.display = 'flex';
      _dom.liveFrame.onload = () => {
        if (_dom.embedLoading) _dom.embedLoading.style.display = 'none';
      };
      setTimeout(() => {
        if (_dom.embedLoading) _dom.embedLoading.style.display = 'none';
      }, 3500);
      _dom.liveFrame.src = embedUrl;
    }

    // Switch view mode and navigate native editor
    _switchViewMode(_currentViewMode);

    // Render interactive grid table (if spreadsheet)
    if (isSpreadsheet) {
      _renderSpreadsheetGrid(tab.gridData && tab.gridData.length > 0 ? tab.gridData : SAMPLE_DATA);
    }
    _setDirty(false);
  }

  function _updateTreeSelection(activeSheetId) {
    if (!_dom.projectTree) return;
    const items = _dom.projectTree.querySelectorAll('.gs-sheet-tree-item');
    items.forEach((item) => {
      const isSelected = Boolean(activeSheetId && item.dataset.sheetId === activeSheetId);
      item.classList.toggle('gs-selected', isSelected);
    });
  }

  function _bindEvents() {
    // Add Project trigger
    if (_dom.btnAddProject) {
      _dom.btnAddProject.addEventListener('click', () => openProjectDialog());
    }
    if (_dom.btnCancelProject) {
      _dom.btnCancelProject.addEventListener('click', closeProjectDialog);
    }
    if (_dom.btnSaveProject) {
      _dom.btnSaveProject.addEventListener('click', () => {
        const name = _dom.inputProjectName.value.trim();
        const color = _dom.inputProjectColor.value;
        const desc = _dom.inputProjectDesc.value.trim();
        if (!name) {
          alert('Vui lòng nhập tên dự án');
          return;
        }
        const editId = _dom.projectOverlay.dataset.editProjectId;
        if (editId) {
          window.GoogleSheetsManager.updateProject(editId, name, desc, color);
        } else {
          window.GoogleSheetsManager.createProject(name, desc, color);
        }
        closeProjectDialog();
      });
    }

    // Add Sheet dialog actions
    if (_dom.btnCancelSheet) {
      _dom.btnCancelSheet.addEventListener('click', closeSheetDialog);
    }
    if (_dom.btnSaveSheet) {
      _dom.btnSaveSheet.addEventListener('click', () => {
        const title = _dom.inputSheetTitle.value.trim();
        const url = _dom.inputSheetUrl.value.trim();
        const tags = _dom.inputSheetTags.value.split(',').map((t) => t.trim()).filter(Boolean);
        const notes = _dom.inputSheetNotes.value.trim();

        if (!title) {
          alert('Vui lòng nhập tiêu đề');
          return;
        }
        if (!url) {
          alert('Vui lòng nhập URL Google Sheets, Docs, Slides, Drive PDF hoặc Tasks');
          return;
        }

        const editSheetId = _dom.sheetOverlay.dataset.editSheetId;
        const targetProjId = _targetAddProjectId || (_cachedProjects[0] && _cachedProjects[0].id);

        if (editSheetId) {
          const sheetObj = window.GoogleSheetsManager.getSheetById(editSheetId);
          window.GoogleSheetsManager.updateSheet(sheetObj?.projectId || targetProjId, editSheetId, title, url, tags, notes);
        } else {
          window.GoogleSheetsManager.addSheet(targetProjId, title, url, tags, notes);
        }
        closeSheetDialog();
      });
    }

    // Live URL Validation on typing
    if (_dom.inputSheetUrl) {
      _dom.inputSheetUrl.addEventListener('input', (e) => {
        const raw = e.target.value.trim();
        clearTimeout(_urlDebounceTimer);
        if (!raw) {
          _dom.urlValidation.textContent = '';
          _dom.urlValidation.className = 'gs-validation-msg';
          return;
        }
        _urlDebounceTimer = setTimeout(async () => {
          if (window.pywebview && window.pywebview.api && window.pywebview.api.gs_validate_url) {
            const res = await window.pywebview.api.gs_validate_url(raw);
            if (res && res.success) {
              const typeName = res.data.type_name || 'Tài liệu Google';
              _dom.urlValidation.textContent = `✓ ${typeName} hợp lệ` + (res.data.gid ? ` (Tab gid: ${res.data.gid})` : '');
              _dom.urlValidation.className = 'gs-validation-msg gs-valid';
            } else {
              _dom.urlValidation.textContent = '✗ ' + (res?.error || 'URL không đúng định dạng Google Workspace (Sheets, Docs, Slides, PDF, Tasks)');
              _dom.urlValidation.className = 'gs-validation-msg gs-invalid';
            }
          }
        }, 250);
      });
    }

    // Search Input under Project Title
    if (_dom.searchInput) {
      _dom.searchInput.addEventListener('input', () => {
        const val = _dom.searchInput.value.trim();
        if (_dom.searchClearBtn) {
          _dom.searchClearBtn.style.display = val ? 'flex' : 'none';
        }
        applyFiltersAndRenderTree();
      });
    }

    if (_dom.searchClearBtn) {
      _dom.searchClearBtn.addEventListener('click', () => {
        if (_dom.searchInput) {
          _dom.searchInput.value = '';
          _dom.searchInput.focus();
        }
        _dom.searchClearBtn.style.display = 'none';
        applyFiltersAndRenderTree();
      });
    }

    // Topbar Actions
    if (_dom.btnOpenCompanionWin) {
      _dom.btnOpenCompanionWin.addEventListener('click', () => {
        if (_selectedSheet && window.GoogleSheetsTabs) {
          const projId = _selectedSheet.projectId || window.GoogleSheetsManager.findProjectIdBySheetId(_selectedSheet.id);
          window.GoogleSheetsTabs.openSheetWindow(projId, _selectedSheet.id);
        }
      });
    }

    if (_dom.btnOpenBrowser) {
      _dom.btnOpenBrowser.addEventListener('click', () => {
        if (_selectedSheet && _selectedSheet.url && window.GoogleSheetsTabs) {
          window.GoogleSheetsTabs.openInBrowser(_selectedSheet.url);
        }
      });
    }

    if (_dom.btnEditSheetMeta) {
      _dom.btnEditSheetMeta.addEventListener('click', () => {
        if (_selectedSheet) {
          openEditSheetDialog(_selectedSheet.id);
        }
      });
    }

    if (_dom.btnDeleteSheet) {
      _dom.btnDeleteSheet.addEventListener('click', () => {
        if (_selectedSheet) {
          confirmDeleteSheet(_selectedSheet.id, _selectedSheet.title, _selectedSheet.projectId);
        }
      });
    }

    // View Mode Switcher
    if (_dom.tabViewEditor) {
      _dom.tabViewEditor.addEventListener('click', () => _switchViewMode('editor'));
    }
    if (_dom.tabViewLive) {
      _dom.tabViewLive.addEventListener('click', () => _switchViewMode('live'));
    }
    if (_dom.tabViewGrid) {
      _dom.tabViewGrid.addEventListener('click', () => _switchViewMode('grid'));
    }
    if (_dom.btnSyncData) {
      _dom.btnSyncData.addEventListener('click', () => syncSheetData(true));
    }
    if (_dom.btnReloadEmbed) {
      _dom.btnReloadEmbed.addEventListener('click', () => {
        if (_currentViewMode === 'editor' && _selectedSheet) {
          _navigateNativeEditor(_selectedSheet);
        } else if (_dom.liveFrame && _dom.liveFrame.src) {
          if (_dom.embedLoading) _dom.embedLoading.style.display = 'flex';
          _dom.liveFrame.src = _dom.liveFrame.src;
        }
      });
    }

    // Window / visibility bounds synchronization
    window.addEventListener('resize', () => setTimeout(syncEditorHostBounds, 60));
    window.addEventListener('focus', () => setTimeout(syncEditorHostBounds, 80));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        setTimeout(syncEditorHostBounds, 80);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (_dom.sheetOverlay && _dom.sheetOverlay.classList.contains('gs-active')) {
          closeSheetDialog();
        } else if (_dom.projectOverlay && _dom.projectOverlay.classList.contains('gs-active')) {
          closeProjectDialog();
        }
      }
    });
  }

  // ─── Tag Filter Chips Bar ──────────────────────────────────────────────────

  function renderTagFilterBar(projects) {
    if (!_dom.tagFilterBar) return;

    // Collect all unique tags across all projects
    const tagSet = new Set();
    (projects || []).forEach((p) => {
      (p.sheets || []).forEach((s) => {
        (s.tags || []).forEach((t) => {
          const clean = (t || '').trim();
          if (clean) tagSet.add(clean);
        });
      });
    });

    const tags = Array.from(tagSet).sort();

    // If active tag filter no longer exists in sheets, reset to all
    if (_activeTagFilter && !tagSet.has(_activeTagFilter)) {
      _activeTagFilter = null;
    }

    _dom.tagFilterBar.innerHTML = '';

    // "Tất cả" chip
    const allChip = document.createElement('button');
    allChip.className = 'gs-tag-chip' + (_activeTagFilter === null ? ' gs-active' : '');
    allChip.textContent = 'Tất cả';
    allChip.title = 'Hiển thị tất cả Sheet';
    allChip.addEventListener('click', () => {
      _activeTagFilter = null;
      renderTagFilterBar(_cachedProjects);
      applyFiltersAndRenderTree();
    });
    _dom.tagFilterBar.appendChild(allChip);

    // Individual tag chips
    tags.forEach((tag) => {
      const chip = document.createElement('button');
      chip.className = 'gs-tag-chip' + (_activeTagFilter === tag ? ' gs-active' : '');
      chip.textContent = tag;
      chip.title = `Lọc Sheet có thẻ: #${tag}`;
      chip.addEventListener('click', () => {
        _activeTagFilter = (_activeTagFilter === tag) ? null : tag;
        renderTagFilterBar(_cachedProjects);
        applyFiltersAndRenderTree();
      });
      _dom.tagFilterBar.appendChild(chip);
    });
  }

  // ─── Grouped Project Tree Accordion ────────────────────────────────────────

  function renderProjectTree(projects) {
    _cachedProjects = projects || [];

    // By default on first load, expand all projects
    if (_expandedProjectIds.size === 0 && _cachedProjects.length > 0) {
      _cachedProjects.forEach((p) => _expandedProjectIds.add(p.id));
    }

    renderTagFilterBar(_cachedProjects);
    applyFiltersAndRenderTree();

    // If tabs are open, ensure active tab is highlighted in tree
    if (window.GoogleSheetTabsManager) {
      const activeTab = window.GoogleSheetTabsManager.getActiveTab();
      if (activeTab) {
        _updateTreeSelection(activeTab.id);
      }
    }
  }

  function applyFiltersAndRenderTree() {
    if (!_dom.projectTree) return;
    _dom.projectTree.innerHTML = '';

    if (!_cachedProjects || _cachedProjects.length === 0) {
      _dom.projectTree.innerHTML = `
        <div style="padding: 32px 16px; text-align: center; color: var(--gs-text-muted); font-size: 13px;">
          <i class="fa-solid fa-folder-open mb-2" style="font-size: 32px; opacity: 0.3;"></i>
          <div style="font-weight: 500;">Chưa có dự án nào</div>
          <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">Tạo dự án để bắt đầu quản lý danh sách Google Sheets.</div>
          <button class="gs-btn gs-btn-primary mt-3" style="font-size: 12px; margin: 12px auto 0;" onclick="GoogleSheetsView.openProjectDialog()">
            <i class="fa-solid fa-plus me-1"></i> Tạo dự án mới
          </button>
        </div>
      `;
      return;
    }

    const query = _dom.searchInput ? _dom.searchInput.value.trim().toLowerCase() : '';
    const hasFilter = Boolean(query || _activeTagFilter);
    let totalMatchingSheets = 0;

    _cachedProjects.forEach((p) => {
      let sheets = p.sheets || [];

      // Filter by Tag
      if (_activeTagFilter) {
        sheets = sheets.filter((s) => (s.tags || []).some((t) => t.toLowerCase() === _activeTagFilter.toLowerCase()));
      }

      // Filter by Search Query
      if (query) {
        const projNameMatch = (p.name || '').toLowerCase().includes(query);
        if (!projNameMatch) {
          sheets = sheets.filter((s) => {
            const titleMatch = (s.title || '').toLowerCase().includes(query);
            const notesMatch = (s.notes || '').toLowerCase().includes(query);
            const idMatch = (s.spreadsheetId || '').toLowerCase().includes(query);
            const gidMatch = (s.gid || '').toLowerCase().includes(query);
            const tagsMatch = (s.tags || []).some((t) => t.toLowerCase().includes(query));
            return titleMatch || notesMatch || idMatch || gidMatch || tagsMatch;
          });
        }
      }

      // If user is searching or filtering, automatically expand projects that have matches
      if (hasFilter && sheets.length > 0) {
        _expandedProjectIds.add(p.id);
      }

      // If filtering and project has no matching sheets, skip displaying empty project
      if (hasFilter && sheets.length === 0) {
        return;
      }

      totalMatchingSheets += sheets.length;
      const isExpanded = _expandedProjectIds.has(p.id);

      // Create Project Group Container
      const groupEl = document.createElement('div');
      groupEl.className = 'gs-proj-group' + (isExpanded ? ' gs-expanded' : '');
      groupEl.dataset.projectId = p.id;

      // Group Header
      const headerEl = document.createElement('div');
      headerEl.className = 'gs-proj-group-header';
      headerEl.title = `Nhấp để ${isExpanded ? 'thu gọn' : 'mở rộng'} dự án: ${p.name}`;

      headerEl.innerHTML = `
        <div class="gs-proj-group-title-wrap">
          <i class="fa-solid fa-chevron-right gs-proj-chevron"></i>
          <span class="gs-proj-color-dot" style="background-color: ${p.color || '#3B82F6'};"></span>
          <span class="gs-proj-name" title="${_escapeHtml(p.name)}">${_escapeHtml(p.name)}</span>
          <span class="gs-proj-count">(${sheets.length})</span>
        </div>
        <div class="gs-proj-group-actions">
          <button class="gs-btn-tree-action gs-btn-tree-add" title="Thêm Sheet mới vào dự án này">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="gs-btn-tree-action gs-btn-tree-more" title="Tùy chọn dự án">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      `;

      // Header click toggles expand/collapse
      headerEl.addEventListener('click', (e) => {
        if (e.target.closest('.gs-btn-tree-action')) return;
        toggleProjectGroup(p.id);
      });

      // Add Sheet to this project button
      const addBtn = headerEl.querySelector('.gs-btn-tree-add');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _targetAddProjectId = p.id;
          openSheetDialog(null, p.id);
        });
      }

      // Project options menu button
      const moreBtn = headerEl.querySelector('.gs-btn-tree-more');
      if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openProjectMenu(e, p.id, p.name, p.color);
        });
      }

      groupEl.appendChild(headerEl);

      // Sheets container
      const sheetsContainer = document.createElement('div');
      sheetsContainer.className = 'gs-proj-group-sheets';
      sheetsContainer.style.display = isExpanded ? 'block' : 'none';

      if (sheets.length === 0) {
        sheetsContainer.innerHTML = `
          <div class="gs-tree-empty-proj">
            <span>Chưa có Sheet nào.</span>
            <button class="gs-btn gs-btn-secondary" style="font-size: 11px; padding: 2px 8px; margin-left: 6px;" onclick="GoogleSheetsView.openSheetDialog(null, '${p.id}')">
              <i class="fa-solid fa-plus me-1"></i> Thêm Sheet
            </button>
          </div>
        `;
      } else {
        const activeTab = window.GoogleSheetTabsManager ? window.GoogleSheetTabsManager.getActiveTab() : null;

        sheets.forEach((s) => {
          const typeCfg = _getTypeConfig(s.type);
          const isSelected = Boolean(activeTab && activeTab.id === s.id);
          const itemEl = document.createElement('div');
          itemEl.className = 'gs-sheet-tree-item' + (isSelected ? ' gs-selected' : '');
          itemEl.dataset.sheetId = s.id;
          itemEl.dataset.projectId = p.id;

          itemEl.innerHTML = `
            <div class="gs-sheet-tree-left">
              <i class="fa-solid ${typeCfg.icon} gs-sheet-tree-icon" style="color: ${typeCfg.color};" title="${typeCfg.label}"></i>
              <div class="gs-sheet-tree-info">
                <div class="gs-sheet-tree-title" title="${_escapeHtml(s.title)}">
                  <span class="gs-sheet-tree-type-chip gs-type-${s.type || 'sheet'}">${typeCfg.label}</span>
                  ${_escapeHtml(s.title)}
                </div>
                <div class="gs-sheet-tree-meta">
                  ${s.gid ? `<span class="gs-sheet-tree-gid">gid: ${s.gid}</span>` : ''}
                  ${(s.tags && s.tags.length > 0) ? `<span class="gs-sheet-tree-tags">#${_escapeHtml(s.tags.slice(0, 2).join(' #'))}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="gs-sheet-tree-actions">
              <button class="gs-star-btn ${s.favorite ? 'gs-starred' : ''}" title="${s.favorite ? 'Bỏ yêu thích' : 'Ghim yêu thích'}" onclick="event.stopPropagation(); window.GoogleSheetsManager.toggleFavorite('${p.id}', '${s.id}')">
                <i class="fa-${s.favorite ? 'solid' : 'regular'} fa-star"></i>
              </button>
            </div>
          `;

          // Clicking sheet item opens tab
          itemEl.addEventListener('click', () => {
            if (window.GoogleSheetTabsManager) {
              window.GoogleSheetTabsManager.openTab(s, { id: p.id, name: p.name, color: p.color });
            }
          });

          sheetsContainer.appendChild(itemEl);
        });
      }

      groupEl.appendChild(sheetsContainer);
      _dom.projectTree.appendChild(groupEl);
    });

    // If searching and no results found anywhere
    if (hasFilter && totalMatchingSheets === 0) {
      _dom.projectTree.innerHTML = `
        <div style="padding: 24px 12px; text-align: center; color: var(--gs-text-muted); font-size: 12px;">
          <i class="fa-solid fa-magnifying-glass mb-2" style="font-size: 24px; opacity: 0.3;"></i>
          <div>Không tìm thấy Google Sheet nào khớp với bộ lọc</div>
        </div>
      `;
    }
  }

  function toggleProjectGroup(projectId) {
    if (_expandedProjectIds.has(projectId)) {
      _expandedProjectIds.delete(projectId);
    } else {
      _expandedProjectIds.add(projectId);
    }

    const groupEl = _dom.projectTree.querySelector(`.gs-proj-group[data-project-id="${projectId}"]`);
    if (groupEl) {
      const isExpanded = _expandedProjectIds.has(projectId);
      groupEl.classList.toggle('gs-expanded', isExpanded);
      const sheetsEl = groupEl.querySelector('.gs-proj-group-sheets');
      if (sheetsEl) {
        sheetsEl.style.display = isExpanded ? 'block' : 'none';
      }
    }
  }

  function expandProjectGroup(projectId) {
    _expandedProjectIds.add(projectId);
    applyFiltersAndRenderTree();
  }

  // ─── Native Editor Host Integration ───────────────────────────────────────

  function _initEditorResizeObserver() {
    if (_editorResizeObserver) {
      _editorResizeObserver.disconnect();
      _editorResizeObserver = null;
    }
    const target = _dom.nativeEditorWrap || _dom.editorAnchor;
    if (target && window.ResizeObserver) {
      _editorResizeObserver = new ResizeObserver(() => {
        if (_currentViewMode === 'editor' && _selectedSheet) {
          syncEditorHostBounds();
        }
      });
      _editorResizeObserver.observe(target);
    }
  }

  function syncEditorHostBounds(forceVisible = null) {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.gs_editor_host_set_bounds) {
      return;
    }

    const isDialogOpen = Boolean(
      (_dom.projectOverlay && _dom.projectOverlay.classList.contains('gs-active')) ||
      (_dom.sheetOverlay && _dom.sheetOverlay.classList.contains('gs-active'))
    );

    const shouldBeVisible = (forceVisible !== null)
      ? Boolean(forceVisible)
      : (_currentViewMode === 'editor' && _selectedSheet && !isDialogOpen && !_isResizing);

    if (!shouldBeVisible) {
      if (window.pywebview.api.gs_editor_host_set_visible) {
        window.pywebview.api.gs_editor_host_set_visible(false);
      }
      return;
    }

    const target = _dom.nativeEditorWrap || _dom.editorAnchor;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      if (window.pywebview.api.gs_editor_host_set_visible) {
        window.pywebview.api.gs_editor_host_set_visible(false);
      }
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    window.pywebview.api.gs_editor_host_set_bounds(x, y, w, h, true, dpr);
  }

  async function _navigateNativeEditor(sheet) {
    if (!sheet) return;
    const docId = sheet.spreadsheetId || sheet.doc_id;
    let targetUrl = sheet.url;

    if (sheet.type === 'doc' && docId) {
      targetUrl = `https://docs.google.com/document/d/${docId}/edit`;
    } else if (sheet.type === 'slide' && docId) {
      targetUrl = `https://docs.google.com/presentation/d/${docId}/edit`;
    } else if (sheet.type === 'pdf') {
      targetUrl = sheet.previewUrl || sheet.url;
    } else if (sheet.type === 'task') {
      targetUrl = sheet.url;
    } else if (docId) {
      targetUrl = `https://docs.google.com/spreadsheets/d/${docId}/edit` + (sheet.gid ? `#gid=${sheet.gid}` : '');
    }

    const typeCfg = _getTypeConfig(sheet.type);
    if (_dom.editorLoading) {
      _dom.editorLoading.style.display = 'flex';
      if (_dom.editorLoadingMsg) {
        _dom.editorLoadingMsg.textContent = sheet.type === 'pdf'
          ? 'Đang nạp tài liệu PDF trong chế độ xem (Chỉ đọc)...'
          : `Đang nạp trình chỉnh sửa Google ${typeCfg.label}...`;
      }
    }

    if (window.pywebview && window.pywebview.api && window.pywebview.api.gs_editor_host_navigate) {
      try {
        await window.pywebview.api.gs_editor_host_navigate(targetUrl);
        syncEditorHostBounds(true);
      } catch (err) {
        console.error('Failed to navigate native editor host:', err);
      }
    }

    setTimeout(() => {
      if (_dom.editorLoading) _dom.editorLoading.style.display = 'none';
      syncEditorHostBounds();
    }, 2200);
  }

  function _switchViewMode(mode) {
    _currentViewMode = (mode === 'live') ? 'live' : 'editor';
    const typeCfg = _getTypeConfig(_selectedSheet?.type);

    if (_currentViewMode === 'editor') {
      if (_dom.tabViewEditor) _dom.tabViewEditor.classList.add('gs-active');
      if (_dom.tabViewLive) _dom.tabViewLive.classList.remove('gs-active');
      if (_dom.nativeEditorWrap) _dom.nativeEditorWrap.style.display = 'flex';
      if (_dom.embedWrap) _dom.embedWrap.style.display = 'none';
      if (_dom.gridSaveStatus) {
        _dom.gridSaveStatus.textContent = _selectedSheet?.type === 'pdf'
          ? 'Tài liệu PDF (Chế độ xem Native - Chỉ đọc)'
          : `Trình chỉnh sửa Google ${typeCfg.label} chính thức`;
      }
      if (_selectedSheet) {
        _navigateNativeEditor(_selectedSheet);
      }
      syncEditorHostBounds(true);
    } else {
      if (_dom.tabViewLive) _dom.tabViewLive.classList.add('gs-active');
      if (_dom.tabViewEditor) _dom.tabViewEditor.classList.remove('gs-active');
      if (_dom.nativeEditorWrap) _dom.nativeEditorWrap.style.display = 'none';
      if (_dom.embedWrap) _dom.embedWrap.style.display = 'block';
      if (_dom.gridSaveStatus) {
        _dom.gridSaveStatus.textContent = _selectedSheet?.type === 'pdf'
          ? 'Tài liệu PDF (Chế độ xem Web Preview)'
          : `Chế độ xem tĩnh Google ${typeCfg.label} (Preview Web)`;
      }
      syncEditorHostBounds(false);
    }
  }

  function _updateOpenStatusBadge(sheetId) {
    if (_dom.activeSheetOpenBadge && window.GoogleSheetsTabs) {
      const isOpen = window.GoogleSheetsTabs.isOpen(sheetId);
      _dom.activeSheetOpenBadge.style.display = isOpen ? 'inline-block' : 'none';
      if (_dom.btnOpenCompanionWin) {
        _dom.btnOpenCompanionWin.innerHTML = isOpen
          ? '<i class="fa-solid fa-arrow-up-right-from-square"></i> <span>Chuyển Đến Cửa Sổ</span>'
          : '<i class="fa-solid fa-arrow-up-right-from-square"></i> <span>Mở Cửa Sổ Mới</span>';
      }
    }
  }

  // ─── Interactive Grid Table Builder ──────────────────────────────────────

  function _renderSpreadsheetGrid(dataRows) {
    if (!_dom.tableHead || !_dom.tableBody) return;

    _dom.tableHead.innerHTML = '';
    const headerTr = document.createElement('tr');
    
    const cornerTh = document.createElement('th');
    cornerTh.className = 'gs-row-num';
    cornerTh.textContent = '';
    headerTr.appendChild(cornerTh);

    const numCols = Math.max(DEFAULT_GRID_COLS, (dataRows[0] || []).length);
    for (let c = 0; c < numCols; c++) {
      const colLetter = String.fromCharCode(65 + c);
      const th = document.createElement('th');
      th.textContent = colLetter;
      th.style.width = c === 1 || c === 6 ? '180px' : '120px';
      headerTr.appendChild(th);
    }
    _dom.tableHead.appendChild(headerTr);

    _dom.tableBody.innerHTML = '';
    const numRows = Math.max(DEFAULT_GRID_ROWS, dataRows.length);

    for (let r = 0; r < numRows; r++) {
      const tr = document.createElement('tr');

      const rowNumTd = document.createElement('td');
      rowNumTd.className = 'gs-row-num';
      rowNumTd.textContent = r + 1;
      tr.appendChild(rowNumTd);

      const rowValues = dataRows[r] || [];

      for (let c = 0; c < numCols; c++) {
        const td = document.createElement('td');
        const cellValue = rowValues[c] !== undefined ? rowValues[c] : '';
        td.textContent = cellValue;
        td.contentEditable = 'true';
        td.dataset.row = r + 1;
        td.dataset.col = c;

        if (r === 0 && rowValues.length > 0) {
          td.classList.add('gs-header-cell');
        }

        td.addEventListener('focus', () => _onCellSelect(td));
        td.addEventListener('input', () => {
          _setDirty(true);
          if (_dom.formulaInput) _dom.formulaInput.value = td.textContent;
        });

        tr.appendChild(td);
      }

      _dom.tableBody.appendChild(tr);
    }

    const firstCell = _dom.tableBody.querySelector('td[data-row="1"][data-col="0"]');
    if (firstCell) {
      _onCellSelect(firstCell);
    }
  }

  function _onCellSelect(td) {
    if (_selectedCell) {
      _selectedCell.classList.remove('gs-active-cell');
    }
    _selectedCell = td;
    td.classList.add('gs-active-cell');

    const colLetter = String.fromCharCode(65 + Number(td.dataset.col));
    const coord = `${colLetter}${td.dataset.row}`;
    if (_dom.cellCoords) _dom.cellCoords.textContent = coord;
    if (_dom.formulaInput) _dom.formulaInput.value = td.textContent;
  }

  function _setDirty(isDirty) {
    _dirty = isDirty;
    if (_dom.gridSaveStatus) {
      _dom.gridSaveStatus.textContent = isDirty
        ? 'Có thay đổi chưa lưu (bấm "Lưu bảng" để lưu trực tiếp)'
        : 'Chế độ xem & chỉnh trực tiếp trong IDE';
    }
    if (_dom.btnSaveDraft) {
      _dom.btnSaveDraft.style.backgroundColor = isDirty ? 'var(--gs-green)' : 'rgba(16, 185, 129, 0.15)';
      _dom.btnSaveDraft.style.color = isDirty ? '#fff' : '#34D399';
      if (_dom.saveDraftLabel) _dom.saveDraftLabel.textContent = isDirty ? 'Lưu thay đổi *' : 'Đã lưu';
    }
  }

  async function syncSheetData(showAlert = true) {
    if (!_selectedSheet) return;
    const projId = _selectedSheet.projectId || window.GoogleSheetsManager.findProjectIdBySheetId(_selectedSheet.id);
    if (!projId) return;

    if (_dom.btnSyncData) {
      _dom.btnSyncData.disabled = true;
      _dom.btnSyncData.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Đang tải dữ liệu...';
    }

    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.gs_fetch_sheet_data) {
        const res = await window.pywebview.api.gs_fetch_sheet_data(projId, _selectedSheet.id);
        if (res && res.success && res.gridData) {
          _selectedSheet.gridData = res.gridData;
          _renderSpreadsheetGrid(res.gridData);
          _switchViewMode('grid');
          return;
        } else if (showAlert) {
          alert('Không thể tải CSV từ Google Sheets:\n' + (res?.error || 'Vui lòng kiểm tra quyền chia sẻ link Google Sheets.'));
        }
      }
    } catch (err) {
      console.error('Error fetching sheet data:', err);
      if (showAlert) alert('Lỗi kết nối tải dữ liệu: ' + err.message);
    } finally {
      if (_dom.btnSyncData) {
        _dom.btnSyncData.disabled = false;
        _dom.btnSyncData.innerHTML = '<i class="fa-solid fa-cloud-arrow-down me-1"></i> Tải dữ liệu về Grid';
      }
    }
  }

  async function saveDirectGridData() {
    if (!_selectedSheet) return;
    const projId = _selectedSheet.projectId || window.GoogleSheetsManager.findProjectIdBySheetId(_selectedSheet.id);
    if (!projId) return;

    const rows = [];
    const trs = _dom.tableBody.querySelectorAll('tr');
    trs.forEach((tr) => {
      const rowData = [];
      let hasContent = false;
      const tds = tr.querySelectorAll('td[data-col]');
      tds.forEach((td) => {
        const text = td.textContent.trim();
        rowData.push(text);
        if (text) hasContent = true;
      });
      if (hasContent || rows.length < 10) {
        rows.push(rowData);
      }
    });

    _selectedSheet.gridData = rows;

    if (window.pywebview && window.pywebview.api && window.pywebview.api.gs_save_sheet_grid) {
      try {
        const res = await window.pywebview.api.gs_save_sheet_grid(projId, _selectedSheet.id, rows);
        if (res && res.success) {
          _setDirty(false);
          if (_dom.saveDraftLabel) _dom.saveDraftLabel.textContent = '✓ Đã lưu';
          setTimeout(() => {
            if (_dom.saveDraftLabel) _dom.saveDraftLabel.textContent = 'Lưu bảng';
          }, 2000);
        } else {
          alert('Không thể lưu bảng tính: ' + (res?.error || 'Lỗi không xác định'));
        }
      } catch (err) {
        console.error('Error saving grid data:', err);
      }
    }
  }

  // ─── Dialogs ──────────────────────────────────────────────────────────────

  function openProjectDialog(editProject = null) {
    syncEditorHostBounds(false);
    document.getElementById('gs-dialog-project-title').textContent = editProject ? 'Chỉnh Sửa Dự Án' : 'Thêm Dự Án Mới';
    _dom.inputProjectName.value = editProject ? editProject.name : '';
    _dom.inputProjectColor.value = editProject ? editProject.color : '#3B82F6';
    _dom.inputProjectDesc.value = editProject ? editProject.description || '' : '';
    _dom.projectOverlay.dataset.editProjectId = editProject ? editProject.id : '';
    _dom.projectOverlay.classList.add('gs-active');
    _dom.inputProjectName.focus();
  }

  function closeProjectDialog() {
    _dom.projectOverlay.classList.remove('gs-active');
    syncEditorHostBounds();
  }

  function openSheetDialog(editSheet = null, targetProjectId = null) {
    syncEditorHostBounds(false);
    _targetAddProjectId = targetProjectId || (editSheet && editSheet.projectId) || null;
    document.getElementById('gs-dialog-sheet-title').textContent = editSheet ? 'Chỉnh Sửa Tài Liệu / Sheet' : 'Thêm Google Sheet / Tài Liệu Mới';
    _dom.inputSheetTitle.value = editSheet ? editSheet.title : '';
    _dom.inputSheetUrl.value = editSheet ? editSheet.url : '';
    _dom.inputSheetTags.value = editSheet && editSheet.tags ? editSheet.tags.join(', ') : '';
    _dom.inputSheetNotes.value = editSheet ? editSheet.notes || '' : '';
    _dom.urlValidation.textContent = '';
    _dom.urlValidation.className = 'gs-validation-msg';
    _dom.sheetOverlay.dataset.editSheetId = editSheet ? editSheet.id : '';
    _dom.sheetOverlay.classList.add('gs-active');
    _dom.inputSheetTitle.focus();
  }

  function closeSheetDialog() {
    _dom.sheetOverlay.classList.remove('gs-active');
    syncEditorHostBounds();
  }

  function openEditSheetDialog(sheetId) {
    const sheet = window.GoogleSheetsManager.getSheetById(sheetId);
    if (sheet) {
      openSheetDialog(sheet, sheet.projectId);
    }
  }

  function confirmDeleteSheet(sheetId, title, projectId = null) {
    if (confirm(`Bạn có chắc chắn muốn xóa Sheet "${title}" không?`)) {
      window.GoogleSheetsManager.removeSheet(projectId, sheetId);
    }
  }

  // ─── Sidebar Resizer & Toggle ─────────────────────────────────────────────

  function _initSidebarResizer() {
    if (!_dom.resizer || !_dom.leftPanel) return;

    const savedWidth = localStorage.getItem('gs-sidebar-width');
    if (savedWidth) {
      const w = parseInt(savedWidth, 10);
      if (!isNaN(w) && w >= 240 && w <= 850) {
        _dom.leftPanel.style.width = `${w}px`;
      }
    }

    _dom.resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _isResizing = true;
      syncEditorHostBounds(false);
      _dom.resizer.classList.add('gs-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      if (_dom.liveFrame) {
        _dom.liveFrame.style.pointerEvents = 'none';
      }

      function onMouseMove(moveEvent) {
        if (!_isResizing) return;
        const bodyRect = _dom.appContainer ? _dom.appContainer.getBoundingClientRect() : document.body.getBoundingClientRect();
        const newWidth = moveEvent.clientX - bodyRect.left;
        if (newWidth >= 240 && newWidth <= 850) {
          _dom.leftPanel.style.width = `${newWidth}px`;
        }
      }

      function onMouseUp() {
        if (!_isResizing) return;
        _isResizing = false;
        _dom.resizer.classList.remove('gs-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (_dom.liveFrame) {
          _dom.liveFrame.style.pointerEvents = '';
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        const finalWidth = parseInt(_dom.leftPanel.style.width, 10);
        if (!isNaN(finalWidth)) {
          localStorage.setItem('gs-sidebar-width', finalWidth);
        }
        syncEditorHostBounds();
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  function _initSidebarToggle() {
    const isCollapsed = localStorage.getItem('gs-sidebar-collapsed') === 'true';
    if (isCollapsed && _dom.appContainer) {
      _dom.appContainer.classList.add('gs-sidebar-collapsed');
    }

    function toggleSidebar() {
      if (!_dom.appContainer) return;
      const collapsed = _dom.appContainer.classList.toggle('gs-sidebar-collapsed');
      localStorage.setItem('gs-sidebar-collapsed', collapsed);
      if (_dom.btnToggleSidebar) {
        _dom.btnToggleSidebar.title = collapsed ? 'Hiện danh sách kết nối & Sheet (Ctrl+B)' : 'Ẩn danh sách kết nối & Sheet (Ctrl+B)';
      }
      setTimeout(syncEditorHostBounds, 80);
      setTimeout(syncEditorHostBounds, 250);
    }

    if (_dom.btnToggleSidebar) {
      _dom.btnToggleSidebar.addEventListener('click', toggleSidebar);
    }
    if (_dom.btnUncollapseSidebar) {
      _dom.btnUncollapseSidebar.addEventListener('click', toggleSidebar);
    }
    if (_dom.btnUncollapseSidebarEmpty) {
      _dom.btnUncollapseSidebarEmpty.addEventListener('click', toggleSidebar);
    }

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleSidebar();
      }
    });
  }

  // ─── Floating Dropdown Menu ───────────────────────────────────────────────

  function _initDropdownMenu() {
    if (!_dom.projectDropdownMenu) return;

    if (_dom.menuEditProject) {
      _dom.menuEditProject.addEventListener('click', () => {
        if (_activeMenuProject) {
          openProjectDialog({ id: _activeMenuProject.id, name: _activeMenuProject.name, color: _activeMenuProject.color });
        }
        closeProjectMenu();
      });
    }

    if (_dom.menuAddSheetToProject) {
      _dom.menuAddSheetToProject.addEventListener('click', () => {
        if (_activeMenuProject) {
          _targetAddProjectId = _activeMenuProject.id;
          openSheetDialog(null, _activeMenuProject.id);
        }
        closeProjectMenu();
      });
    }

    if (_dom.menuDeleteProject) {
      _dom.menuDeleteProject.addEventListener('click', () => {
        if (_activeMenuProject) {
          if (confirm(`Xác nhận xóa dự án "${_activeMenuProject.name}" và toàn bộ danh sách sheet bên trong?`)) {
            window.GoogleSheetsManager.deleteProject(_activeMenuProject.id);
          }
        }
        closeProjectMenu();
      });
    }

    window.addEventListener('click', (e) => {
      if (_dom.projectDropdownMenu && _dom.projectDropdownMenu.style.display !== 'none') {
        if (!e.target.closest('#gs-project-dropdown-menu') && !e.target.closest('.gs-btn-tree-more')) {
          closeProjectMenu();
        }
      }
    });
  }

  function openProjectMenu(event, projectId, name, color) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    _activeMenuProject = { id: projectId, name, color };
    const menu = _dom.projectDropdownMenu || document.getElementById('gs-project-dropdown-menu');
    if (!menu) return;

    menu.style.display = 'flex';

    if (event && event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      const menuWidth = 195;
      const leftPos = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
      menu.style.left = `${leftPos}px`;
      menu.style.top = `${rect.bottom + 4}px`;
    }
  }

  function closeProjectMenu() {
    const menu = _dom.projectDropdownMenu || document.getElementById('gs-project-dropdown-menu');
    if (menu) {
      menu.style.display = 'none';
    }
  }

  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Compatibility Fallbacks ──────────────────────────────────────────────

  function renderProjects(projects) {
    renderProjectTree(projects);
  }

  function renderSheetList(sheets) {
    // Kept for backward compatibility
  }

  function selectSheet(sheet) {
    if (window.GoogleSheetTabsManager && sheet) {
      window.GoogleSheetTabsManager.openTab(sheet);
    }
  }

  function showModal() {
    // Standalone window doesn't require modal toggle
  }

  function hideModal() {}

  function isVisible() {
    return Boolean(document.getElementById('gs-app-container'));
  }

  return {
    init,
    showModal,
    hideModal,
    isVisible,
    renderProjectTree,
    renderTagFilterBar,
    applyFiltersAndRenderTree,
    toggleProjectGroup,
    expandProjectGroup,
    renderProjects,
    renderSheetList,
    selectSheet,
    openProjectDialog,
    openSheetDialog,
    openEditSheetDialog,
    confirmDeleteSheet,
    openProjectMenu,
    closeProjectMenu,
    saveDirectGridData,
    syncSheetData,
    syncEditorHostBounds,
  };
})();
