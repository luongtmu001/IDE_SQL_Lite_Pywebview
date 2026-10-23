/**
 * Google Sheets Manager Controller.
 * Manages projects/sheets state and coordinates bridge communications with Python.
 */

window.GoogleSheetsManager = (function () {
  'use strict';

  let _projects = [];
  let _activeProjectId = null;
  let _currentProjectData = null;

  async function init() {
    GoogleSheetsView.init();
    _bindGlobalTriggers();
    await loadInitialData();
  }

  function _bindGlobalTriggers() {
    // Toolbar button trigger
    const navBtn = document.getElementById('ide-google-sheets-btn');
    if (navBtn && !navBtn._gsBound) {
      navBtn._gsBound = true;
      navBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openManager();
      });
    }

    // View menu trigger
    const menuBtn = document.getElementById('ide-menu-google-sheets');
    if (menuBtn && !menuBtn._gsBound) {
      menuBtn._gsBound = true;
      menuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openManager();
      });
    }

    // Subwindow standalone refresh button
    const refreshBtn = document.getElementById('gs-btn-refresh-workspace');
    if (refreshBtn && !refreshBtn._gsBound) {
      refreshBtn._gsBound = true;
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        refresh();
      });
    }

    // Keyboard shortcut Ctrl+Alt+G
    if (!window._gsKeydownBound) {
      window._gsKeydownBound = true;
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'g' || e.key === 'G')) {
          e.preventDefault();
          openManager();
        }
      });
    }
  }

  async function openManager() {
    if (window._isOpeningSheets) return;
    window._isOpeningSheets = true;
    setTimeout(() => { window._isOpeningSheets = false; }, 1500);

    if (window.AppLoader) window.AppLoader.show('Đang mở Google Sheets Manager...');
    try {
      // 1. In native PyWebView desktop environment: open a new dedicated subwindow
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.gs_open_manager_window === 'function') {
        const res = await window.pywebview.api.gs_open_manager_window();
        if (res && res.success) {
          return;
        }
      }
    } catch (err) {
      console.warn('[GSManager] gs_open_manager_window error:', err);
    } finally {
      setTimeout(() => { if (window.AppLoader) window.AppLoader.hide(); }, 600);
    }

    // 2. Fallback: only if pywebview native subwindow manager is unavailable
    if (typeof GoogleSheetsView.showModal === 'function') {
      GoogleSheetsView.showModal();
    }
    await refresh();
  }

  async function loadInitialData() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.gs_list_projects) {
      // Wait for pywebview ready event
      window.addEventListener('pywebviewready', () => refresh(), { once: true });
      return;
    }
    await refresh();
  }

  async function refresh() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.gs_list_projects) {
      return;
    }

    try {
      // 1. Load workspace state to remember last opened project
      const wsRes = await window.pywebview.api.gs_get_workspace();
      const lastProjId = wsRes?.workspace?.lastProjectId;

      // 2. Load all projects (now includes sheets array)
      const projRes = await window.pywebview.api.gs_list_projects();
      if (projRes && projRes.success) {
        _projects = projRes.projects || [];
        if (_projects.length > 0) {
          _activeProjectId = (_activeProjectId && _projects.some((p) => p.id === _activeProjectId))
            ? _activeProjectId
            : (lastProjId && _projects.some((p) => p.id === lastProjId))
              ? lastProjId
              : _projects[0].id;
          _currentProjectData = _projects.find((p) => p.id === _activeProjectId) || _projects[0];
        } else {
          _activeProjectId = null;
          _currentProjectData = null;
        }

        // Render Grouped Tree in View
        GoogleSheetsView.renderProjectTree(_projects);

        // Notify open tabs of any project/sheet metadata updates
        _syncTabsWithProjects();
      }
    } catch (err) {
      console.error('[GSManager] refresh failed:', err);
    }
  }

  function _syncTabsWithProjects() {
    if (!window.GoogleSheetTabsManager) return;
    const openTabs = window.GoogleSheetTabsManager.getOpenTabs();
    openTabs.forEach((tab) => {
      // Find updated sheet across projects
      for (const p of _projects) {
        const found = (p.sheets || []).find((s) => s.id === tab.id);
        if (found) {
          window.GoogleSheetTabsManager.updateSheetMeta(tab.id, {
            title: found.title,
            url: found.url,
            spreadsheetId: found.spreadsheetId,
            gid: found.gid,
            tags: found.tags,
            favorite: found.favorite,
            notes: found.notes,
            projectId: p.id,
            projectName: p.name,
            projectColor: p.color,
          });
          break;
        }
      }
    });
  }

  async function selectProject(projectId) {
    _activeProjectId = projectId;
    _currentProjectData = _projects.find((p) => p.id === projectId) || null;
    if (window.pywebview && window.pywebview.api && window.pywebview.api.gs_save_workspace) {
      window.pywebview.api.gs_save_workspace(projectId, null);
    }
  }

  async function createProject(name, description, color) {
    try {
      const res = await window.pywebview.api.gs_create_project(name, description, color);
      if (res && res.success) {
        await refresh();
        if (res.project?.id) {
          _activeProjectId = res.project.id;
          if (typeof GoogleSheetsView.expandProjectGroup === 'function') {
            GoogleSheetsView.expandProjectGroup(res.project.id);
          }
        }
      } else {
        alert('Lỗi tạo dự án: ' + (res?.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('[GSManager] createProject failed:', err);
    }
  }

  async function updateProject(projectId, name, description, color) {
    try {
      const res = await window.pywebview.api.gs_update_project(projectId, name, description, color);
      if (res && res.success) {
        await refresh();
      } else {
        alert('Lỗi cập nhật dự án: ' + (res?.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('[GSManager] updateProject failed:', err);
    }
  }

  async function deleteProject(projectId) {
    try {
      const res = await window.pywebview.api.gs_delete_project(projectId);
      if (res && res.success) {
        if (_activeProjectId === projectId) {
          _activeProjectId = null;
        }
        await refresh();
      } else {
        alert('Lỗi xóa dự án: ' + (res?.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('[GSManager] deleteProject failed:', err);
    }
  }

  async function addSheet(projectId, title, url, tags, notes) {
    try {
      const targetProjId = projectId || _activeProjectId || (_projects[0] && _projects[0].id);
      if (!targetProjId) {
        alert('Vui lòng tạo ít nhất một dự án trước khi thêm Sheet.');
        return;
      }
      const res = await window.pywebview.api.gs_add_sheet(targetProjId, title, url, tags, notes, false);
      if (res && res.success) {
        await refresh();
        // Auto open added sheet in a Tab
        if (res.sheet && window.GoogleSheetTabsManager) {
          const proj = _projects.find((p) => p.id === targetProjId);
          window.GoogleSheetTabsManager.openTab(res.sheet, proj);
        }
      } else {
        alert('Lỗi thêm Sheet: ' + (res?.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('[GSManager] addSheet failed:', err);
      alert('Lỗi thêm Sheet: ' + err.message);
    }
  }

  async function updateSheet(projectId, sheetId, title, url, tags, notes) {
    try {
      const targetProjId = projectId || findProjectIdBySheetId(sheetId);
      const res = await window.pywebview.api.gs_update_sheet(targetProjId, sheetId, title, url, tags, notes);
      if (res && res.success) {
        await refresh();
        if (window.GoogleSheetTabsManager) {
          const proj = _projects.find((p) => p.id === targetProjId);
          window.GoogleSheetTabsManager.updateSheetMeta(sheetId, {
            title,
            url,
            tags,
            notes,
            projectId: targetProjId,
            projectName: proj?.name,
            projectColor: proj?.color,
          });
        }
      } else {
        alert('Lỗi cập nhật Sheet: ' + (res?.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('[GSManager] updateSheet failed:', err);
      alert('Lỗi cập nhật Sheet: ' + err.message);
    }
  }

  async function removeSheet(projectId, sheetId) {
    try {
      const targetProjId = projectId || findProjectIdBySheetId(sheetId);
      const res = await window.pywebview.api.gs_remove_sheet(targetProjId, sheetId);
      if (res && res.success) {
        if (window.GoogleSheetTabsManager) {
          window.GoogleSheetTabsManager.closeTab(sheetId);
        }
        await refresh();
      } else {
        alert('Lỗi xóa Sheet: ' + (res?.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('[GSManager] removeSheet failed:', err);
    }
  }

  async function toggleFavorite(projectId, sheetId) {
    try {
      const targetProjId = projectId || findProjectIdBySheetId(sheetId);
      const res = await window.pywebview.api.gs_toggle_favorite(targetProjId, sheetId);
      if (res && res.success) {
        await refresh();
        if (window.GoogleSheetTabsManager) {
          window.GoogleSheetTabsManager.updateSheetMeta(sheetId, { favorite: res.favorite });
        }
      }
    } catch (err) {
      console.error('[GSManager] toggleFavorite failed:', err);
    }
  }

  function findProjectIdBySheetId(sheetId) {
    for (const p of _projects) {
      if ((p.sheets || []).some((s) => s.id === sheetId)) {
        return p.id;
      }
    }
    return _activeProjectId;
  }

  function getProjects() {
    return _projects;
  }

  function getCurrentSheets() {
    return _currentProjectData ? (_currentProjectData.sheets || []) : [];
  }

  function getCurrentProject() {
    return _currentProjectData;
  }

  function getSheetById(sheetId) {
    for (const p of _projects) {
      const found = (p.sheets || []).find((s) => s.id === sheetId);
      if (found) {
        return { ...found, projectId: p.id, projectName: p.name, projectColor: p.color };
      }
    }
    return null;
  }

  return {
    init,
    openManager,
    refresh,
    selectProject,
    createProject,
    updateProject,
    deleteProject,
    addSheet,
    updateSheet,
    removeSheet,
    toggleFavorite,
    findProjectIdBySheetId,
    getProjects,
    getCurrentSheets,
    getCurrentProject,
    getSheetById,
  };
})();

// Auto-initialize when document DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.GoogleSheetsManager.init());
} else {
  window.GoogleSheetsManager.init();
}
