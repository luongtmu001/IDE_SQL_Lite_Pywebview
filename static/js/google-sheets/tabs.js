/**
 * Google Sheets Tabs & Companion Window Coordinator.
 * Coordinates opening WebView2 companion subwindows, checking active state, and browser fallback.
 */

window.GoogleSheetsTabs = (function () {
  'use strict';

  let _openSheetIds = new Set();
  let _listeners = [];

  function subscribe(fn) {
    if (typeof fn === 'function') {
      _listeners.push(fn);
    }
  }

  function notify() {
    _listeners.forEach((fn) => {
      try {
        fn(Array.from(_openSheetIds));
      } catch (err) {
        console.error('[GSTabs] Listener error:', err);
      }
    });
  }

  async function syncOpenStatus() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.gs_get_open_sheet_ids) {
      return;
    }
    try {
      const res = await window.pywebview.api.gs_get_open_sheet_ids();
      if (res && res.success && Array.isArray(res.openSheetIds)) {
        _openSheetIds = new Set(res.openSheetIds);
        notify();
      }
    } catch (err) {
      console.warn('[GSTabs] Failed to sync open sheet status:', err);
    }
  }

  async function openSheetWindow(projectId, sheetId) {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.gs_open_sheet_window) {
      alert('pywebview API chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
      return;
    }

    try {
      const res = await window.pywebview.api.gs_open_sheet_window(projectId, sheetId);
      if (res && res.success) {
        _openSheetIds.add(sheetId);
        notify();
      } else {
        alert('Không thể mở cửa sổ Google Sheets: ' + (res?.error || 'Lỗi không xác định'));
      }
      return res;
    } catch (err) {
      console.error('[GSTabs] openSheetWindow error:', err);
      alert('Lỗi gọi API mở Sheet: ' + err.message);
    }
  }

  async function closeSheetWindow(sheetId) {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.gs_close_sheet_window) {
      return;
    }
    try {
      await window.pywebview.api.gs_close_sheet_window(sheetId);
      _openSheetIds.delete(sheetId);
      notify();
    } catch (err) {
      console.error('[GSTabs] closeSheetWindow error:', err);
    }
  }

  async function openInBrowser(url) {
    if (!url) return;
    if (window.pywebview && window.pywebview.api && window.pywebview.api.gs_open_in_browser) {
      try {
        await window.pywebview.api.gs_open_in_browser(url);
        return;
      } catch (err) {
        console.warn('[GSTabs] pywebview browser open failed, falling back:', err);
      }
    }
    window.open(url, '_blank');
  }

  function isOpen(sheetId) {
    return _openSheetIds.has(sheetId);
  }

  return {
    openSheetWindow,
    closeSheetWindow,
    openInBrowser,
    isOpen,
    syncOpenStatus,
    subscribe,
  };
})();
