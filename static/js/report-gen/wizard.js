/**
 * Report Layout Generation Wizard JS (Phase 1, 2, 3)
 * Bridges UI interactions with window.pywebview.api.rg_* and /api/report-gen/* endpoints.
 */

(function () {
    'use strict';

    // Application state
    const state = {
        currentStep: 1,
        sessionId: null,
        files: [],
        activeFileId: null,
        sheets: [],
        currentSheet: null,
        sheetData: null,
        sheetGrid: null,
        // Per-sheet configuration tracker:
        // { [sheetName]: { regions: { title, header, summary }, columns: [...], dataMember: 'Table0', layoutXml: '', datasourceXml: '' } }
        sheetConfigs: {},
        regions: {
            title: null,
            header: null,
            summary: null
        },
        selectedRangeStr: null,
        selectedRangeObj: null,
        unmappedColumns: new Set(),
        currentConnectionId: null,
        currentDatabase: null,
        currentSchema: 'dbo',
        connections: [],
        routines: [],
        currentRoutine: null,
        currentShape: null,
        dataMember: 'Table0',
        dbColumns: [],
        // All columns across configured sheets: [ { sheet, name, header_text, col_idx } ]
        allColumns: [],
        excelColumns: [],
        mapping: {}, // key: `${sheet}::${col.name}` -> dbColumnName
        columnTables: {}, // key: `${sheet}::${col.name}` -> tableId
        currentFileFilter: 'all',
        currentSheetFilter: 'all',
        contentViewMode: 'grid', // 'grid' (3-row table) | 'list'
        paramMappings: { title: {}, summary: {} }, // key: `${sheet}::${t.col || t.text}` -> '@paramName'
        routineCache: {}, // cache routines by `${connId}_${schema}_${search}`
        xmlLayout: '',
        xmlDatasource: '',
        activeStep4Sheet: null,
        activeStep4Option: 'layout' // 'layout' | 'datasource'
    };

    let monacoEditorInstance = null;
    let searchDebounceTimer = null;

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getPywebviewApi() {
        if (window.pywebview && window.pywebview.api) {
            return Promise.resolve(window.pywebview.api);
        }
        return new Promise((resolve) => {
            let settled = false;
            const onReady = () => {
                if (settled) return;
                settled = true;
                window.removeEventListener('pywebviewready', onReady);
                resolve(window.pywebview ? window.pywebview.api : null);
            };
            window.addEventListener('pywebviewready', onReady);
            setTimeout(() => {
                if (settled) return;
                settled = true;
                window.removeEventListener('pywebviewready', onReady);
                resolve(window.pywebview ? window.pywebview.api : null);
            }, 800);
        });
    }

    // Helper: call API (pywebview bridge or HTTP fetch fallback)
    async function callApi(method, ...args) {
        const api = await getPywebviewApi();
        if (api && typeof api[method] === 'function') {
            return await api[method](...args);
        }

        // Web mode endpoint map
        const endpointMap = {
            rg_open_file: ['POST', '/api/report-gen/source'],
            rg_open_files: ['POST', '/api/report-gen/source'],
            rg_add_files: ['POST', (sid) => `/api/report-gen/${sid}/add-files`],
            rg_remove_file: ['DELETE', (sid, fid) => `/api/report-gen/${sid}/file/${encodeURIComponent(fid)}`],
            rg_select_file: ['POST', (sid) => `/api/report-gen/${sid}/select-file`],
            rg_open_gsheet: ['POST', '/api/report-gen/source'],
            rg_get_sheet: ['GET', (sid, sname) => `/api/report-gen/${sid}/sheet${sname ? '/' + encodeURIComponent(sname) : ''}`],
            rg_set_regions: ['PUT', (sid) => `/api/report-gen/${sid}/regions`],
            rg_get_connections: ['GET', '/api/report-gen/connections'],
            rg_get_databases: ['GET', (cid) => `/api/report-gen/databases?connection_id=${encodeURIComponent(cid || '')}`],
            rg_get_schemas: ['GET', (cid, db) => `/api/report-gen/schemas?connection_id=${encodeURIComponent(cid || '')}${db ? '&database=' + encodeURIComponent(db) : ''}`],
            rg_list_routines: ['GET', (cid, schema, search, db) => `/api/report-gen/routines?connection_id=${encodeURIComponent(cid || '')}${schema ? '&schema=' + encodeURIComponent(schema) : ''}${search ? '&search=' + encodeURIComponent(search) : ''}${db ? '&database=' + encodeURIComponent(db) : ''}`],
            rg_describe_routine: ['POST', (sid) => `/api/report-gen/${sid}/describe`],
            rg_apply_mapping: ['PUT', (sid) => `/api/report-gen/${sid}/mapping`],
            rg_build: ['POST', (sid) => `/api/report-gen/${sid}/build`],
            rg_save_files: ['POST', (sid) => `/api/report-gen/${sid}/save`]
        };

        const def = endpointMap[method];
        if (!def) throw new Error(`API method ${method} not implemented.`);

        const [httpMethod, urlGen] = def;
        let url = typeof urlGen === 'function' ? urlGen(args[0], args[1], args[2], args[3], args[4]) : urlGen;
        let fetchOpts = { method: httpMethod, headers: { 'Content-Type': 'application/json' } };

        if (method === 'rg_open_file') {
            fetchOpts.body = JSON.stringify({ content: args[0], filename: args[1] });
        } else if (method === 'rg_open_files') {
            fetchOpts.body = JSON.stringify({ files: args[0] });
        } else if (method === 'rg_add_files') {
            fetchOpts.body = JSON.stringify({ files: args[1] });
        } else if (method === 'rg_remove_file') {
            fetchOpts.body = JSON.stringify({});
        } else if (method === 'rg_select_file') {
            fetchOpts.body = JSON.stringify({ file_id: args[1] });
        } else if (method === 'rg_open_gsheet') {
            fetchOpts.body = JSON.stringify({ url: args[0] });
        } else if (method === 'rg_set_regions') {
            fetchOpts.body = JSON.stringify({ regions: args[1], sheet_name: args[2] });
        } else if (method === 'rg_describe_routine') {
            fetchOpts.body = JSON.stringify({ connection_id: args[1], routine: args[2], schema: args[3], database: args[4] });
        } else if (method === 'rg_apply_mapping') {
            fetchOpts.body = JSON.stringify({
                data_member: args[1],
                mapping: args[2],
                mode: args[3],
                unmapped_columns: args[4],
                sheet_name: args[5],
                param_mappings: args[6]
            });
        } else if (method === 'rg_save_files') {
            fetchOpts.body = JSON.stringify({ folder: args[1] });
        }

        const resp = await fetch(url, fetchOpts);
        return await resp.json();
    }

    // Status bar notification helper
    function setStatus(msg, type = 'info') {
        const el = document.getElementById('rg-status-msg');
        if (!el) return;
        const icon = type === 'error' ? 'fa-circle-xmark text-danger' :
                     type === 'warning' ? 'fa-triangle-exclamation text-warning' :
                     type === 'success' ? 'fa-circle-check text-success' : 'fa-info-circle text-info';
        el.innerHTML = `<span class="${type === 'error' ? 'text-danger' : ''}"><i class="fa-solid ${icon} me-1"></i>${msg}</span>`;
    }

    // Step navigation
    function setStep(stepNum) {
        state.currentStep = stepNum;
        document.querySelectorAll('.rg-step-pill').forEach(el => {
            const s = parseInt(el.dataset.step, 10);
            el.classList.toggle('active', s === stepNum);
            el.classList.toggle('completed', s < stepNum);
        });

        document.querySelectorAll('.rg-step-view').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none';
        });
        document.querySelectorAll('body > .rg-searchable-dropdown').forEach(d => d.remove());
        const activeView = document.getElementById(`view-step-${stepNum}`);
        if (activeView) {
            activeView.classList.add('active');
            activeView.style.display = 'flex';
        }

        document.getElementById('btn-prev').disabled = (stepNum === 1);
        const btnNext = document.getElementById('btn-next');
        if (stepNum === 4) {
            btnNext.innerHTML = '<i class="fa-solid fa-check me-1"></i> Hoàn thành';
        } else {
            btnNext.innerHTML = 'Tiếp tục <i class="fa-solid fa-arrow-right ms-1"></i>';
        }

        if (stepNum === 2) {
            updateStep2FileSwitcher();
            if (state.sheetGrid) {
                setTimeout(() => {
                    state.sheetGrid.refreshLayout();
                }, 60);
            }
        } else if (stepNum === 3) {
            initStep3();
        } else if (stepNum === 4) {
            initStep4();
        }
    }

    // ─── Step 1: Multi-File & Google Sheets Loader ─────────────────────────
    function updateSessionChip() {
        const chip = document.getElementById('session-chip');
        if (!chip) return;
        if (!state.sessionId) {
            chip.textContent = 'Chưa có phiên';
            return;
        }
        const fileCount = state.files ? state.files.length : 0;
        chip.textContent = `Phiên #${state.sessionId} (${fileCount} ${fileCount > 1 ? 'files' : 'file'})`;
    }

    function renderSelectedFilesUI() {
        const container = document.getElementById('selected-files-container');
        const listEl = document.getElementById('selected-files-list');
        const countEl = document.getElementById('file-count');

        if (!container || !listEl) return;

        if (!state.files || state.files.length === 0) {
            container.style.display = 'none';
            if (countEl) countEl.textContent = '0';
            listEl.innerHTML = '';
            return;
        }

        container.style.display = 'flex';
        if (countEl) countEl.textContent = state.files.length;
        listEl.innerHTML = '';

        state.files.forEach((f, idx) => {
            const isActive = (f.id === state.activeFileId);
            const item = document.createElement('div');
            item.className = `rg-file-item ${isActive ? 'active' : ''}`;
            item.dataset.fileId = f.id;

            const sheetCount = (f.sheets || []).length;
            const sheetPreviewStr = sheetCount > 0 ? `(${f.sheets.slice(0, 3).join(', ')}${sheetCount > 3 ? '...' : ''})` : '';

            item.innerHTML = `
                <i class="fa-solid fa-file-excel rg-file-item-icon"></i>
                <div class="rg-file-item-info">
                    <div class="rg-file-item-name" title="${escapeHtml(f.filename)}">
                        <span class="text-muted me-1">#${idx + 1}</span>
                        <span>${escapeHtml(f.filename)}</span>
                        ${isActive ? '<span class="badge bg-success ms-2" style="font-size: 10px; font-weight: normal;">Đang chọn</span>' : ''}
                    </div>
                    <div class="rg-file-item-meta">
                        <span class="badge bg-secondary-subtle text-body">${formatFileSize(f.size_bytes)}</span>
                        <span>•</span>
                        <span>${sheetCount} sheets ${escapeHtml(sheetPreviewStr)}</span>
                    </div>
                </div>
                <div class="rg-file-item-actions">
                    <button type="button" class="rg-btn rg-btn-sm ${isActive ? 'rg-btn-primary' : ''} btn-select-file" title="Chọn file này để khoanh vùng">
                        <i class="fa-solid fa-eye me-1"></i> ${isActive ? 'Đang chọn' : 'Khoanh vùng'}
                    </button>
                    <button type="button" class="rg-btn rg-btn-sm text-danger btn-remove-file" title="Xóa file khỏi danh sách">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;

            // Select file button
            item.querySelector('.btn-select-file').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (f.id !== state.activeFileId) {
                    await switchActiveFile(f.id);
                }
                setStep(2);
            });

            // Remove file button
            item.querySelector('.btn-remove-file').addEventListener('click', async (e) => {
                e.stopPropagation();
                await removeFile(f.id);
            });

            listEl.appendChild(item);
        });

        updateStep2FileSwitcher();
    }

    function updateStep2FileSwitcher() {
        const switcherBar = document.getElementById('file-switcher-bar');
        const selectEl = document.getElementById('active-file-select');
        const badgeEl = document.getElementById('active-file-info-badge');
        if (!switcherBar || !selectEl) return;

        if (!state.files || state.files.length <= 1) {
            switcherBar.style.display = 'none';
            return;
        }

        switcherBar.style.display = 'flex';
        selectEl.innerHTML = state.files.map((f, idx) => {
            const isSel = (f.id === state.activeFileId);
            return `<option value="${f.id}" ${isSel ? 'selected' : ''}>#${idx + 1}: ${escapeHtml(f.filename)} (${formatFileSize(f.size_bytes)})</option>`;
        }).join('');

        const currIdx = state.files.findIndex(f => f.id === state.activeFileId);
        if (badgeEl) {
            badgeEl.textContent = `File ${currIdx >= 0 ? currIdx + 1 : 1} / ${state.files.length}`;
        }
    }

    async function switchActiveFile(fileId) {
        if (!state.sessionId || !fileId) return;
        // Save current sheet config for current file BEFORE switching
        saveCurrentSheetConfig();
        setStatus('Đang chuyển đổi file...', 'info');
        try {
            const res = await callApi('rg_select_file', state.sessionId, fileId);
            if (res.success) {
                state.activeFileId = res.active_file_id;
                state.sheets = res.sheets || [];

                // Restore regions for this file and sheet if previously configured
                const targetSheet = res.selected_sheet || (res.sheets && res.sheets[0] ? (typeof res.sheets[0] === 'object' ? res.sheets[0].name : res.sheets[0]) : null);
                const cfgKey = getSheetConfigKey(res.active_file_id, targetSheet);
                if (state.sheetConfigs[cfgKey] && state.sheetConfigs[cfgKey].regions) {
                    state.regions = { ...state.sheetConfigs[cfgKey].regions };
                } else if (res.regions && res.regions.length > 0) {
                    state.regions = { title: null, header: null, summary: null };
                    res.regions.forEach(r => {
                        if (r.kind && r.range_str) state.regions[r.kind] = r.range_str;
                    });
                } else {
                    state.regions = { title: null, header: null, summary: null };
                }

                renderSelectedFilesUI();
                await loadSheetPreview(res.selected_sheet);
                setStatus(`Đang làm việc với file "${res.filename}"`, 'success');
            } else {
                setStatus(`Lỗi chuyển file: ${res.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi chuyển file: ${err.message}`, 'error');
        }
    }

    async function removeFile(fileId) {
        if (!state.sessionId || !fileId) return;
        setStatus('Đang xóa file...', 'info');
        try {
            const res = await callApi('rg_remove_file', state.sessionId, fileId);
            if (res.success) {
                state.files = res.files || [];
                state.activeFileId = res.active_file_id;
                state.sheets = res.sheets || [];

                updateSessionChip();
                renderSelectedFilesUI();

                if (state.files.length > 0) {
                    await loadSheetPreview();
                    setStatus(`Đã xóa file. Còn lại ${state.files.length} file.`, 'info');
                } else {
                    state.sessionId = null;
                    state.sheetData = null;
                    document.getElementById('file-input').value = '';
                    setStatus('Đã xóa tất cả file.', 'info');
                }
            } else {
                setStatus(`Lỗi xóa file: ${res.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi xóa file: ${err.message}`, 'error');
        }
    }

    async function handleFilesSelected(fileList) {
        if (!fileList || !fileList.length) return;
        const validFiles = Array.from(fileList).filter(f => {
            const ext = f.name.toLowerCase();
            return ext.endsWith('.xlsx') || ext.endsWith('.xlsm');
        });

        if (!validFiles.length) {
            setStatus('Vui lòng chọn file Excel có đuôi .xlsx hoặc .xlsm.', 'warning');
            return;
        }

        setStatus(`Đang đọc ${validFiles.length} file...`, 'info');

        try {
            const filesData = [];
            for (const file of validFiles) {
                const b64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (err) => reject(err);
                    reader.readAsDataURL(file);
                });
                filesData.push({
                    content: b64,
                    filename: file.name,
                    size: file.size
                });
            }

            let res;
            if (state.sessionId && state.files && state.files.length > 0) {
                setStatus(`Đang thêm ${filesData.length} file vào phiên...`, 'info');
                res = await callApi('rg_add_files', state.sessionId, filesData);
            } else {
                setStatus(`Đang khởi tạo phiên với ${filesData.length} file...`, 'info');
                res = await callApi('rg_open_files', filesData);
            }

            if (res.success) {
                state.sessionId = res.session_id;
                state.files = res.files || [];
                state.activeFileId = res.active_file_id || (state.files[0] ? state.files[0].id : null);
                state.sheets = res.sheets || [];

                updateSessionChip();
                renderSelectedFilesUI();
                await loadSheetPreview();

                const names = validFiles.map(f => f.name).join(', ');
                setStatus(`Đã chọn thành công ${state.files.length} file: ${names}. Bấm "Tiến hành khoanh vùng" để tiếp tục.`, 'success');
            } else {
                setStatus(`Lỗi nạp file: ${res.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi xử lý file: ${err.message}`, 'error');
        }
    }

    async function handleNativePathsSelected(filePaths) {
        if (!filePaths || !filePaths.length) return;
        const validPaths = filePaths.filter(p => {
            const ext = p.toLowerCase();
            return ext.endsWith('.xlsx') || ext.endsWith('.xlsm');
        });

        if (!validPaths.length) {
            setStatus('Vui lòng chọn file Excel có đuôi .xlsx hoặc .xlsm.', 'warning');
            return;
        }

        setStatus(`Đang nạp ${validPaths.length} file...`, 'info');
        try {
            const filesData = validPaths.map(p => {
                const name = p.split(/[/\\]/).pop();
                return {
                    content: p,
                    filename: name
                };
            });

            let res;
            if (state.sessionId && state.files && state.files.length > 0) {
                setStatus(`Đang thêm ${filesData.length} file vào phiên...`, 'info');
                res = await callApi('rg_add_files', state.sessionId, filesData);
            } else {
                setStatus(`Đang khởi tạo phiên với ${filesData.length} file...`, 'info');
                res = await callApi('rg_open_files', filesData);
            }

            if (res.success) {
                state.sessionId = res.session_id;
                state.files = res.files || [];
                state.activeFileId = res.active_file_id || (state.files[0] ? state.files[0].id : null);
                state.sheets = res.sheets || [];

                updateSessionChip();
                renderSelectedFilesUI();
                await loadSheetPreview();

                const names = filesData.map(f => f.filename).join(', ');
                setStatus(`Đã chọn thành công ${state.files.length} file: ${names}. Bấm "Tiến hành khoanh vùng" để tiếp tục.`, 'success');
            } else {
                setStatus(`Lỗi nạp file: ${res.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi xử lý file: ${err.message}`, 'error');
        }
    }

    // ─── Step 2: SheetGrid & Regions ────────────────────────────────────────
    function getSheetConfigKey(fileId, sheetName) {
        const fid = fileId || state.activeFileId || 'default';
        const sname = sheetName || state.currentSheet || 'Sheet1';
        return `${fid}::${sname}`;
    }

    function saveCurrentSheetConfig() {
        if (!state.currentSheet) return;
        // Direct sync from input elements in case user typed or edited manually
        ['title', 'header', 'summary'].forEach(k => {
            const inp = document.getElementById(`input-${k}-range`);
            if (inp) {
                const val = inp.value.trim().toUpperCase();
                state.regions[k] = val || null;
            }
        });

        const cfgKey = getSheetConfigKey(state.activeFileId, state.currentSheet);
        if (!state.sheetConfigs[cfgKey]) {
            state.sheetConfigs[cfgKey] = {
                fileId: state.activeFileId,
                sheetName: state.currentSheet,
                regions: { title: null, header: null, summary: null },
                columns: [],
                dataMember: state.dataMember || 'Table0',
                layoutXml: '',
                datasourceXml: ''
            };
        }
        state.sheetConfigs[cfgKey].regions = { ...state.regions };
        state.sheetConfigs[state.currentSheet] = state.sheetConfigs[cfgKey];
    }

    async function loadSheetPreview(sheetName = null) {
        if (!state.sessionId) return;
        // Save previous sheet config before loading new sheet
        saveCurrentSheetConfig();

        setStatus('Đang tải dữ liệu bảng tính...', 'info');
        try {
            const res = await callApi('rg_get_sheet', state.sessionId, sheetName);
            if (res.success) {
                state.sheetData = res.sheet;
                state.currentSheet = res.sheet.name;

                const cfgKey = getSheetConfigKey(state.activeFileId, state.currentSheet);
                // Restore regions for this file and sheet if already configured
                if (state.sheetConfigs[cfgKey] && state.sheetConfigs[cfgKey].regions) {
                    state.regions = { ...state.sheetConfigs[cfgKey].regions };
                } else if (state.sheetConfigs[state.currentSheet] && state.sheetConfigs[state.currentSheet].regions) {
                    state.regions = { ...state.sheetConfigs[state.currentSheet].regions };
                } else {
                    state.regions = { title: null, header: null, summary: null };
                    state.sheetConfigs[cfgKey] = {
                        fileId: state.activeFileId,
                        sheetName: state.currentSheet,
                        regions: { ...state.regions },
                        columns: [],
                        dataMember: state.dataMember || 'Table0',
                        layoutXml: '',
                        datasourceXml: ''
                    };
                    state.sheetConfigs[state.currentSheet] = state.sheetConfigs[cfgKey];
                    // Apply suggested regions
                    if (res.suggested_regions && res.suggested_regions.length > 0) {
                        res.suggested_regions.forEach(sr => {
                            if (!state.regions[sr.kind]) {
                                state.regions[sr.kind] = sr.range_str;
                            }
                        });
                        state.sheetConfigs[cfgKey].regions = { ...state.regions };
                        state.sheetConfigs[state.currentSheet].regions = { ...state.regions };
                    }
                }

                // Init or reload SheetGrid
                const gridContainer = document.getElementById('grid-container');
                if (!state.sheetGrid) {
                    state.sheetGrid = new window.SheetGrid(gridContainer, {
                        onSelectRange: (rangeStr, rangeObj) => {
                            state.selectedRangeStr = rangeStr;
                            state.selectedRangeObj = rangeObj;
                        },
                        onAssignRegion: (kind, rangeStr) => {
                            const inp = document.getElementById(`input-${kind}-range`);
                            if (rangeStr) {
                                state.regions[kind] = rangeStr;
                                if (inp) inp.value = rangeStr;
                            } else {
                                state.regions[kind] = null;
                                if (inp) inp.value = '';
                            }
                            saveCurrentSheetConfig();
                            if (state.sheetGrid) state.sheetGrid.setRegions(state.regions);
                            updateRegionUI();
                            if (rangeStr) setStatus(`Đã gán vùng ${kind.toUpperCase()}: ${rangeStr}`, 'success');
                            else setStatus(`Đã xoá gán vùng ${kind.toUpperCase()}`, 'info');
                        },
                        onSheetChange: (sName) => {
                            loadSheetPreview(sName);
                        }
                    });
                }
                state.sheetGrid.loadData(res.sheet, state.sheets, state.currentSheet);
                state.sheetGrid.setRegions(state.regions);
                updateRegionUI();

                if (state.currentStep === 2) {
                    setTimeout(() => {
                        if (state.sheetGrid) state.sheetGrid.refreshLayout();
                    }, 50);
                }

                setStatus(`Đã tải sheet "${state.currentSheet}" (${res.sheet.preview_rows} dòng × ${res.sheet.preview_cols} cột)`, 'success');
            } else {
                setStatus(`Không tải được sheet: ${res.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi tải sheet: ${err.message}`, 'error');
        }
    }

    function updateRegionUI() {
        const titleRange = state.regions.title || '';
        const headerRange = state.regions.header || '';
        const summaryRange = state.regions.summary || '';

        const titleInp = document.getElementById('input-title-range');
        const headerInp = document.getElementById('input-header-range');
        const summaryInp = document.getElementById('input-summary-range');

        if (titleInp && document.activeElement !== titleInp) titleInp.value = titleRange;
        if (headerInp && document.activeElement !== headerInp) headerInp.value = headerRange;
        if (summaryInp && document.activeElement !== summaryInp) summaryInp.value = summaryRange;
    }

    // ─── Step 3: Connections, Routines & Mapping (Tree View & 2-Level Filter) ─────
    async function initStep3() {
        renderFilterBars();
        renderMappingTree();
        await loadConnections();
    }

    function renderFilterBars() {
        const fileBar = document.getElementById('step3-file-filter-bar');
        const filePills = document.getElementById('step3-file-pills');
        const sheetBar = document.getElementById('step3-sheet-filter-bar');
        const sheetPills = document.getElementById('step3-sheet-pills');

        if (!fileBar || !sheetBar) return;

        // Level 1: Filter theo file đã đính kèm (tên file)
        if (state.files && state.files.length > 0) {
            fileBar.style.display = 'flex';
            let fHtml = '';
            if (state.files.length > 1) {
                fHtml += `
                    <button type="button" class="rg-sheet-pill ${state.currentFileFilter === 'all' ? 'active' : ''}" data-file="all">
                        <i class="fa-solid fa-list-check"></i> Tất cả files (${state.files.length})
                    </button>
                `;
            }
            state.files.forEach(f => {
                const isAct = (state.currentFileFilter === f.id) || (state.files.length === 1 && state.currentFileFilter === 'all');
                const active = isAct ? 'active' : '';
                fHtml += `
                    <button type="button" class="rg-sheet-pill ${active}" data-file="${escapeHtml(f.id)}">
                        <i class="fa-solid fa-file-excel text-success"></i> ${escapeHtml(f.filename || f.id)}
                    </button>
                `;
            });
            filePills.innerHTML = fHtml;

            filePills.querySelectorAll('.rg-sheet-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    filePills.querySelectorAll('.rg-sheet-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.currentFileFilter = btn.dataset.file;
                    state.currentSheetFilter = 'all';
                    renderFilterBars();
                    renderMappingTree();
                });
            });
        } else {
            fileBar.style.display = 'none';
            state.currentFileFilter = 'all';
        }

        // Level 2: Sheets tương ứng với file đã chọn ở cấp 1
        const seenKeys = new Set();
        let visibleConfigs = [];
        Object.keys(state.sheetConfigs).forEach(k => {
            const cfg = state.sheetConfigs[k];
            if (!cfg || !cfg.sheetName) return;
            const uniqueKey = `${cfg.fileId || state.activeFileId || 'def'}::${cfg.sheetName}`;
            if (seenKeys.has(uniqueKey)) return;
            seenKeys.add(uniqueKey);
            if (state.currentFileFilter === 'all' || (cfg.fileId || state.activeFileId) === state.currentFileFilter) {
                visibleConfigs.push(cfg);
            }
        });

        if (visibleConfigs.length > 0) {
            sheetBar.style.display = 'flex';
            let totalCols = 0;
            visibleConfigs.forEach(cfg => { totalCols += (cfg.columns || []).length; });

            let sHtml = '';
            if (visibleConfigs.length > 1) {
                sHtml += `
                    <button type="button" class="rg-sheet-pill ${state.currentSheetFilter === 'all' ? 'active' : ''}" data-sheet="all">
                        <i class="fa-solid fa-list-check"></i> Tất cả sheets (${totalCols} cột)
                    </button>
                `;
            }
            visibleConfigs.forEach(cfg => {
                const sName = cfg.sheetName;
                const count = (cfg.columns || []).length;
                const isAct = (state.currentSheetFilter === sName) || (visibleConfigs.length === 1 && state.currentSheetFilter === 'all');
                const active = isAct ? 'active' : '';
                sHtml += `
                    <button type="button" class="rg-sheet-pill ${active}" data-sheet="${escapeHtml(sName)}">
                        <i class="fa-solid fa-table-cells text-success"></i> ${escapeHtml(sName)} (${count})
                    </button>
                `;
            });
            sheetPills.innerHTML = sHtml;

            sheetPills.querySelectorAll('.rg-sheet-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    sheetPills.querySelectorAll('.rg-sheet-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.currentSheetFilter = btn.dataset.sheet;
                    renderMappingTree();
                });
            });
        } else {
            sheetBar.style.display = 'none';
            state.currentSheetFilter = 'all';
        }
    }

    // ─── Searchable Inline Combobox Helper ────────────────────────────────────
    function createSearchableSelectHtml({ key, selectedValue, placeholder, defaultLabel, options, width, inputClass, colName }) {
        let displayLabel = '';
        if (selectedValue) {
            const found = options.find(o => o.value === selectedValue);
            displayLabel = found ? found.label : selectedValue;
        }

        const widthStyle = width ? `style="${width}"` : '';
        const colAttr = colName ? `data-col="${escapeHtml(colName)}"` : '';
        return `
            <div class="rg-searchable-select" ${widthStyle} data-key="${escapeHtml(key)}">
                <div class="position-relative w-100">
                    <input type="text"
                           class="rg-searchable-input form-control form-control-sm pe-4 ${inputClass || ''}"
                           style="font-size: 11px; height: 26px; border-radius: 3px;"
                           placeholder="${escapeHtml(placeholder)}"
                           value="${escapeHtml(displayLabel)}"
                           data-key="${escapeHtml(key)}"
                           ${colAttr}
                           data-selected-value="${escapeHtml(selectedValue || '')}"
                           data-selected-label="${escapeHtml(displayLabel)}"
                           autocomplete="off">
                    <i class="fa-solid fa-chevron-down position-absolute end-0 top-50 translate-middle-y me-2 text-muted" style="pointer-events: none; font-size: 8px;"></i>
                </div>
                <div class="rg-searchable-dropdown d-none">
                    <div class="rg-searchable-opt ${!selectedValue ? 'selected' : ''}"
                         data-value=""
                         data-label="${escapeHtml(defaultLabel)}">
                        <span class="text-truncate text-muted fst-italic">${escapeHtml(defaultLabel)}</span>
                    </div>
                    ${options.map(opt => {
                        const selCls = (opt.value === selectedValue) ? 'selected' : '';
                        return `
                            <div class="rg-searchable-opt ${selCls}"
                                 data-value="${escapeHtml(opt.value)}"
                                 data-label="${escapeHtml(opt.label)}"
                                 title="${escapeHtml(opt.label)}">
                                <span class="text-truncate font-monospace" style="font-size: 11px;">${escapeHtml(opt.label)}</span>
                                ${opt.type ? `<span class="badge bg-secondary-subtle text-body border opt-type">${escapeHtml(opt.type)}</span>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function bindSearchableSelects(container, onSelectCallback) {
        if (!container) return;

        if (!window._rgSearchableSelectGlobalBound) {
            window._rgSearchableSelectGlobalBound = true;
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.rg-searchable-select') && !e.target.closest('.rg-searchable-dropdown')) {
                    document.querySelectorAll('.rg-searchable-dropdown').forEach(d => d.classList.add('d-none'));
                }
            }, true);
        }

        if (!window._rgSearchableSelectScrollBound) {
            window._rgSearchableSelectScrollBound = true;
            const repositionOpenDropdowns = () => {
                document.querySelectorAll('.rg-searchable-dropdown:not(.d-none)').forEach(dropdown => {
                    const input = dropdown._linkedInput;
                    if (!input || !document.body.contains(input)) {
                        dropdown.classList.add('d-none');
                        return;
                    }
                    const rect = input.getBoundingClientRect();
                    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                        dropdown.classList.add('d-none');
                        return;
                    }
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const spaceAbove = rect.top;

                    dropdown.style.left = `${Math.max(10, rect.left)}px`;
                    dropdown.style.width = `${Math.max(rect.width, 240)}px`;

                    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
                        dropdown.style.top = 'auto';
                        dropdown.style.bottom = `${window.innerHeight - rect.top + 2}px`;
                    } else {
                        dropdown.style.top = `${rect.bottom + 2}px`;
                        dropdown.style.bottom = 'auto';
                    }
                });
            };

            window.addEventListener('scroll', (e) => {
                // If scrolling inside the dropdown list itself, do NOT dismiss or reposition
                if (e.target && ((e.target.closest && e.target.closest('.rg-searchable-dropdown')) || (e.target.classList && e.target.classList.contains('rg-searchable-dropdown')))) {
                    return;
                }
                repositionOpenDropdowns();
            }, { passive: true, capture: true });

            window.addEventListener('resize', repositionOpenDropdowns, { passive: true });
        }

        container.querySelectorAll('.rg-searchable-select').forEach(wrap => {
            const input = wrap.querySelector('.rg-searchable-input');
            const dropdown = wrap.querySelector('.rg-searchable-dropdown');
            if (!input || !dropdown || input.dataset.bound === 'true') return;
            input.dataset.bound = 'true';

            const openDropdown = () => {
                document.querySelectorAll('.rg-searchable-dropdown').forEach(d => {
                    if (d !== dropdown) d.classList.add('d-none');
                });

                dropdown._linkedInput = input;
                if (dropdown.parentElement !== document.body) {
                    document.body.appendChild(dropdown);
                }

                const rect = input.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;

                dropdown.style.position = 'fixed';
                dropdown.style.left = `${Math.max(10, rect.left)}px`;
                dropdown.style.width = `${Math.max(rect.width, 240)}px`;
                dropdown.style.zIndex = '99999';

                if (spaceBelow < 220 && spaceAbove > spaceBelow) {
                    // Open upwards (drop-up)
                    dropdown.style.top = 'auto';
                    dropdown.style.bottom = `${window.innerHeight - rect.top + 2}px`;
                } else {
                    // Open downwards (drop-down)
                    dropdown.style.top = `${rect.bottom + 2}px`;
                    dropdown.style.bottom = 'auto';
                }

                dropdown.classList.remove('d-none');
                filterOptions(input.value.trim());
            };

            const closeDropdown = () => {
                dropdown.classList.add('d-none');
            };

            const filterOptions = (query) => {
                const q = (query || '').toLowerCase().trim();
                const opts = dropdown.querySelectorAll('.rg-searchable-opt');
                let matchCount = 0;
                opts.forEach(opt => {
                    const label = (opt.dataset.label || '').toLowerCase();
                    const val = (opt.dataset.value || '').toLowerCase();
                    const matched = !q || label.includes(q) || val.includes(q);
                    opt.style.display = matched ? 'flex' : 'none';
                    if (matched) matchCount++;
                });
                let noMatchEl = dropdown.querySelector('.rg-no-match');
                if (matchCount === 0) {
                    if (!noMatchEl) {
                        noMatchEl = document.createElement('div');
                        noMatchEl.className = 'rg-no-match text-muted small p-2 text-center fst-italic';
                        noMatchEl.textContent = 'Không tìm thấy mục phù hợp';
                        dropdown.appendChild(noMatchEl);
                    }
                    noMatchEl.style.display = 'block';
                } else if (noMatchEl) {
                    noMatchEl.style.display = 'none';
                }
            };

            input.addEventListener('focus', openDropdown);
            input.addEventListener('click', openDropdown);

            input.addEventListener('input', () => {
                openDropdown();
                filterOptions(input.value);
                if (!input.value.trim()) {
                    input.dataset.selectedValue = '';
                    input.dataset.selectedLabel = '';
                    if (onSelectCallback) onSelectCallback(wrap.dataset.key, '', input);
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeDropdown();
                    input.value = input.dataset.selectedLabel || '';
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const firstVisible = dropdown.querySelector('.rg-searchable-opt[style*="display: flex"], .rg-searchable-opt:not([style*="display: none"])');
                    if (firstVisible) firstVisible.click();
                }
            });

            dropdown.addEventListener('click', (e) => {
                const opt = e.target.closest('.rg-searchable-opt');
                if (!opt) return;
                const val = opt.dataset.value;
                const label = opt.dataset.label;
                input.value = val ? label : '';
                input.dataset.selectedValue = val;
                input.dataset.selectedLabel = val ? label : '';

                dropdown.querySelectorAll('.rg-searchable-opt').forEach(o => o.classList.toggle('selected', o === opt));
                closeDropdown();

                if (onSelectCallback) {
                    onSelectCallback(wrap.dataset.key, val, input);
                }
            });
        });
    }

    function renderMappingTree() {
        // Clean up any dropdowns ported to document.body
        document.querySelectorAll('body > .rg-searchable-dropdown').forEach(d => d.remove());

        const container = document.getElementById('mapping-tree-container');
        if (!container) return;
        container.innerHTML = '';

        // Filter sheet configs based on Level 1 and Level 2 with deduplication
        const seenConfigs = new Set();
        let configs = [];
        Object.keys(state.sheetConfigs).forEach(k => {
            const cfg = state.sheetConfigs[k];
            if (!cfg || !cfg.sheetName) return;
            const uniqueKey = `${cfg.fileId || state.activeFileId || 'def'}::${cfg.sheetName}`;
            if (!seenConfigs.has(uniqueKey)) {
                seenConfigs.add(uniqueKey);
                if (state.currentFileFilter === 'all' || (cfg.fileId || state.activeFileId) === state.currentFileFilter) {
                    if (state.currentSheetFilter === 'all' || cfg.sheetName === state.currentSheetFilter) {
                        configs.push(cfg);
                    }
                }
            }
        });

        // Available result sets from routine
        let resultSets = [];
        if (state.currentShape && state.currentShape.result_sets && state.currentShape.result_sets.length > 0) {
            resultSets = state.currentShape.result_sets;
        } else {
            resultSets = [{ data_member: state.dataMember || 'Table0', columns: state.dbColumns || [] }];
        }

        const currentDataMember = state.dataMember || (resultSets[0] ? (resultSets[0].data_member || resultSets[0].name) : 'Table0');
        const currentRs = resultSets.find(rs => (rs.data_member || rs.name || 'Table0') === currentDataMember) || resultSets[0] || { columns: [] };
        const availableDbCols = currentRs.columns || [];

        // Output parameters list
        const outputParams = (state.currentShape && state.currentShape.output_params && state.currentShape.output_params.length > 0)
            ? state.currentShape.output_params
            : ((state.currentShape && state.currentShape.parameters) || []).filter(p => p.direction && p.direction.toLowerCase().includes('out'));

        const paramOptions = outputParams.map(p => {
            const pClean = p.name.replace(/^@/, '');
            const pFull = '@' + pClean;
            return {
                value: pFull,
                label: `{=${pFull}}`,
                type: p.type || p.data_type || 'var'
            };
        });

        const dbColOptions = availableDbCols.map(dbCol => ({
            value: dbCol.name,
            label: `${dbCol.name} (${dbCol.type || dbCol.data_type || 'var'})`,
            type: dbCol.type || dbCol.data_type || 'var'
        }));

        // Aggregate Title items, Content columns, Summary items
        const titleItems = [];
        const contentCols = [];
        const summaryItems = [];

        configs.forEach(cfg => {
            const sName = cfg.sheetName || 'Sheet';
            (cfg.title_items || []).forEach(it => {
                titleItems.push({ ...it, sheet: sName });
            });
            (cfg.columns || []).forEach(col => {
                contentCols.push({ ...col, sheet: sName });
            });
            (cfg.summary_items || []).forEach(it => {
                summaryItems.push({ ...it, sheet: sName });
            });
        });

        // 1. Title Group Card (Hiển thị dạng list + gõ tìm kiếm param output ngay tại ô)
        const titleCard = document.createElement('div');
        titleCard.className = 'rg-group-card';
        titleCard.innerHTML = `
            <div class="rg-group-header" data-group="title">
                <div class="d-flex align-items-center">
                    <i class="fa-solid fa-chevron-down rg-group-toggle-icon me-2"></i>
                    <i class="fa-solid fa-heading text-info me-2"></i>
                    <strong>Title (Tiêu đề báo cáo)</strong>
                    <span class="badge bg-info-subtle text-info ms-2">${titleItems.length} mục</span>
                </div>
            </div>
            <div class="rg-group-body p-2" id="group-body-title">
                ${titleItems.length > 0 ? `
                    <table class="rg-param-mapping-table">
                        <tbody>
                            ${titleItems.map(t => {
                                const key = `${t.sheet}::${t.row || ''}::${t.col || ''}`;
                                const currentParam = state.paramMappings.title[key] || '';
                                const rowColLabel = t.row ? `${t.row} • ${t.col || 'Ô'}` : (t.col || 'Ô');
                                return `
                                    <tr>
                                        <td class="cell-label">
                                             <div class="d-flex align-items-center gap-2">
                                                <span class="badge bg-info-subtle text-info font-monospace fw-bold">${escapeHtml(rowColLabel)}</span>
                                                <span class="fw-semibold text-body text-truncate" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
                                                ${configs.length > 1 ? `<span class="badge bg-secondary-subtle text-body ms-1 font-monospace" style="font-size: 10px;">${escapeHtml(t.sheet)}</span>` : ''}
                                            </div>
                                        </td>
                                        <td class="cell-select">
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="small text-muted" style="font-size: 11px; white-space: nowrap;"><i class="fa-solid fa-arrow-right-from-bracket text-info me-1"></i>Param Output:</span>
                                                ${createSearchableSelectHtml({
                                                    key: key,
                                                    selectedValue: currentParam,
                                                    placeholder: '-- Gõ tìm Param Output --',
                                                    defaultLabel: '-- Giữ nguyên text tiêu đề --',
                                                    options: paramOptions,
                                                    inputClass: 'title-param-searchable'
                                                })}
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                ` : `
                    <div class="text-muted small fst-italic p-2"><i class="fa-solid fa-circle-info me-1 text-info"></i> Không có vùng Title được cấu hình cho sheet này.</div>
                `}
            </div>
        `;
        container.appendChild(titleCard);

        // 2. Content Group Card (Hỗ trợ 2 dạng: Bảng 3 dòng & Danh sách)
        const contentCard = document.createElement('div');
        contentCard.className = 'rg-group-card';

        const tableSelectOptions = resultSets.map((rs, idx) => {
            const dm = rs.data_member || rs.name || ('Table' + idx);
            const count = rs.columns ? rs.columns.length : 0;
            const sel = (dm === currentDataMember) ? 'selected' : '';
            const label = rs.table_source || dm;
            return `<option value="${escapeHtml(dm)}" ${sel}>${escapeHtml(label)} (${count} cột)</option>`;
        }).join('');

        const isGridView = (state.contentViewMode !== 'list');

        contentCard.innerHTML = `
            <div class="rg-group-header" data-group="content">
                <!-- Bên trái: Title Content (Cột nội dung) + (số cột) + [Selection bảng] -->
                <div class="d-flex align-items-center flex-wrap gap-2">
                    <i class="fa-solid fa-chevron-down rg-group-toggle-icon"></i>
                    <i class="fa-solid fa-table text-warning"></i>
                    <strong>Content (Cột nội dung)</strong>
                    <span class="badge bg-warning-subtle text-warning">${contentCols.length} cột</span>
                    <!-- Inline selectbox chọn Bảng DB đặt ngay cạnh title -->
                    <div class="d-inline-flex align-items-center gap-1.5 ms-2" onclick="event.stopPropagation();">
                        <label class="small text-muted fw-bold mb-0" style="white-space: nowrap;"><i class="fa-solid fa-database text-warning me-1"></i>Bảng DB:</label>
                        <select class="rg-select rg-select-sm" id="content-group-table-select" style="min-width: 150px; font-weight: 600;">
                            ${tableSelectOptions}
                        </select>
                    </div>
                </div>
                <!-- Bên phải: Toggle chế độ xem Bảng / Danh sách -->
                <div class="d-flex align-items-center gap-1" onclick="event.stopPropagation();">
                    <button type="button" class="rg-view-mode-btn ${isGridView ? 'active' : ''}" id="btn-toggle-grid" title="Xem dạng bảng lưới (3 dòng)">
                        <i class="fa-solid fa-table-cells me-1"></i> Bảng
                    </button>
                    <button type="button" class="rg-view-mode-btn ${!isGridView ? 'active' : ''}" id="btn-toggle-list" title="Xem dạng danh sách">
                        <i class="fa-solid fa-list me-1"></i> Danh sách
                    </button>
                </div>
            </div>
            <div class="rg-group-body" id="group-body-content">
                ${contentCols.length > 0 ? (isGridView ? `
                    <!-- Dạng Bảng (Grid Table) 3 dòng: Hàng 1 Checkbox, Hàng 2 Cột Layout, Hàng 3 Cột DB -->
                    <div class="rg-content-grid-wrap">
                        <table class="rg-content-grid-table">
                            <tbody>
                                <!-- Dòng 1: Nút tick 1 dòng -->
                                <tr class="tr-checkboxes">
                                    <td class="rg-grid-header-cell">
                                        <i class="fa-solid fa-toggle-on text-primary me-1"></i> Bật / Tắt
                                    </td>
                                    ${contentCols.map(col => {
                                        const key = `${col.sheet}::${col.name}`;
                                        const isUnmapped = state.unmappedColumns.has(key);
                                        return `
                                            <td data-col-cell="${escapeHtml(key)}" style="${isUnmapped ? 'opacity: 0.45;' : ''}">
                                                <input type="checkbox" class="col-enable-cb form-check-input" ${isUnmapped ? '' : 'checked'} data-key="${escapeHtml(key)}" title="Bật/tắt sử dụng cột này">
                                            </td>
                                        `;
                                    }).join('')}
                                </tr>
                                <!-- Dòng 2: Tên cột ở XML và tên cột theo Excel 1 dòng (Cố định độ rộng theo nội dung) -->
                                <tr class="tr-layout-cols">
                                    <td class="rg-grid-header-cell">
                                        <i class="fa-solid fa-columns text-info me-1"></i> Cột Layout
                                    </td>
                                    ${contentCols.map(col => {
                                        const key = `${col.sheet}::${col.name}`;
                                        const isUnmapped = state.unmappedColumns.has(key);
                                        return `
                                            <td data-col-cell="${escapeHtml(key)}" style="${isUnmapped ? 'opacity: 0.45;' : ''}">
                                                <div class="d-flex flex-column align-items-center gap-1 px-1" style="min-width: max-content; white-space: nowrap;">
                                                    <span class="badge bg-primary-subtle text-primary font-monospace fw-bold" style="font-size: 11px;">
                                                        ${escapeHtml(col.name)}
                                                    </span>
                                                    <span class="small fw-semibold text-body" style="white-space: nowrap;" title="${escapeHtml(col.header_text || col.name)}">
                                                        ${escapeHtml(col.header_text || col.name)}
                                                    </span>
                                                    ${configs.length > 1 ? `<span class="badge bg-secondary-subtle text-body" style="font-size: 9px;"><i class="fa-solid fa-file-excel text-success me-1"></i>${escapeHtml(col.sheet)}</span>` : ''}
                                                </div>
                                            </td>
                                        `;
                                    }).join('')}
                                </tr>
                                <!-- Dòng 3: Hiển thị các ô dạng searchable select gõ từ khóa chọn cột DB -->
                                <tr class="tr-db-selects">
                                    <td class="rg-grid-header-cell">
                                        <i class="fa-solid fa-database text-warning me-1"></i> Cột DB
                                    </td>
                                    ${contentCols.map(col => {
                                        const key = `${col.sheet}::${col.name}`;
                                        const isUnmapped = state.unmappedColumns.has(key);
                                        const mappedDbCol = state.mapping[key] || '';
                                        return `
                                            <td data-col-cell="${escapeHtml(key)}" style="${isUnmapped ? 'opacity: 0.45;' : ''}">
                                                ${createSearchableSelectHtml({
                                                    key: key,
                                                    selectedValue: mappedDbCol,
                                                    placeholder: '-- Tìm cột DB --',
                                                    defaultLabel: `-- Bỏ qua (${col.name}) --`,
                                                    options: dbColOptions,
                                                    inputClass: 'map-searchable-input',
                                                    colName: col.name,
                                                    width: 'min-width: 155px; width: 100%;'
                                                })}
                                            </td>
                                        `;
                                    }).join('')}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                ` : `
                    <!-- Dạng Danh sách (List View) -->
                    <div class="rg-content-cols-list">
                        ${contentCols.map(col => {
                            const key = `${col.sheet}::${col.name}`;
                            const isUnmapped = state.unmappedColumns.has(key);
                            const mappedDbCol = state.mapping[key] || '';
                            return `
                                <div class="rg-content-col-item" data-key="${escapeHtml(key)}" style="${isUnmapped ? 'opacity: 0.45;' : ''}">
                                    <div class="pt-1">
                                        <input type="checkbox" class="col-enable-cb form-check-input" ${isUnmapped ? '' : 'checked'} data-key="${escapeHtml(key)}">
                                    </div>
                                    ${configs.length > 1 ? `
                                        <div class="pt-1">
                                            <span class="badge bg-secondary-subtle text-body border" style="font-size: 11px;">
                                                <i class="fa-solid fa-file-excel text-success me-1"></i>${escapeHtml(col.sheet)}
                                            </span>
                                        </div>
                                    ` : ''}
                                    <div class="rg-content-col-details">
                                        <div class="rg-content-col-line1">
                                            <span class="badge bg-primary-subtle text-primary font-monospace fw-bold px-2 py-1" style="font-size: 12px;">
                                                ${escapeHtml(col.name)}
                                            </span>
                                            <span class="text-muted">›</span>
                                            <span class="fw-semibold text-body" style="font-size: 13px;">
                                                ${escapeHtml(col.header_text || col.name)}
                                            </span>
                                        </div>
                                        <div class="rg-content-col-line2">
                                            <span class="text-muted small" style="font-size: 11px; white-space: nowrap;">
                                                <i class="fa-solid fa-database text-warning me-1"></i> Cột DB:
                                            </span>
                                            ${createSearchableSelectHtml({
                                                key: key,
                                                selectedValue: mappedDbCol,
                                                placeholder: '-- Tìm cột DB --',
                                                defaultLabel: `-- Bỏ qua (${col.name}) --`,
                                                options: dbColOptions,
                                                inputClass: 'map-searchable-input',
                                                colName: col.name,
                                                width: 'max-width: 340px; width: 100%;'
                                            })}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `) : `
                    <div class="text-muted small fst-italic p-3 text-center">
                        <i class="fa-solid fa-circle-info me-1 text-info"></i> Không có vùng Content (Cột nội dung) trong cấu hình này.
                    </div>
                `}
            </div>
        `;
        container.appendChild(contentCard);

        // 3. Summary Group Card (Hiển thị dạng list + gõ tìm kiếm param output ngay tại ô)
        const summaryCard = document.createElement('div');
        summaryCard.className = 'rg-group-card';
        summaryCard.innerHTML = `
            <div class="rg-group-header" data-group="summary">
                <div class="d-flex align-items-center">
                    <i class="fa-solid fa-chevron-down rg-group-toggle-icon me-2"></i>
                    <i class="fa-solid fa-calculator text-primary me-2"></i>
                    <strong>Summary (Tổng cộng)</strong>
                    <span class="badge bg-primary-subtle text-primary ms-2">${summaryItems.length} mục</span>
                </div>
            </div>
            <div class="rg-group-body p-2" id="group-body-summary">
                ${summaryItems.length > 0 ? `
                    <table class="rg-param-mapping-table">
                        <tbody>
                            ${summaryItems.map(s => {
                                const key = `${s.sheet}::${s.row || ''}::${s.col || ''}`;
                                const currentParam = state.paramMappings.summary[key] || '';
                                const rowColLabel = s.row ? `${s.row} • ${s.col || 'Ô'}` : (s.col || 'Ô');
                                return `
                                    <tr>
                                        <td class="cell-label">
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="badge bg-primary-subtle text-primary font-monospace fw-bold">${escapeHtml(rowColLabel)}</span>
                                                <span class="fw-semibold text-body text-truncate" title="${escapeHtml(s.text)}">${escapeHtml(s.text)}</span>
                                                ${configs.length > 1 ? `<span class="badge bg-secondary-subtle text-body ms-1 font-monospace" style="font-size: 10px;">${escapeHtml(s.sheet)}</span>` : ''}
                                            </div>
                                        </td>
                                        <td class="cell-select">
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="small text-muted" style="font-size: 11px; white-space: nowrap;"><i class="fa-solid fa-arrow-right-from-bracket text-primary me-1"></i>Param Output:</span>
                                                ${createSearchableSelectHtml({
                                                    key: key,
                                                    selectedValue: currentParam,
                                                    placeholder: '-- Gõ tìm Param Output --',
                                                    defaultLabel: '-- Giữ nguyên text tổng cộng --',
                                                    options: paramOptions,
                                                    inputClass: 'summary-param-searchable'
                                                })}
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                ` : `
                    <div class="text-muted small fst-italic p-2"><i class="fa-solid fa-circle-info me-1 text-info"></i> Không có vùng Summary được cấu hình cho sheet này.</div>
                `}
            </div>
        `;
        container.appendChild(summaryCard);

        // Group accordion toggles
        container.querySelectorAll('.rg-group-header').forEach(hdr => {
            hdr.addEventListener('click', () => {
                const card = hdr.closest('.rg-group-card');
                if (card) card.classList.toggle('collapsed');
            });
        });

        // View Mode Switcher events (Grid vs List)
        const btnGrid = contentCard.querySelector('#btn-toggle-grid');
        const btnList = contentCard.querySelector('#btn-toggle-list');
        if (btnGrid) {
            btnGrid.addEventListener('click', (e) => {
                e.stopPropagation();
                state.contentViewMode = 'grid';
                renderMappingTree();
            });
        }
        if (btnList) {
            btnList.addEventListener('click', (e) => {
                e.stopPropagation();
                state.contentViewMode = 'list';
                renderMappingTree();
            });
        }

        // Group table select change event
        const groupTableSel = contentCard.querySelector('#content-group-table-select');
        if (groupTableSel) {
            groupTableSel.addEventListener('change', () => {
                state.dataMember = groupTableSel.value;
                const activeRs = resultSets.find(rs => (rs.data_member || rs.name || 'Table0') === state.dataMember) || { columns: [] };
                state.dbColumns = activeRs.columns || [];
                renderDbColumnsBadges(state.dbColumns);
                renderRoutineResultSetsTree(state.currentShape);
                renderMappingTree();
            });
        }

        // Enable / Disable column checkbox events
        contentCard.querySelectorAll('.col-enable-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.dataset.key;
                if (!cb.checked) {
                    state.unmappedColumns.add(key);
                } else {
                    state.unmappedColumns.delete(key);
                }
                // Update opacity across all 3 rows in grid or row in list
                contentCard.querySelectorAll(`[data-col-cell="${CSS.escape(key)}"]`).forEach(td => {
                    td.style.opacity = cb.checked ? '1' : '0.45';
                });
                const rowItem = cb.closest('.rg-content-col-item');
                if (rowItem) rowItem.style.opacity = cb.checked ? '1' : '0.45';
            });
        });

        // Bind searchable select event handlers
        bindSearchableSelects(titleCard, (key, val) => {
            state.paramMappings.title[key] = val;
        });

        bindSearchableSelects(summaryCard, (key, val) => {
            state.paramMappings.summary[key] = val;
        });

        bindSearchableSelects(contentCard, (key, val) => {
            state.mapping[key] = val;
        });

        // Auto match columns
        autoMatchColumns();
    }

    // ─── Initial Options & Context Recovery ──────────────────────────────────
    let initialOptions = null;
    async function getInitialOptions() {
        if (initialOptions) return initialOptions;
        try {
            const api = await getPywebviewApi();
            if (api && typeof api.get_initial_options === 'function') {
                const opts = await api.get_initial_options();
                if (opts && typeof opts === 'object' && Object.keys(opts).length > 0) {
                    initialOptions = opts;
                    return initialOptions;
                }
            }
        } catch (_) {}

        // Fallback to URL search parameters
        try {
            const params = new URLSearchParams(window.location.search);
            const opts = {};
            if (params.get('connectionId')) opts.connectionId = params.get('connectionId');
            if (params.get('connectionName')) opts.connectionName = params.get('connectionName');
            if (params.get('database')) opts.database = params.get('database');
            if (params.get('schema')) opts.schema = params.get('schema');
            if (params.get('dbType')) opts.dbType = params.get('dbType');
            if (Object.keys(opts).length > 0) {
                initialOptions = opts;
                return initialOptions;
            }
        } catch (_) {}

        initialOptions = {};
        return initialOptions;
    }

    // ─── Action Bar: Connection > Database > Schema ──────────────────────────
    async function loadConnections() {
        const connLabel = document.getElementById('ide-ctx-conn-label');
        const connMenu = document.getElementById('ide-ctx-conn-menu');
        if (!connLabel || !connMenu) return;

        connLabel.textContent = 'Đang tải...';
        connMenu.innerHTML = '<li class="p-2 text-muted small text-center"><i class="fa-solid fa-spinner fa-spin me-1"></i> Đang nạp kết nối...</li>';

        const initOpts = await getInitialOptions();
        const initConnId = initOpts.connectionId || null;
        const initConnName = initOpts.connectionName || null;
        const initDb = initOpts.database || null;
        const initSchema = initOpts.schema || null;

        try {
            const res = await callApi('rg_get_connections');
            if (res.success && res.connections && res.connections.length > 0) {
                state.connections = res.connections;

                // Match initial connection (exact id, lowercase, or name)
                let targetConn = null;
                if (initConnId) {
                    const cleanInitId = String(initConnId).trim().toLowerCase();
                    targetConn = res.connections.find(c =>
                        c.id === initConnId ||
                        String(c.id).toLowerCase() === cleanInitId ||
                        c.name === initConnId ||
                        (c.name && String(c.name).toLowerCase() === cleanInitId)
                    );
                }
                if (!targetConn && initConnName) {
                    const cleanName = String(initConnName).trim().toLowerCase();
                    targetConn = res.connections.find(c =>
                        c.name === initConnName ||
                        (c.name && String(c.name).toLowerCase() === cleanName)
                    );
                }
                if (!targetConn) {
                    // Default to first active connection or first profile
                    targetConn = res.connections.find(c => c.is_active) || res.connections[0];
                }

                // Render Connection dropdown exactly matching IDE Action Bar
                renderConnectionMenu(targetConn ? targetConn.id : null);

                if (targetConn) {
                    await selectConnection(targetConn.id, initDb, initSchema);
                }
            } else {
                connLabel.textContent = 'Không có kết nối';
                connMenu.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-circle-info me-2"></i>Không có kết nối SQL Server / PostgreSQL</span></li>';
            }
        } catch (err) {
            connLabel.textContent = 'Lỗi kết nối';
            connMenu.innerHTML = `<li class="p-2 text-danger small text-center">Lỗi: ${escapeHtml(err.message)}</li>`;
        }
    }

    function renderConnectionMenu(currentId) {
        const connMenu = document.getElementById('ide-ctx-conn-menu');
        if (!connMenu) return;

        let html = '';
        html += '<li><h6 class="dropdown-header text-uppercase" style="font-size: 10px; letter-spacing: 0.5px;">Select Server / Connection</h6></li>';

        (state.connections || []).forEach(c => {
            const isCurrent = (c.id === currentId || (state.currentConnectionId && c.id === state.currentConnectionId));
            const statusBadge = c.is_active
                ? '<span class="badge bg-success-subtle text-success border border-success-subtle ms-2" style="font-size: 9px; padding: 2px 5px;">Connected</span>'
                : '<span class="badge bg-secondary-subtle text-muted border ms-2" style="font-size: 9px; padding: 2px 5px;">Click to connect</span>';
            const icon = c.is_active
                ? '<i class="fa-solid fa-server me-2 text-success"></i>'
                : '<i class="fa-solid fa-server me-2 text-secondary opacity-75"></i>';

            html += `
                <li>
                    <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" 
                       href="#" data-conn-id="${escapeHtml(c.id)}" style="cursor: pointer; font-size: 12px;">
                        <span class="d-flex align-items-center overflow-hidden">
                            ${icon}
                            <strong class="text-truncate" style="max-width: 140px;">${escapeHtml(c.name)}</strong>
                            <span class="text-muted ms-1 small" style="font-size: 10px;">(${escapeHtml(c.db_type || 'sqlserver')})</span>
                        </span>
                        <div class="d-flex align-items-center ms-2 flex-shrink-0">
                            ${statusBadge}
                            ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                        </div>
                    </a>
                </li>
            `;
        });

        connMenu.innerHTML = html;

        connMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const cid = item.dataset.connId;
                const btnConn = document.getElementById('ide-ctx-connection');
                if (window.bootstrap && btnConn) {
                    const dd = bootstrap.Dropdown.getInstance(btnConn);
                    if (dd) dd.hide();
                }
                selectConnection(cid);
            });
        });
    }

    async function selectConnection(connId, preferredDb = null, preferredSchema = null) {
        if (!connId) return;
        state.currentConnectionId = connId;
        const connObj = (state.connections || []).find(c => c.id === connId);
        const connLabel = document.getElementById('ide-ctx-conn-label');
        if (connLabel) {
            connLabel.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1 text-warning"></i> <span>Đang nạp...</span>`;
        }

        const connSel = document.getElementById('conn-select');
        if (connSel) connSel.value = connId;

        renderConnectionMenu(connId);

        try {
            // Load databases for this connection
            const targetDb = preferredDb || (connObj ? connObj.database : null);
            await loadDatabases(connId, targetDb, preferredSchema);
            if (connLabel) {
                connLabel.innerHTML = `<i class="fa-solid fa-plug-circle-bolt me-1 text-success"></i> <span class="text-truncate" style="max-width: 110px;">${escapeHtml(connObj ? connObj.name : connId)}</span>`;
            }
            setStatus(`Đã chọn kết nối: ${connObj ? connObj.name : connId}`, 'success');
        } catch (err) {
            if (connLabel) connLabel.textContent = 'Lỗi kết nối';
            setStatus(`Lỗi kết nối: ${err.message}`, 'error');
        }
    }

    async function loadDatabases(connId, preferredDb = null, preferredSchema = null) {
        const dbLabel = document.getElementById('ide-ctx-db-label');
        const dbMenu = document.getElementById('ide-ctx-db-menu');
        if (!dbLabel || !dbMenu) return;

        dbLabel.textContent = 'Đang tải...';
        dbMenu.innerHTML = '<li class="p-2 text-muted small text-center"><i class="fa-solid fa-spinner fa-spin me-1"></i> Đang nạp database...</li>';

        try {
            const res = await callApi('rg_get_databases', connId);
            const dbs = (res.success && res.databases && res.databases.length > 0)
                ? res.databases
                : [preferredDb || 'master'];

            let selDb = null;
            if (preferredDb && dbs.some(d => d.toLowerCase() === preferredDb.toLowerCase())) {
                selDb = dbs.find(d => d.toLowerCase() === preferredDb.toLowerCase());
            } else if (res.default_database && dbs.includes(res.default_database)) {
                selDb = res.default_database;
            } else {
                selDb = dbs[0];
            }

            renderDatabaseMenu(dbs, selDb);
            await selectDatabase(selDb, preferredSchema);
        } catch (err) {
            dbLabel.textContent = preferredDb || 'master';
            renderDatabaseMenu([preferredDb || 'master'], preferredDb || 'master');
            await selectDatabase(preferredDb || 'master', preferredSchema);
        }
    }

    function renderDatabaseMenu(databases, currentDb) {
        const dbMenu = document.getElementById('ide-ctx-db-menu');
        if (!dbMenu) return;

        let html = '';
        html += `
            <li class="ide-ctx-db-header">
                <div class="d-flex align-items-center justify-content-between">
                    <span class="ide-ctx-db-header-title">SELECT DATABASE</span>
                    <button type="button" class="ide-ctx-db-filter-btn" title="Lọc database">
                        <i class="fa-solid fa-filter"></i>
                    </button>
                </div>
                <div class="ide-ctx-db-filter-box d-none mt-1">
                    <div class="ide-ctx-db-filter-group input-group input-group-sm">
                        <span class="input-group-text py-0 px-2 bg-transparent border-end-0 text-muted"><i class="fa-solid fa-magnifying-glass" style="font-size: 11px;"></i></span>
                        <input type="text" class="form-control form-control-sm ide-ctx-db-filter-input border-start-0 ps-1" placeholder="Lọc database..." autocomplete="off" spellcheck="false" style="font-size: 11px;">
                    </div>
                </div>
            </li>
        `;

        if (!databases || databases.length === 0) {
            html += '<li><span class="dropdown-item text-muted small p-2">Không tìm thấy database</span></li>';
        } else {
            databases.forEach(d => {
                const isCur = (d === currentDb);
                html += `
                    <li class="ide-ctx-db-item" data-db="${escapeHtml(d)}">
                        <a class="dropdown-item d-flex align-items-center py-1 px-3 ${isCur ? 'active' : ''}" href="#" style="cursor: pointer; font-size: 12px;">
                            <i class="fa-solid fa-database text-info me-2"></i>
                            <span class="text-truncate">${escapeHtml(d)}</span>
                            ${isCur ? '<i class="fa-solid fa-check ms-auto text-primary"></i>' : ''}
                        </a>
                    </li>
                `;
            });
        }

        dbMenu.innerHTML = html;

        // Header click shouldn't close dropdown
        const headerEl = dbMenu.querySelector('.ide-ctx-db-header');
        if (headerEl) {
            headerEl.addEventListener('click', (e) => e.stopPropagation());
            const filterBtn = headerEl.querySelector('.ide-ctx-db-filter-btn');
            const filterBox = headerEl.querySelector('.ide-ctx-db-filter-box');
            const filterInput = headerEl.querySelector('.ide-ctx-db-filter-input');
            if (filterBtn && filterBox) {
                filterBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    filterBox.classList.toggle('d-none');
                    if (!filterBox.classList.contains('d-none') && filterInput) {
                        filterInput.focus();
                    }
                });
            }
            if (filterInput) {
                filterInput.addEventListener('input', (e) => {
                    const q = (e.target.value || '').trim().toLowerCase();
                    dbMenu.querySelectorAll('.ide-ctx-db-item').forEach(li => {
                        const dbName = (li.dataset.db || '').toLowerCase();
                        li.style.display = (!q || dbName.includes(q)) ? '' : 'none';
                    });
                });
            }
        }

        // Bind database selection click
        dbMenu.querySelectorAll('.ide-ctx-db-item a').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const li = a.closest('.ide-ctx-db-item');
                const db = li ? li.dataset.db : null;
                const btnDb = document.getElementById('ide-ctx-database');
                if (window.bootstrap && btnDb) {
                    const dd = bootstrap.Dropdown.getInstance(btnDb);
                    if (dd) dd.hide();
                }
                if (db) selectDatabase(db);
            });
        });
    }

    async function selectDatabase(dbName, preferredSchema = null) {
        state.currentDatabase = dbName;
        const dbLabel = document.getElementById('ide-ctx-db-label');
        if (dbLabel) dbLabel.textContent = dbName || '—';

        // Clear routine cache so it fetches from the new database
        state.routineCache = {};

        await loadSchemas(state.currentConnectionId, dbName, preferredSchema);
    }

    async function loadSchemas(connId, database, preferredSchema = null) {
        const schemaLabel = document.getElementById('ide-ctx-schema-label');
        const schemaMenu = document.getElementById('ide-ctx-schema-menu');
        if (!schemaLabel || !schemaMenu) return;

        schemaLabel.textContent = 'Đang tải...';
        schemaMenu.innerHTML = '<li class="p-2 text-muted small text-center"><i class="fa-solid fa-spinner fa-spin me-1"></i> Đang nạp schema...</li>';

        try {
            const res = await callApi('rg_get_schemas', connId, database);
            const schemas = (res.success && res.schemas && res.schemas.length > 0)
                ? res.schemas
                : ['dbo'];

            let selSchema = null;
            if (preferredSchema && schemas.some(s => s.toLowerCase() === preferredSchema.toLowerCase())) {
                selSchema = schemas.find(s => s.toLowerCase() === preferredSchema.toLowerCase());
            } else if (res.default_schema && schemas.includes(res.default_schema)) {
                selSchema = res.default_schema;
            } else if (schemas.includes('dbo')) {
                selSchema = 'dbo';
            } else {
                selSchema = schemas[0];
            }

            renderSchemaMenu(schemas, selSchema);
            await selectSchema(selSchema);
        } catch (err) {
            schemaLabel.textContent = 'dbo';
            renderSchemaMenu(['dbo'], 'dbo');
            await selectSchema('dbo');
        }
    }

    function renderSchemaMenu(schemas, currentSchema) {
        const schemaMenu = document.getElementById('ide-ctx-schema-menu');
        if (!schemaMenu) return;

        let html = '';
        html += '<li><h6 class="dropdown-header text-uppercase" style="font-size: 10px; letter-spacing: 0.5px;">SELECT SCHEMA</h6></li>';

        if (!schemas || schemas.length === 0) {
            html += '<li><span class="dropdown-item text-muted small p-2">Không tìm thấy schema</span></li>';
        } else {
            schemas.forEach(s => {
                const isCur = (s === currentSchema);
                html += `
                    <li>
                        <a class="dropdown-item d-flex align-items-center py-1 px-3 ${isCur ? 'active' : ''}" href="#" data-schema="${escapeHtml(s)}" style="cursor: pointer; font-size: 12px;">
                            <i class="fa-solid fa-layer-group text-warning me-2"></i>
                            <span class="text-truncate">${escapeHtml(s)}</span>
                            ${isCur ? '<i class="fa-solid fa-check ms-auto text-primary"></i>' : ''}
                        </a>
                    </li>
                `;
            });
        }

        schemaMenu.innerHTML = html;

        schemaMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const schema = item.dataset.schema;
                const btnSchema = document.getElementById('ide-ctx-schema');
                if (window.bootstrap && btnSchema) {
                    const dd = bootstrap.Dropdown.getInstance(btnSchema);
                    if (dd) dd.hide();
                }
                if (schema) selectSchema(schema);
            });
        });
    }

    async function selectSchema(schemaName) {
        state.currentSchema = schemaName;
        const schemaLabel = document.getElementById('ide-ctx-schema-label');
        if (schemaLabel) schemaLabel.textContent = schemaName || '—';

        await loadRoutines(state.currentConnectionId, schemaName);
    }

    // ─── Routine Selection (Cache, Lazy Loading khi cuộn & Search Dropdown) ────
    let routinePaging = {
        allList: [],
        filteredList: [],
        renderedCount: 0,
        pageSize: 40,
        isLoading: false
    };

    async function loadRoutines(connId, schema = null, search = '') {
        if (!connId) return;
        const dbName = state.currentDatabase || '';
        const listContainer = document.getElementById('routine-list-container');
        const routineLabel = document.getElementById('selected-routine-label');
        const cacheKey = `${connId}_${dbName}_${schema || 'all'}`;

        if (!state.currentRoutine && routineLabel) {
            routineLabel.innerHTML = `<i class="fa-solid fa-bolt text-warning me-1"></i> -- Chọn Procedure / Function --`;
        }

        // 1. Kiểm tra ở cache trước nếu là kết nối hiện thời để giảm số lần query
        if (state.routineCache[cacheKey]) {
            state.routines = state.routineCache[cacheKey];
            routinePaging.allList = state.routines;
            initRoutinePagination();
            setStatus(`Đã nạp ${state.routines.length} routines từ bộ nhớ cache.`, 'info');
            return;
        }

        if (listContainer) {
            listContainer.innerHTML = '<div class="text-muted small p-2 text-center"><i class="fa-solid fa-spinner fa-spin me-1"></i> Đang tải procedures & functions...</div>';
        }

        try {
            const res = await callApi('rg_list_routines', connId, schema, search, dbName);
            if (res.success && res.routines) {
                state.routines = res.routines;
                state.routineCache[cacheKey] = res.routines;
                routinePaging.allList = state.routines;
                initRoutinePagination();
                setStatus(`Đã tải thành công ${res.routines.length} routines từ kết nối.`, 'success');
            } else {
                if (listContainer) {
                    listContainer.innerHTML = `<div class="text-danger small p-2 text-center"><i class="fa-solid fa-triangle-exclamation me-1"></i> Lỗi: ${escapeHtml(res.error || 'Không tải được routines')}</div>`;
                }
            }
        } catch (err) {
            if (listContainer) {
                listContainer.innerHTML = `<div class="text-danger small p-2 text-center"><i class="fa-solid fa-circle-xmark me-1"></i> Lỗi: ${escapeHtml(err.message)}</div>`;
            }
        }
    }

    function initRoutinePagination() {
        const searchInput = document.getElementById('routine-search-input');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        if (query) {
            routinePaging.filteredList = routinePaging.allList.filter(r => {
                const full = (r.schema ? `${r.schema}.${r.name}` : r.name).toLowerCase();
                return full.includes(query);
            });
        } else {
            routinePaging.filteredList = [...routinePaging.allList];
        }

        routinePaging.renderedCount = 0;
        const listContainer = document.getElementById('routine-list-container');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        if (routinePaging.filteredList.length === 0) {
            listContainer.innerHTML = '<div class="text-muted small p-2 text-center fst-italic">Không tìm thấy Procedure/Function nào</div>';
            return;
        }

        // Render batch đầu tiên
        appendRoutineBatch(routinePaging.pageSize);

        // Gắn sự kiện cuộn lazy load
        listContainer.onscroll = () => {
            if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 35) {
                if (routinePaging.renderedCount < routinePaging.filteredList.length) {
                    appendRoutineBatch(routinePaging.pageSize);
                }
            }
        };

        // Gắn sự kiện gõ tìm kiếm bên trong dropdown
        if (searchInput && !searchInput.dataset.bound) {
            searchInput.dataset.bound = 'true';
            searchInput.addEventListener('input', () => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    initRoutinePagination();
                }, 150);
            });
        }

        // Auto focus search input when routine dropdown opens
        const btnRoutineDd = document.getElementById('btn-routine-dropdown');
        if (btnRoutineDd && !btnRoutineDd.dataset.bound) {
            btnRoutineDd.dataset.bound = 'true';
            btnRoutineDd.addEventListener('shown.bs.dropdown', () => {
                const inp = document.getElementById('routine-search-input');
                if (inp) {
                    inp.focus();
                    inp.select();
                }
            });
        }
    }

    function appendRoutineBatch(count) {
        const listContainer = document.getElementById('routine-list-container');
        const hiddenSelect = document.getElementById('routine-select');
        const routineLabel = document.getElementById('selected-routine-label');
        if (!listContainer) return;

        const nextBatch = routinePaging.filteredList.slice(routinePaging.renderedCount, routinePaging.renderedCount + count);
        if (nextBatch.length === 0) return;

        const frag = document.createDocumentFragment();
        nextBatch.forEach(r => {
            const isProc = (r.type === 'P' || (r.kind && r.kind.toLowerCase().includes('procedure')));
            const tag = isProc
                ? '<span class="badge bg-primary-subtle text-primary me-1">[P]</span>'
                : '<span class="badge bg-success-subtle text-success me-1">[FN]</span>';
            const full = r.schema ? `${r.schema}.${r.name}` : r.name;
            const active = (state.currentRoutine && state.currentRoutine.name === r.name) ? 'active' : '';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `rg-routine-item-btn ${active}`;
            btn.dataset.name = r.name;
            btn.dataset.schema = r.schema || '';
            btn.dataset.type = isProc ? 'P' : 'FN';
            btn.title = full;
            btn.innerHTML = `
                ${tag}
                <span class="text-truncate font-monospace" style="max-width: 250px;">${escapeHtml(full)}</span>
            `;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                listContainer.querySelectorAll('.rg-routine-item-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const rName = btn.dataset.name;
                const rSchema = btn.dataset.schema;
                state.currentRoutine = { name: rName, schema: rSchema };

                if (routineLabel) {
                    routineLabel.innerHTML = `${tag} <span class="text-truncate font-monospace">${escapeHtml(full)}</span>`;
                }

                if (hiddenSelect) hiddenSelect.value = rName;

                // Close dropdown menu via Bootstrap
                const btnRoutineDd = document.getElementById('btn-routine-dropdown');
                if (window.bootstrap && btnRoutineDd) {
                    const dd = bootstrap.Dropdown.getInstance(btnRoutineDd);
                    if (dd) dd.hide();
                }

                // Tự động phân tích cấu trúc ngay sau khi chọn routine
                describeSelectedRoutine();
            });

            frag.appendChild(btn);
        });

        listContainer.appendChild(frag);
        routinePaging.renderedCount += nextBatch.length;

        // Sync hidden select if this is first batch
        if (hiddenSelect && routinePaging.renderedCount === nextBatch.length) {
            hiddenSelect.innerHTML = routinePaging.allList.map(r => {
                const full = r.schema ? `${r.schema}.${r.name}` : r.name;
                return `<option value="${escapeHtml(r.name)}" data-schema="${escapeHtml(r.schema || '')}">${escapeHtml(full)}</option>`;
            }).join('');
        }
    }

    async function describeSelectedRoutine() {
        const routineName = state.currentRoutine ? state.currentRoutine.name : (document.getElementById('routine-select') ? document.getElementById('routine-select').value : '');
        const schema = state.currentRoutine ? state.currentRoutine.schema : '';
        const connId = state.currentConnectionId;
        const dbName = state.currentDatabase || '';

        if (!routineName) {
            setStatus('Vui lòng chọn một Procedure/Function trước khi phân tích cấu trúc.', 'warning');
            return;
        }

        setStatus(`Đang phân tích cấu trúc routine ${routineName} (Static Analysis)...`, 'info');
        try {
            const res = await callApi('rg_describe_routine', state.sessionId, connId, routineName, schema, dbName);
            if (res.success && res.shape) {
                state.currentShape = res.shape;
                const resultSets = res.shape.result_sets || [];

                const rsGroup = document.getElementById('result-set-group');
                if (rsGroup) rsGroup.style.display = 'none';

                const activeSet = resultSets[0] || { columns: [] };
                state.dataMember = activeSet.data_member || activeSet.name || 'Table0';
                state.dbColumns = activeSet.columns || [];

                renderDbColumnsBadges(state.dbColumns);
                renderRoutineOutputParamsCard(res.shape);
                renderRoutineResultSetsTree(res.shape);
                renderMappingTree();
                setStatus(`Phân tích thành công: Routine trả về ${state.dbColumns.length} cột DB (không thực thi routine).`, 'success');
            } else {
                setStatus(`Lỗi phân tích routine: ${res.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi phân tích routine: ${err.message}`, 'error');
        }
    }

    function renderRoutineOutputParamsCard(shape) {
        const cardEl = document.getElementById('routine-output-params-card');
        const badgeEl = document.getElementById('output-params-count-badge');
        if (!cardEl) return;

        if (!shape) {
            cardEl.innerHTML = '<span class="text-muted small fst-italic">Chưa có tham số Output</span>';
            if (badgeEl) badgeEl.classList.add('d-none');
            return;
        }

        const outputParams = (shape.output_params && shape.output_params.length > 0)
            ? shape.output_params
            : ((shape.parameters || []).filter(p => p.direction && p.direction.toLowerCase().includes('out')));

        if (badgeEl) {
            badgeEl.textContent = `${outputParams.length} param`;
            badgeEl.classList.toggle('d-none', outputParams.length === 0);
        }

        if (outputParams.length === 0) {
            cardEl.innerHTML = '<div class="text-muted small fst-italic p-1">Routine không có tham số dạng OUTPUT</div>';
            return;
        }

        cardEl.innerHTML = `
            <div class="d-flex flex-column gap-1">
                ${outputParams.map(p => {
                    const cleanName = p.name.replace(/^@/, '');
                    return `
                        <div class="border rounded px-2 py-1 small d-flex align-items-center justify-content-between" style="background: rgba(13, 202, 240, 0.05); font-size: 11px;">
                            <div class="font-monospace text-truncate" title="@${escapeHtml(cleanName)}">
                                <i class="fa-solid fa-tag text-info me-1"></i>
                                <strong>@${escapeHtml(cleanName)}</strong>
                            </div>
                            <span class="badge bg-secondary-subtle text-body border font-monospace" style="font-size: 9.5px;">${escapeHtml(p.type || p.data_type || 'nvarchar')}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderRoutineResultSetsTree(shape) {
        const treeEl = document.getElementById('routine-result-sets-card');
        const badgeEl = document.getElementById('tables-count-badge');
        if (!treeEl) return;

        if (!shape) {
            treeEl.innerHTML = '<span class="text-muted small fst-italic">Chưa phân tích routine</span>';
            if (badgeEl) badgeEl.classList.add('d-none');
            return;
        }

        const resultSets = shape.result_sets || [];
        if (badgeEl) {
            badgeEl.textContent = `${resultSets.length} table`;
            badgeEl.classList.toggle('d-none', resultSets.length === 0);
        }

        if (resultSets.length === 0) {
            treeEl.innerHTML = '<div class="text-muted small fst-italic p-1">Không phát hiện table kết quả trả về</div>';
            return;
        }

        if (!state.dataMember && resultSets.length > 0) {
            state.dataMember = resultSets[0].data_member || resultSets[0].name || 'Table0';
            state.dbColumns = resultSets[0].columns || [];
        }

        let html = '<div class="d-flex flex-column gap-1.5">';
        resultSets.forEach((rs, idx) => {
            const dm = rs.data_member || rs.name || ('Table' + idx);
            const cols = rs.columns || [];
            const mainLabel = rs.table_source || dm;
            const subLabel = (rs.table_source && rs.table_source !== dm) ? dm : '';

            html += `
                <div class="rg-table-node" data-idx="${idx}">
                    <div class="rg-table-node-header" style="cursor: pointer;" title="Bấm để ẩn/hiện danh sách cột">
                        <div class="d-flex align-items-center text-truncate me-1">
                            <i class="fa-solid fa-table text-warning me-1.5" style="font-size: 11px;"></i>
                            <strong class="text-warning font-monospace">${escapeHtml(mainLabel)}</strong>
                            ${subLabel ? `<span class="text-muted small ms-1 font-monospace" style="font-size: 10px;">(${escapeHtml(subLabel)})</span>` : ''}
                        </div>
                        <div class="d-flex align-items-center gap-1 flex-shrink-0">
                            <span class="badge bg-primary-subtle text-primary" style="font-size: 9.5px;">${cols.length} cột</span>
                        </div>
                    </div>
                    <div class="rg-table-node-cols">
                        ${cols.length > 0 ? cols.map(c => `
                            <span class="badge bg-body-tertiary text-body border font-monospace" style="font-size: 10px; font-weight: normal;" title="Kiểu dữ liệu: ${escapeHtml(c.type || '')}">
                                <i class="fa-solid fa-columns text-muted me-1" style="font-size: 8px;"></i>${escapeHtml(c.name)}
                            </span>
                        `).join('') : '<span class="text-muted small fst-italic" style="font-size: 10px;">(Không có cột)</span>'}
                    </div>
                </div>
            `;
        });
        html += '</div>';

        treeEl.innerHTML = html;

        // Toggle expand/collapse columns list on header click (without changing Content table selection)
        treeEl.querySelectorAll('.rg-table-node-header').forEach(hdr => {
            hdr.addEventListener('click', () => {
                const node = hdr.closest('.rg-table-node');
                const colsEl = node ? node.querySelector('.rg-table-node-cols') : null;
                if (colsEl) {
                    colsEl.classList.toggle('d-none');
                }
            });
        });
    }

    function renderDbColumnsBadges(columns) {
        const container = document.getElementById('db-columns-badges');
        if (!container) return;
        if (!columns || columns.length === 0) {
            container.innerHTML = '<span class="text-muted small fst-italic">Không có cột nào</span>';
            return;
        }
        container.innerHTML = columns.map(c => `
            <span class="rg-col-badge text-info" title="${escapeHtml(c.data_type || '')}">
                ${escapeHtml(c.name)}
            </span>
        `).join('');
    }

    function autoMatchSingleColumn(selectEl, dbCols) {
        if (!dbCols || !dbCols.length) return;
        const excelCol = (selectEl.dataset.col || '').toLowerCase().replace(/^col_/, '');
        const matched = dbCols.find(dbCol => {
            const name = dbCol.name.toLowerCase();
            return excelCol === name || excelCol.includes(name) || name.includes(excelCol);
        });
        if (matched) {
            selectEl.value = matched.name;
        }
    }

    function autoMatchColumns() {
        document.querySelectorAll('.map-searchable-input').forEach(inp => {
            if (inp.dataset.selectedValue) return;
            const key = inp.dataset.key;
            const colName = inp.dataset.col || '';
            let dbCols = state.dbColumns;
            if (state.currentShape && state.currentShape.result_sets) {
                const rs = state.currentShape.result_sets.find(r => (r.data_member || 'Table0') === state.dataMember);
                if (rs && rs.columns) dbCols = rs.columns;
            }
            if (!dbCols || !dbCols.length) return;
            const cleanCol = colName.toLowerCase().replace(/^col_/, '');
            const matched = dbCols.find(dbCol => {
                const name = dbCol.name.toLowerCase();
                return cleanCol === name || cleanCol.includes(name) || name.includes(cleanCol);
            });
            if (matched) {
                inp.dataset.selectedValue = matched.name;
                const label = `${matched.name} (${matched.type || matched.data_type || 'var'})`;
                inp.dataset.selectedLabel = label;
                inp.value = label;
                state.mapping[key] = matched.name;
            }
        });

        document.querySelectorAll('.map-select').forEach(sel => {
            if (sel.value) return;
            const key = sel.dataset.key;
            let dbCols = state.dbColumns;
            if (state.currentShape && state.currentShape.result_sets) {
                const rs = state.currentShape.result_sets.find(r => (r.data_member || 'Table0') === state.dataMember);
                if (rs && rs.columns) dbCols = rs.columns;
            }
            autoMatchSingleColumn(sel, dbCols);
            if (sel.value) {
                state.mapping[key] = sel.value;
            }
        });
    }

    // ─── Step 4: Redesigned XML Output Screen (Top Tabs + 2-Panel Split) ────
    async function initStep4() {
        setStatus('Đang biên dịch Layout XML và Datasource XML cho các sheet...', 'info');

        const modeEl = document.getElementById('mapping-mode');
        const mode = (modeEl && modeEl.value) ? modeEl.value : 'name_tag';

        // Collect configured sheets by actual sheetName (deduplicating fileId::sheetName keys)
        const sheetMapByName = new Map();
        Object.keys(state.sheetConfigs).forEach(k => {
            const cfg = state.sheetConfigs[k];
            if (!cfg || !cfg.regions) return;
            const hasRegion = cfg.regions.header || cfg.regions.title || cfg.regions.summary;
            if (hasRegion) {
                const sName = cfg.sheetName || k;
                if (!sheetMapByName.has(sName)) {
                    sheetMapByName.set(sName, cfg);
                }
            }
        });
        const configuredSheets = Array.from(sheetMapByName.keys());
        if (configuredSheets.length === 0 && state.currentSheet) {
            configuredSheets.push(state.currentSheet);
            sheetMapByName.set(state.currentSheet, state.sheetConfigs[state.currentSheet] || {});
        }

        try {
            // Apply mapping for each configured sheet
            for (const sName of configuredSheets) {
                const sheetCfg = sheetMapByName.get(sName) || state.sheetConfigs[sName] || {};
                const sheetCols = sheetCfg.columns || [];

                const sheetMap = {};
                sheetCols.forEach(c => {
                    const k = `${sName}::${c.name}`;
                    if (state.mapping[k]) {
                        sheetMap[c.name] = state.mapping[k];
                    } else if (state.mapping[c.name]) {
                        sheetMap[c.name] = state.mapping[c.name];
                    }
                });

                const sheetUnmapped = sheetCols
                    .filter(c => state.unmappedColumns.has(`${sName}::${c.name}`) || state.unmappedColumns.has(c.name))
                    .map(c => c.name);

                const dataMember = sheetCfg.dataMember || state.dataMember || 'Table0';

                // Collect parameter mappings for Title and Summary for this sheet
                const sheetParamMap = {};
                Object.entries(state.paramMappings.title || {}).forEach(([k, paramVal]) => {
                    if (!paramVal) return;
                    const parts = k.split('::');
                    const sheetPart = parts[0];
                    const rowPart = parts[1];
                    const colPart = parts[2];
                    if (sheetPart === sName || sheetPart === 'all' || !sheetPart) {
                        if (rowPart && colPart) {
                            sheetParamMap[`title::${rowPart}::${colPart}`] = paramVal;
                            sheetParamMap[`${rowPart}::${colPart}`] = paramVal;
                        }
                    }
                });
                Object.entries(state.paramMappings.summary || {}).forEach(([k, paramVal]) => {
                    if (!paramVal) return;
                    const parts = k.split('::');
                    const sheetPart = parts[0];
                    const rowPart = parts[1];
                    const colPart = parts[2];
                    if (sheetPart === sName || sheetPart === 'all' || !sheetPart) {
                        if (rowPart && colPart) {
                            sheetParamMap[`summary::${rowPart}::${colPart}`] = paramVal;
                            sheetParamMap[`${rowPart}::${colPart}`] = paramVal;
                        }
                    }
                });

                // Also directly bind Title / Summary cell text to mapped parameters
                (sheetCfg.title_items || []).forEach(it => {
                    const k = `${sName}::${it.row || ''}::${it.col || ''}`;
                    const pVal = (state.paramMappings.title || {})[k];
                    if (pVal && it.text) {
                        sheetParamMap[it.text.trim()] = pVal;
                        sheetParamMap[it.text.replace(/[:：\s]+$/, '').trim()] = pVal;
                        if (it.row && it.col) {
                            sheetParamMap[`title::${it.row}::${it.col}`] = pVal;
                            sheetParamMap[`${it.row}::${it.col}`] = pVal;
                        }
                    }
                });
                (sheetCfg.summary_items || []).forEach(it => {
                    const k = `${sName}::${it.row || ''}::${it.col || ''}`;
                    const pVal = (state.paramMappings.summary || {})[k];
                    if (pVal && it.text) {
                        sheetParamMap[it.text.trim()] = pVal;
                        sheetParamMap[it.text.replace(/[:：\s]+$/, '').trim()] = pVal;
                        if (it.row && it.col) {
                            sheetParamMap[`summary::${it.row}::${it.col}`] = pVal;
                            sheetParamMap[`${it.row}::${it.col}`] = pVal;
                        }
                    }
                });

                const resMap = await callApi('rg_apply_mapping', state.sessionId, dataMember, sheetMap, mode, sheetUnmapped, sName, sheetParamMap);
                if (resMap.success && resMap.layout_xml) {
                    sheetCfg.layoutXml = resMap.layout_xml;
                    if (state.sheetConfigs[sName]) state.sheetConfigs[sName].layoutXml = resMap.layout_xml;
                    const cfgKey = getSheetConfigKey(state.activeFileId, sName);
                    if (state.sheetConfigs[cfgKey]) state.sheetConfigs[cfgKey].layoutXml = resMap.layout_xml;
                    if (sName === state.currentSheet) {
                        state.xmlLayout = resMap.layout_xml;
                    }
                }
            }

            // Call build to finalize datasource and layout
            const resBuild = await callApi('rg_build', state.sessionId);
            if (resBuild.success) {
                state.xmlDatasource = resBuild.datasource_xml || '';

                if (resBuild.sheet_layouts) {
                    Object.keys(resBuild.sheet_layouts).forEach(s => {
                        if (!state.sheetConfigs[s]) state.sheetConfigs[s] = {};
                        state.sheetConfigs[s].layoutXml = resBuild.sheet_layouts[s];
                        const cfgKey = getSheetConfigKey(state.activeFileId, s);
                        if (state.sheetConfigs[cfgKey]) state.sheetConfigs[cfgKey].layoutXml = resBuild.sheet_layouts[s];
                    });
                }

                if (!state.activeStep4Sheet || !configuredSheets.includes(state.activeStep4Sheet)) {
                    state.activeStep4Sheet = configuredSheets[0] || state.currentSheet;
                }
                const activeS = state.activeStep4Sheet;
                if (state.sheetConfigs[activeS] && state.sheetConfigs[activeS].layoutXml) {
                    state.xmlLayout = state.sheetConfigs[activeS].layoutXml;
                } else if (resBuild.layout_xml) {
                    state.xmlLayout = resBuild.layout_xml;
                }

                // Render top sheet tabs
                renderStep4SheetTabs(configuredSheets);

                // Setup left options (Datasource vs Layout)
                setupStep4OptionCards();

                // Ensure layout option is active
                if (!state.activeStep4Option) state.activeStep4Option = 'layout';

                // Render editor
                renderStep4XmlEditor();

                setStatus('Đã biên dịch thành công Layout XML và Datasource XML!', 'success');
            } else {
                setStatus(`Lỗi build XML: ${resBuild.error}`, 'error');
            }
        } catch (err) {
            setStatus(`Lỗi xuất XML: ${err.message}`, 'error');
        }
    }

    function renderStep4SheetTabs(sheetList) {
        const tabsContainer = document.getElementById('step4-sheet-tabs');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        if (!sheetList || sheetList.length === 0) {
            sheetList = [state.currentSheet || 'Sheet1'];
        }

        if (!state.activeStep4Sheet || !sheetList.includes(state.activeStep4Sheet)) {
            state.activeStep4Sheet = sheetList[0];
        }

        sheetList.forEach(sName => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `rg-step4-sheet-tab ${sName === state.activeStep4Sheet ? 'active' : ''}`;
            btn.dataset.sheet = sName;
            btn.innerHTML = `<i class="fa-solid fa-file-excel text-success me-1"></i> ${escapeHtml(sName)}`;

            btn.addEventListener('click', () => {
                tabsContainer.querySelectorAll('.rg-step4-sheet-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.activeStep4Sheet = sName;
                renderStep4XmlEditor();
            });

            tabsContainer.appendChild(btn);
        });
    }

    function setupStep4OptionCards() {
        const optDs = document.getElementById('opt-datasource');
        const optLy = document.getElementById('opt-layout');

        // Update card meta info
        const dsMeta = document.getElementById('opt-datasource-meta');
        if (dsMeta) {
            if (state.currentRoutine) {
                const paramCount = state.currentShape && state.currentShape.input_params ? state.currentShape.input_params.length : 0;
                dsMeta.textContent = `Routine: ${state.currentRoutine.name} • ${paramCount} params`;
            } else {
                dsMeta.textContent = 'report_datasource.xml • Nguồn dữ liệu';
            }
        }

        const lyMeta = document.getElementById('opt-layout-meta');
        if (lyMeta) {
            const count = state.allColumns.length;
            lyMeta.textContent = `report_layout.xml • ${count} cột layout`;
        }

        if (optDs) {
            optDs.onclick = () => {
                optDs.classList.add('active');
                if (optLy) optLy.classList.remove('active');
                state.activeStep4Option = 'datasource';
                renderStep4XmlEditor();
            };
        }

        if (optLy) {
            optLy.onclick = () => {
                optLy.classList.add('active');
                if (optDs) optDs.classList.remove('active');
                state.activeStep4Option = 'layout';
                renderStep4XmlEditor();
            };
        }
    }

    function renderStep4XmlEditor() {
        const sheetName = state.activeStep4Sheet || state.currentSheet || 'Sheet1';
        const option = state.activeStep4Option || 'layout';

        // Update editor header title & badges
        const sheetBadge = document.getElementById('step4-active-sheet-badge');
        if (sheetBadge) {
            sheetBadge.innerHTML = `<i class="fa-solid fa-file-excel me-1"></i> ${escapeHtml(sheetName)}`;
        }

        const fileTitle = document.getElementById('step4-active-file-title');
        if (fileTitle) {
            fileTitle.textContent = option === 'layout' ? 'report_layout.xml' : 'report_datasource.xml';
        }

        // Get content
        let xmlContent = '';
        if (option === 'layout') {
            const sheetCfg = state.sheetConfigs[sheetName];
            xmlContent = (sheetCfg && sheetCfg.layoutXml) ? sheetCfg.layoutXml : state.xmlLayout;
        } else {
            xmlContent = state.xmlDatasource;
        }

        // Stats badge
        const statsBadge = document.getElementById('step4-xml-stats-badge');
        if (statsBadge) {
            const lines = (xmlContent || '').split('\n').length;
            const size = formatFileSize(new Blob([xmlContent || '']).size);
            statsBadge.textContent = `${lines} dòng • ${size}`;
        }

        // Render in Monaco Editor
        const fallback = document.getElementById('xml-fallback-editor');
        const container = document.getElementById('monaco-editor-container');

        if (window.monaco && window.monaco.editor) {
            if (!monacoEditorInstance) {
                fallback.style.display = 'none';
                const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
                const monacoTheme = window.MonacoInit ? window.MonacoInit.getMonacoTheme(curTheme) : 'vs-dark';

                monacoEditorInstance = window.monaco.editor.create(container, {
                    value: xmlContent || '',
                    language: 'xml',
                    theme: monacoTheme,
                    readOnly: true,
                    automaticLayout: true,
                    fontSize: 12,
                    lineNumbers: 'on',
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on'
                });
                window.xmlMonacoEditor = monacoEditorInstance;
            } else {
                monacoEditorInstance.setValue(xmlContent || '');
            }
        } else {
            fallback.style.display = 'block';
            fallback.value = xmlContent || '';
        }
    }

    // ─── Event Bindings ─────────────────────────────────────────────────────
    function initWizard() {
        // Dropzone & File Input
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('file-input');

        async function triggerFilePicker() {
            const api = await getPywebviewApi();
            if (api && typeof api.rg_pick_excel_files === 'function') {
                try {
                    const res = await api.rg_pick_excel_files();
                    if (res && res.success && res.files && res.files.length > 0) {
                        await handleNativePathsSelected(res.files);
                        return;
                    } else if (res && res.cancelled) {
                        return;
                    }
                } catch (e) {
                    console.warn('Native file picker error, falling back to input:', e);
                }
            }
            if (fileInput) {
                fileInput.value = '';
                fileInput.click();
            }
        }

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', (e) => {
                if (e.target !== fileInput) triggerFilePicker();
            });
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length) handleFilesSelected(e.target.files);
            });
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files.length) handleFilesSelected(e.dataTransfer.files);
            });
        }

        // Add more files button
        const btnAddMore = document.getElementById('btn-add-more-files');
        if (btnAddMore && fileInput) {
            btnAddMore.addEventListener('click', () => triggerFilePicker());
        }

        // Clear all files button
        const btnClearAll = document.getElementById('btn-clear-all-files');
        if (btnClearAll) {
            btnClearAll.addEventListener('click', () => {
                state.files = [];
                state.sessionId = null;
                state.sheetData = null;
                state.activeFileId = null;
                if (fileInput) fileInput.value = '';
                renderSelectedFilesUI();
                updateSessionChip();
                setStatus('Đã xóa tất cả file.', 'info');
            });
        }

        // Proceed to Step 2 button
        const btnProceed = document.getElementById('btn-proceed-step-2');
        if (btnProceed) {
            btnProceed.addEventListener('click', () => {
                if (!state.files.length) {
                    return setStatus('Vui lòng chọn ít nhất 1 file Excel.', 'warning');
                }
                setStep(2);
            });
        }

        // Step 2 active file dropdown switcher
        const activeFileSel = document.getElementById('active-file-select');
        if (activeFileSel) {
            activeFileSel.addEventListener('change', () => {
                switchActiveFile(activeFileSel.value);
            });
        }

        // Google Sheets button
        const btnGsheet = document.getElementById('btn-load-gsheet');
        if (btnGsheet) {
            btnGsheet.addEventListener('click', async () => {
                const url = document.getElementById('gsheet-url').value.trim();
                if (!url) return setStatus('Vui lòng nhập đường dẫn Google Sheets.', 'warning');
                setStatus('Đang kết nối và tải file từ Google Sheets...', 'info');
                try {
                    const res = await callApi('rg_open_gsheet', url);
                    if (res.success) {
                        state.sessionId = res.session_id;
                        state.sheets = res.sheets;
                        document.getElementById('session-chip').textContent = `Phiên #${state.sessionId}`;
                        setStatus('Tải Google Sheets thành công.', 'success');
                        await loadSheetPreview();
                        setStep(2);
                    } else {
                        setStatus(`Lỗi tải Google Sheet: ${res.error}`, 'error');
                    }
                } catch (err) {
                    setStatus(`Lỗi: ${err.message}`, 'error');
                }
            });
        }

        // Auto detect regions button
        const btnDetect = document.getElementById('btn-auto-detect-regions');
        if (btnDetect) {
            btnDetect.addEventListener('click', async () => {
                const cfgKey = getSheetConfigKey(state.activeFileId, state.currentSheet);
                if (state.sheetConfigs[cfgKey] && state.sheetConfigs[cfgKey].regions) {
                    state.sheetConfigs[cfgKey].regions = { title: null, header: null, summary: null };
                }
                if (state.sheetConfigs[state.currentSheet] && state.sheetConfigs[state.currentSheet].regions) {
                    state.sheetConfigs[state.currentSheet].regions = { title: null, header: null, summary: null };
                }
                ['title', 'header', 'summary'].forEach(k => {
                    const inp = document.getElementById(`input-${k}-range`);
                    if (inp) inp.value = '';
                });
                state.regions = { title: null, header: null, summary: null };
                await loadSheetPreview(state.currentSheet);
                setStatus('Đã tự động nhận diện và gán lại các vùng gợi ý.', 'success');
            });
        }

        // Assign / Locate / Clear region buttons & manual range input listeners
        ['title', 'header', 'summary'].forEach(kind => {
            const inp = document.getElementById(`input-${kind}-range`);
            if (inp) {
                inp.addEventListener('input', () => {
                    const val = inp.value.trim().toUpperCase();
                    state.regions[kind] = val || null;
                    saveCurrentSheetConfig();
                    if (state.sheetGrid) {
                        state.sheetGrid.setRegions(state.regions);
                    }
                });
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        inp.blur();
                        if (state.sheetGrid && state.regions[kind]) {
                            state.sheetGrid.scrollToRange(state.regions[kind]);
                        }
                    }
                });
            }

            const btnSet = document.getElementById(`btn-set-${kind}`);
            if (btnSet) {
                btnSet.addEventListener('click', () => {
                    let rangeStr = state.selectedRangeStr;
                    if (!rangeStr && state.sheetGrid) {
                        rangeStr = state.sheetGrid.getSelectedRangeStr();
                    }
                    if (!rangeStr) {
                        const nameBox = document.getElementById('sg-name-box');
                        if (nameBox && nameBox.value.trim()) {
                            rangeStr = nameBox.value.trim().toUpperCase();
                        }
                    }
                    if (!rangeStr) {
                        const inp = document.getElementById(`input-${kind}-range`);
                        if (inp && inp.value.trim()) {
                            rangeStr = inp.value.trim().toUpperCase();
                        }
                    }
                    if (!rangeStr) {
                        return setStatus('Vui lòng chọn một vùng ô trên bảng tính trước khi gán.', 'warning');
                    }

                    rangeStr = rangeStr.toUpperCase();
                    state.selectedRangeStr = rangeStr;
                    state.regions[kind] = rangeStr;

                    const inpEl = document.getElementById(`input-${kind}-range`);
                    if (inpEl) inpEl.value = rangeStr;

                    saveCurrentSheetConfig();
                    if (state.sheetGrid) {
                        state.sheetGrid.setRegions(state.regions);
                        state.sheetGrid.scrollToRange(rangeStr);
                    }
                    updateRegionUI();
                    setStatus(`Đã gán vùng ${kind.toUpperCase()}: ${rangeStr}`, 'success');
                });
            }

            const btnLocate = document.getElementById(`btn-locate-${kind}`);
            if (btnLocate) {
                btnLocate.addEventListener('click', () => {
                    let rng = state.regions[kind];
                    if (!rng) {
                        const inp = document.getElementById(`input-${kind}-range`);
                        if (inp && inp.value.trim()) {
                            rng = inp.value.trim().toUpperCase();
                            state.regions[kind] = rng;
                            saveCurrentSheetConfig();
                            if (state.sheetGrid) {
                                state.sheetGrid.setRegions(state.regions);
                            }
                        }
                    }
                    if (rng && state.sheetGrid) {
                        state.sheetGrid.scrollToRange(rng);
                        setStatus(`Đang định vị đến vùng ${kind.toUpperCase()}: ${rng}`, 'info');
                    } else {
                        setStatus(`Vùng ${kind.toUpperCase()} chưa được cấu hình.`, 'warning');
                    }
                });
            }

            const btnClear = document.getElementById(`btn-clear-${kind}`);
            if (btnClear) {
                btnClear.addEventListener('click', () => {
                    const inp = document.getElementById(`input-${kind}-range`);
                    if (inp) inp.value = '';
                    state.regions[kind] = null;
                    const cfgKey = getSheetConfigKey(state.activeFileId, state.currentSheet);
                    if (state.sheetConfigs[cfgKey] && state.sheetConfigs[cfgKey].regions) {
                        state.sheetConfigs[cfgKey].regions[kind] = null;
                    }
                    if (state.sheetConfigs[state.currentSheet] && state.sheetConfigs[state.currentSheet].regions) {
                        state.sheetConfigs[state.currentSheet].regions[kind] = null;
                    }
                    saveCurrentSheetConfig();
                    if (state.sheetGrid) {
                        state.sheetGrid.setRegions(state.regions);
                    }
                    updateRegionUI();
                    setStatus(`Đã xoá gán vùng ${kind.toUpperCase()}`, 'info');
                });
            }
        });

        // Connection select change
        const connSel = document.getElementById('conn-select');
        if (connSel) {
            connSel.addEventListener('change', () => {
                state.currentConnectionId = connSel.value;
                loadRoutines(state.currentConnectionId);
            });
        }

        // Routine search debounced
        const routineSearch = document.getElementById('routine-search');
        if (routineSearch) {
            routineSearch.addEventListener('input', () => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    const q = routineSearch.value.trim();
                    loadRoutines(state.currentConnectionId, q);
                }, 300);
            });
        }

        // Routine describe buttons & double click
        const btnDescribe = document.getElementById('btn-describe-routine');
        if (btnDescribe) {
            btnDescribe.addEventListener('click', describeSelectedRoutine);
        }
        const routineSel = document.getElementById('routine-select');
        if (routineSel) {
            routineSel.addEventListener('dblclick', describeSelectedRoutine);
        }

        // Result set select change
        const rsSelect = document.getElementById('result-set-select');
        if (rsSelect) {
            rsSelect.addEventListener('change', () => {
                const idx = rsSelect.selectedIndex;
                if (state.currentShape && state.currentShape.result_sets && state.currentShape.result_sets[idx]) {
                    const rs = state.currentShape.result_sets[idx];
                    state.dataMember = rs.data_member || 'Table' + idx;
                    state.dbColumns = rs.columns || [];
                    renderDbColumnsBadges(state.dbColumns);
                    populateMappingTable();
                }
            });
        }

        // Auto match columns button
        const btnAutoMatch = document.getElementById('btn-auto-match-cols');
        if (btnAutoMatch) {
            btnAutoMatch.addEventListener('click', autoMatchColumns);
        }

        // Copy XML button
        const btnCopy = document.getElementById('btn-copy-xml');
        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                const sheetName = state.activeStep4Sheet || state.currentSheet || 'Sheet1';
                const option = state.activeStep4Option || 'layout';
                let text = '';
                if (option === 'layout') {
                    const sheetCfg = state.sheetConfigs[sheetName];
                    text = (sheetCfg && sheetCfg.layoutXml) ? sheetCfg.layoutXml : state.xmlLayout;
                } else {
                    text = state.xmlDatasource;
                }
                if (!text && monacoEditorInstance) {
                    text = monacoEditorInstance.getValue();
                }
                if (!text) return;
                navigator.clipboard.writeText(text).then(() => {
                    setStatus(`Đã sao chép nội dung ${option === 'layout' ? 'report_layout.xml' : 'report_datasource.xml'} vào Clipboard!`, 'success');
                }).catch(() => {
                    setStatus('Không thể sao chép tự động.', 'warning');
                });
            });
        }

        // Save files button
        const btnSave = document.getElementById('btn-save-files');
        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                if (!state.sessionId) return;
                setStatus('Đang lưu file ra thư mục...', 'info');
                try {
                    const res = await callApi('rg_save_files', state.sessionId);
                    if (res.success) {
                        const fileNames = res.saved_files ? res.saved_files.join(', ') : 'report_layout.xml, report_datasource.xml';
                        setStatus(`Đã lưu file thành công: ${fileNames}`, 'success');
                    } else if (!res.cancelled) {
                        setStatus(`Lỗi lưu file: ${res.error}`, 'error');
                    } else {
                        setStatus('Đã huỷ chọn thư mục.', 'info');
                    }
                } catch (err) {
                    setStatus(`Lỗi lưu file: ${err.message}`, 'error');
                }
            });
        }

        // Download XML button
        const btnDownload = document.getElementById('btn-download-xml');
        if (btnDownload) {
            btnDownload.addEventListener('click', () => {
                const sheetName = state.activeStep4Sheet || state.currentSheet || 'Sheet1';
                const option = state.activeStep4Option || 'layout';
                let text = '';
                if (option === 'layout') {
                    const sheetCfg = state.sheetConfigs[sheetName];
                    text = (sheetCfg && sheetCfg.layoutXml) ? sheetCfg.layoutXml : state.xmlLayout;
                } else {
                    text = state.xmlDatasource;
                }
                if (!text && monacoEditorInstance) {
                    text = monacoEditorInstance.getValue();
                }
                const cleanSheet = sheetName.replace(/[^\w-]/g, '_');
                const filename = option === 'layout' ? `${cleanSheet}_report_layout.xml` : 'report_datasource.xml';
                const blob = new Blob([text], { type: 'application/xml' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
            });
        }

        // Prev & Next navigation
        document.getElementById('btn-prev').addEventListener('click', () => {
            if (state.currentStep > 1) setStep(state.currentStep - 1);
        });

        document.getElementById('btn-next').addEventListener('click', async () => {
            if (state.currentStep === 1) {
                if (!state.sessionId && (!state.files || state.files.length === 0)) {
                    return setStatus('Vui lòng chọn ít nhất một file Excel hoặc nhập link Google Sheets trước khi tiếp tục.', 'warning');
                }
                setStep(2);
            } else if (state.currentStep === 2) {
                saveCurrentSheetConfig();
                const hasAnyRegion = Boolean(state.regions.title || state.regions.header || state.regions.summary);
                if (!hasAnyRegion) {
                    return setStatus('Vui lòng khoanh vùng ít nhất 1 trong 3 vùng: Title (Tiêu đề), Content (Cột nội dung) hoặc Summary (Tổng cộng) trước khi tiếp tục.', 'warning');
                }

                // Gửi cấu hình vùng mới nhất lên backend để tính toán và trích xuất lại cấu trúc
                const regionsPayload = [];
                if (state.regions.title) regionsPayload.push({ kind: 'title', range_str: state.regions.title });
                if (state.regions.header) regionsPayload.push({ kind: 'header', range_str: state.regions.header });
                if (state.regions.summary) regionsPayload.push({ kind: 'summary', range_str: state.regions.summary });

                setStatus('Đang cập nhật lại cấu trúc vùng...', 'info');
                try {
                    const res = await callApi('rg_set_regions', state.sessionId, regionsPayload, state.currentSheet);
                    if (res.success) {
                        const cfgKey = getSheetConfigKey(state.activeFileId, state.currentSheet);
                        if (!state.sheetConfigs[cfgKey]) {
                            state.sheetConfigs[cfgKey] = {
                                fileId: state.activeFileId,
                                sheetName: state.currentSheet,
                                regions: { ...state.regions },
                                columns: [],
                                dataMember: 'Table0',
                                layoutXml: '',
                                datasourceXml: ''
                            };
                        }
                        if (res.detailed_columns && res.detailed_columns.length > 0) {
                            state.sheetConfigs[cfgKey].columns = res.detailed_columns.map((c, idx) => ({
                                name: c.name,
                                col_idx: c.col_idx || (idx + 1),
                                header_text: c.header_text || c.name,
                                width: c.width || '80'
                            }));
                        } else {
                            state.sheetConfigs[cfgKey].columns = (res.columns || []).map((c, idx) => ({
                                name: c,
                                col_idx: idx + 1,
                                header_text: c
                            }));
                        }
                        state.sheetConfigs[cfgKey].title_items = res.title_items || [];
                        state.sheetConfigs[cfgKey].summary_items = res.summary_items || [];
                        state.sheetConfigs[cfgKey].regions = { ...state.regions };

                        // Invalidate kết quả XML đã sinh trước đó để Bước 4 build lại với cấu hình mới
                        state.sheetConfigs[cfgKey].layoutXml = '';
                        state.sheetConfigs[cfgKey].datasourceXml = '';
                        state.xmlLayout = '';
                        state.xmlDatasource = '';

                        state.sheetConfigs[state.currentSheet] = state.sheetConfigs[cfgKey];

                        // Aggregate all columns across configured sheets (deduplicated)
                        state.allColumns = [];
                        const handledSheets = new Set();
                        Object.keys(state.sheetConfigs).forEach(k => {
                            const cfg = state.sheetConfigs[k];
                            if (!cfg || !cfg.sheetName || handledSheets.has(cfg.sheetName)) return;
                            handledSheets.add(cfg.sheetName);

                            const cols = cfg.columns || [];
                            cols.forEach(c => {
                                state.allColumns.push({
                                    sheet: cfg.sheetName,
                                    name: c.name || c,
                                    header_text: c.header_text || c.name || c,
                                    col_idx: c.col_idx || null
                                });
                            });
                        });

                        setStep(3);
                    } else {
                        setStatus(`Lỗi gán vùng: ${res.error}`, 'error');
                    }
                } catch (err) {
                    setStatus(`Lỗi: ${err.message}`, 'error');
                }
            } else if (state.currentStep === 3) {
                // Sang Bước 4: Invalidate và kích hoạt initStep4 để build lại XML với mapping mới nhất
                state.xmlLayout = '';
                state.xmlDatasource = '';
                setStep(4);
            } else if (state.currentStep === 4) {
                setStatus('Hoàn thành xuất layout!', 'success');
            }
        });

        // Clickable stepper pills
        document.querySelectorAll('.rg-step-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const s = parseInt(pill.dataset.step, 10);
                if (s < state.currentStep) {
                    setStep(s);
                }
            });
        });

        // Global click outside to dismiss searchable select dropdowns and routine dropdown
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.rg-searchable-select') && !e.target.closest('.rg-searchable-dropdown')) {
                document.querySelectorAll('.rg-searchable-dropdown').forEach(dd => {
                    if (!dd.classList.contains('d-none')) {
                        dd.classList.add('d-none');
                        const inp = dd._linkedInput || (dd.parentElement ? dd.parentElement.querySelector('.rg-searchable-input') : null);
                        if (inp && inp.dataset.selectedLabel !== undefined) {
                            inp.value = inp.dataset.selectedLabel;
                        }
                    }
                });
            }
            if (!e.target.closest('#routine-combobox-wrap')) {
                const rList = document.getElementById('routine-dropdown-list');
                if (rList) rList.style.display = 'none';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWizard);
    } else {
        initWizard();
    }

})();
