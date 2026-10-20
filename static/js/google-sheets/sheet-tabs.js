/**
 * Google Sheet Tabs Manager.
 * Handles independent Tab management inside the Google Sheets Workspace window.
 * Strictly isolated from the IDE's main tabs system.
 */

window.GoogleSheetTabsManager = (function () {
  'use strict';

  const STORAGE_KEY_TABS = 'gs_open_tabs';
  const STORAGE_KEY_ACTIVE = 'gs_active_tab_id';

  let _openTabs = [];
  let _activeTabId = null;
  let _listeners = [];
  let _domScroll = null;
  let _domBar = null;
  let _domAddBtn = null;

  function init() {
    _domBar = document.getElementById('gs-sheet-tabs-bar');
    _domScroll = document.getElementById('gs-sheet-tabs-scroll');
    _domAddBtn = document.getElementById('gs-btn-tabs-add');

    if (_domAddBtn) {
      _domAddBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.GoogleSheetsView && typeof window.GoogleSheetsView.openSheetDialog === 'function') {
          window.GoogleSheetsView.openSheetDialog();
        }
      });
    }

    _loadState();
    renderTabs();
  }

  function _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TABS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          _openTabs = parsed.filter((t) => t && t.id);
        }
      }
      const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (savedActive && _openTabs.some((t) => t.id === savedActive)) {
        _activeTabId = savedActive;
      } else if (_openTabs.length > 0) {
        _activeTabId = _openTabs[0].id;
      } else {
        _activeTabId = null;
      }
    } catch (err) {
      console.warn('[GSTabsManager] Failed to load state:', err);
      _openTabs = [];
      _activeTabId = null;
    }
  }

  function _saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(_openTabs));
      if (_activeTabId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE, _activeTabId);
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE);
      }
    } catch (err) {
      console.warn('[GSTabsManager] Failed to save state:', err);
    }
  }

  function onTabChange(callback) {
    if (typeof callback === 'function') {
      _listeners.push(callback);
    }
  }

  function _notify() {
    const activeTab = getActiveTab();
    const tabs = [..._openTabs];
    _listeners.forEach((fn) => {
      try {
        fn(activeTab, tabs);
      } catch (err) {
        console.error('[GSTabsManager] Listener error:', err);
      }
    });
  }

  function getTypeConfig(type) {
    switch (type) {
      case 'doc':
        return { icon: 'fa-file-lines', color: '#3B82F6', label: 'Docs' };
      case 'slide':
        return { icon: 'fa-file-powerpoint', color: '#F59E0B', label: 'Slide' };
      case 'pdf':
        return { icon: 'fa-file-pdf', color: '#EF4444', label: 'PDF' };
      case 'task':
        return { icon: 'fa-square-check', color: '#8B5CF6', label: 'Tasks' };
      case 'sheet':
      default:
        return { icon: 'fa-table-cells', color: '#10B981', label: 'Sheet' };
    }
  }

  function openTab(sheet, projectMeta = null) {
    if (!sheet || !sheet.id) return;

    let existing = _openTabs.find((t) => t.id === sheet.id);
    if (!existing) {
      const tabData = {
        id: sheet.id,
        title: sheet.title || 'Untitled',
        type: sheet.type || 'sheet',
        spreadsheetId: sheet.spreadsheetId || sheet.doc_id || '',
        gid: sheet.gid || '0',
        url: sheet.url || '',
        previewUrl: sheet.previewUrl || sheet.url || '',
        readOnly: Boolean(sheet.readOnly || sheet.type === 'pdf'),
        tags: Array.isArray(sheet.tags) ? sheet.tags : [],
        notes: sheet.notes || '',
        favorite: Boolean(sheet.favorite),
        projectId: projectMeta?.id || sheet.projectId || null,
        projectName: projectMeta?.name || sheet.projectName || 'Dự án',
        projectColor: projectMeta?.color || sheet.projectColor || '#3B82F6',
      };
      _openTabs.push(tabData);
      existing = tabData;
    } else {
      // Refresh dynamic meta if provided
      if (sheet.title) existing.title = sheet.title;
      if (sheet.type) existing.type = sheet.type;
      if (sheet.url) existing.url = sheet.url;
      if (sheet.previewUrl) existing.previewUrl = sheet.previewUrl;
      if (sheet.readOnly !== undefined) existing.readOnly = sheet.readOnly;
      if (sheet.gid) existing.gid = sheet.gid;
      if (sheet.tags) existing.tags = sheet.tags;
      if (sheet.favorite !== undefined) existing.favorite = sheet.favorite;
      if (projectMeta?.name) existing.projectName = projectMeta.name;
      if (projectMeta?.color) existing.projectColor = projectMeta.color;
    }

    _activeTabId = sheet.id;
    _saveState();
    renderTabs();
    _notify();
  }

  function switchTab(sheetId) {
    if (_activeTabId === sheetId) return;
    const found = _openTabs.find((t) => t.id === sheetId);
    if (!found) return;

    _activeTabId = sheetId;
    _saveState();
    renderTabs();
    _notify();
  }

  function closeTab(sheetId, event = null) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const idx = _openTabs.findIndex((t) => t.id === sheetId);
    if (idx === -1) return;

    const wasActive = (_activeTabId === sheetId);
    _openTabs.splice(idx, 1);

    if (wasActive) {
      if (_openTabs.length > 0) {
        // Choose next tab, or previous if closed last item
        const nextIdx = Math.min(idx, _openTabs.length - 1);
        _activeTabId = _openTabs[nextIdx].id;
      } else {
        _activeTabId = null;
      }
    }

    _saveState();
    renderTabs();
    _notify();
  }

  function closeOtherTabs(keepSheetId) {
    _openTabs = _openTabs.filter((t) => t.id === keepSheetId);
    _activeTabId = keepSheetId;
    _saveState();
    renderTabs();
    _notify();
  }

  function closeAllTabs() {
    _openTabs = [];
    _activeTabId = null;
    _saveState();
    renderTabs();
    _notify();
  }

  function updateSheetMeta(sheetId, updated) {
    const tab = _openTabs.find((t) => t.id === sheetId);
    if (!tab) return;

    Object.assign(tab, updated);
    _saveState();
    renderTabs();
  }

  function getActiveTab() {
    if (!_activeTabId) return null;
    return _openTabs.find((t) => t.id === _activeTabId) || null;
  }

  function getOpenTabs() {
    return [..._openTabs];
  }

  function isOpen(sheetId) {
    return _openTabs.some((t) => t.id === sheetId);
  }

  function renderTabs() {
    if (!_domBar) {
      _domBar = document.getElementById('gs-sheet-tabs-bar');
      _domScroll = document.getElementById('gs-sheet-tabs-scroll');
    }
    if (!_domBar || !_domScroll) return;

    if (_openTabs.length === 0) {
      _domBar.style.display = 'none';
      _domScroll.innerHTML = '';
      return;
    }

    _domBar.style.display = 'flex';
    _domScroll.innerHTML = '';

    _openTabs.forEach((tab) => {
      const isActive = (tab.id === _activeTabId);
      const typeCfg = getTypeConfig(tab.type);
      const tabEl = document.createElement('div');
      tabEl.className = 'gs-sheet-tab' + (isActive ? ' gs-tab-active' : '');
      tabEl.dataset.sheetId = tab.id;
      tabEl.title = `[${typeCfg.label}] ${tab.title} (${tab.projectName || 'Dự án'})\nNhấp chuột giữa để đóng`;

      // Project indicator dot
      const dotColor = tab.projectColor || typeCfg.color;

      tabEl.innerHTML = `
        <span class="gs-sheet-tab-dot" style="background-color: ${dotColor};"></span>
        <i class="fa-solid ${typeCfg.icon} gs-sheet-tab-icon" style="color: ${typeCfg.color};"></i>
        <span class="gs-sheet-tab-title">${_escapeHtml(tab.title)}</span>
        <button class="gs-sheet-tab-close" title="Đóng tab (Ctrl+W)">
          <i class="fa-solid fa-xmark"></i>
        </button>
      `;

      // Click to switch
      tabEl.addEventListener('click', (e) => {
        if (e.target.closest('.gs-sheet-tab-close')) return;
        switchTab(tab.id);
      });

      // Middle click to close
      tabEl.addEventListener('mouseup', (e) => {
        if (e.button === 1) { // Middle click
          e.preventDefault();
          closeTab(tab.id);
        }
      });

      // Close button
      const closeBtn = tabEl.querySelector('.gs-sheet-tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          closeTab(tab.id, e);
        });
      }

      _domScroll.appendChild(tabEl);
    });

    // Ensure active tab is scrolled into view smoothly
    const activeEl = _domScroll.querySelector('.gs-sheet-tab.gs-tab-active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  function _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    init,
    openTab,
    closeTab,
    switchTab,
    closeAllTabs,
    closeOtherTabs,
    updateSheetMeta,
    getActiveTab,
    getOpenTabs,
    isOpen,
    renderTabs,
    onTabChange,
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.GoogleSheetTabsManager.init());
} else {
  window.GoogleSheetTabsManager.init();
}
