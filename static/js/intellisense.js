// Web IDE IntelliSense Controller
// Integrates CodeMirror with SqlContextAnalyzer, Metadata APIs, and Dual-Panel Popup
// Compliant with intellisense_overview.md and user specifications

(function (window) {
    'use strict';

    let popup, listPanel, listEl, splitterEl, detailsPanel;
    let summaryTabBtn, scriptTabBtn, summaryContent, scriptContent, countBadge;

    let candidates = [];
    let selectedIndex = -1;
    let activeContext = null;
    let debounceTimer = null;
    let isPopupVisible = false;
    let mouseEnteredPopup = false;
    let popupHasBeenDragged = false;
    let isDraggingPopup = false;
    let isConfirmingCompletion = false;

    // Client-side cache: key -> data
    // objectsCache: "connId::database::schema" -> [ { name, type, schema, target_object } ]
    const objectsCache = new Map();
    // columnsCache: "connId::database::schema::table" -> [ { name, data_type, is_nullable, is_pk } ]
    const columnsCache = new Map();
    // parametersCache: "connId::database::schema::name" -> [ { name, data_type, is_output } ]
    const parametersCache = new Map();
    // definitionsCache: "connId::database::schema::name::type" -> string
    const definitionsCache = new Map();
    // dataTypesCache: "connId::database" -> { types: [...], user_types: [...] }
    const dataTypesCache = new Map();

    const ICON_MAP = {
        table: 'fa-table text-primary',
        view: 'fa-table-columns text-info',
        procedure: 'fa-gears text-warning',
        function: 'fa-code text-success',
        trigger: 'fa-bolt text-danger',
        synonym: 'fa-link text-secondary',
        column: 'fa-columns text-info',
        pk_column: 'fa-key text-warning',
        keyword: 'fa-font text-primary',
        sql_function: 'fa-calculator text-success',
        temp_table: 'fa-clock text-warning',
        table_variable: 'fa-cube text-info',
        data_type: 'fa-cube text-info',
        user_data_type: 'fa-shapes text-warning'
    };

    function init() {
        popup = document.getElementById('ide-intellisense-popup');
        if (!popup) return;

        listPanel = document.getElementById('ide-intellisense-list-panel');
        listEl = document.getElementById('ide-intellisense-list');
        splitterEl = document.getElementById('ide-intellisense-splitter');
        detailsPanel = document.getElementById('ide-intellisense-details-panel');

        summaryTabBtn = document.getElementById('ide-is-tab-summary-btn');
        scriptTabBtn = document.getElementById('ide-is-tab-script-btn');
        summaryContent = document.getElementById('ide-is-summary-content');
        scriptContent = document.getElementById('ide-is-script-content');
        countBadge = document.getElementById('ide-intellisense-count');

        initSplitter();
        initPopupDrag();
        initMouseEvents();
        initGlobalListeners();
    }

    function initSplitter() {
        if (!splitterEl) return;
        let isDragging = false;
        let startX = 0;
        let startWidth = 0;

        splitterEl.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startWidth = listPanel.getBoundingClientRect().width;
            splitterEl.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const delta = e.clientX - startX;
            let newWidth = startWidth + delta;
            if (newWidth < 220) newWidth = 220;
            if (newWidth > 600) newWidth = 600;
            listPanel.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            splitterEl.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    function initPopupDrag() {
        if (!popup) return;
        const header = popup.querySelector('.ide-intellisense-header');
        if (!header) return;

        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('#ide-intellisense-count')) return;
            isDraggingPopup = true;
            popupHasBeenDragged = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = popup.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            header.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDraggingPopup) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            popup.style.left = (startLeft + deltaX) + 'px';
            popup.style.top = (startTop + deltaY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDraggingPopup) return;
            isDraggingPopup = false;
            if (header) header.style.cursor = 'move';
            document.body.style.userSelect = '';
        });
    }

    function initMouseEvents() {
        if (!popup) return;

        popup.addEventListener('mouseenter', () => {
            mouseEnteredPopup = true;
        });

        // Global mousemove: if mouse previously entered popup and now moved away > 35px, hide popup
        document.addEventListener('mousemove', (e) => {
            if (!isPopupVisible || !mouseEnteredPopup || isDraggingPopup) return;
            const rect = popup.getBoundingClientRect();
            const threshold = 35;
            const isInsideWithMargin = (
                e.clientX >= rect.left - threshold &&
                e.clientX <= rect.right + threshold &&
                e.clientY >= rect.top - threshold &&
                e.clientY <= rect.bottom + threshold
            );
            if (!isInsideWithMargin) {
                hidePopup();
            }
        });

        // Global click: if clicked outside of popup, hide popup
        document.addEventListener('mousedown', (e) => {
            if (!isPopupVisible) return;
            if (!popup.contains(e.target)) {
                hidePopup();
            }
        });
    }

    function initGlobalListeners() {
        // Listen to tab switch or context change to invalidate or pre-fetch
        document.addEventListener('ide-tab-switched', () => {
            hidePopup();
        });
        document.addEventListener('ide-context-changed', () => {
            hidePopup();
        });

        // Global shortcut F12 -> Go to Definition
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F12') {
                e.preventDefault();
                goToDefinition();
            }
        });
    }

    function attachEditor(cm) {
        if (!cm) return;

        cm.on('change', (editor, changeObj) => {
            if (changeObj.origin === 'setValue') return;
            if (isConfirmingCompletion) {
                isConfirmingCompletion = false;
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                }
                return;
            }
            // Debounce 120ms
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                triggerIntelliSense(editor, false);
            }, 120);
        });

        cm.on('cursorActivity', (editor) => {
            // When moving cursor away from the current token, hide popup
            if (isPopupVisible && activeContext) {
                const curPos = editor.indexFromPos(editor.getCursor());
                if (Math.abs(curPos - activeContext.cursorIndex) > 10) {
                    hidePopup();
                }
            }
        });

        cm.on('keydown', (editor, e) => {
            if (handleEditorKeyDown(editor, e)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    function handleEditorKeyDown(cm, e) {
        if (!isPopupVisible) {
            // Ctrl+Space triggers IntelliSense manually
            if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
                triggerIntelliSense(cm, true);
                return true;
            }
            return false;
        }

        switch (e.key) {
            case 'ArrowDown':
                moveSelection(1);
                return true;
            case 'ArrowUp':
                moveSelection(-1);
                return true;
            case 'PageDown':
                moveSelection(8);
                return true;
            case 'PageUp':
                moveSelection(-8);
                return true;
            case 'Enter':
            case 'Tab':
                chooseCurrentItem(cm);
                return true;
            case 'Escape':
                hidePopup();
                return true;
        }
        return false;
    }

    function getActiveTabContext() {
        if (window.AppTabs && window.AppTabs.getActiveTabState) {
            const state = window.AppTabs.getActiveTabState();
            if (state) {
                return {
                    connectionId: state.connectionId,
                    database: state.database,
                    schema: state.schema,
                    dbType: state.dbType || 'sqlserver'
                };
            }
        }
        return {
            connectionId: window.ActiveConnectionId,
            database: window.ActiveDatabase,
            schema: window.ActiveSchema,
            dbType: window.ActiveDbType || 'sqlserver'
        };
    }

    async function triggerIntelliSense(cm, isManual = false) {
        if (!cm || !window.SqlContextAnalyzer) return;

        const cursor = cm.getCursor();
        const cursorIndex = cm.indexFromPos(cursor);
        const fullSql = cm.getValue();

        const context = window.SqlContextAnalyzer.analyze(fullSql, cursorIndex);
        activeContext = context;

        // Determine if we should trigger:
        // 1. Manual trigger (Ctrl+Space)
        // 2. Typing characters in a word
        // 3. Dot trigger (.)
        // 4. Follow-up trigger on space (hasFollowUp = true)
        // 5. Clause trigger (FROM, JOIN)
        const isTriggerWord = context.currentWord.length > 0;
        const isDot = context.triggerChar === '.';
        const isFollowUp = context.hasFollowUp;
        const isFromClause = (context.clause === 'FROM' || context.clause === 'JOIN');

        if (!isManual && !isTriggerWord && !isDot && !isFollowUp && !isFromClause) {
            hidePopup();
            return;
        }

        const tabCtx = getActiveTabContext();
        await collectAndShowCandidates(cm, context, tabCtx);
    }

    async function collectAndShowCandidates(cm, context, tabCtx) {
        const wordLower = context.currentWord.toLowerCase();
        const allCandidates = [];

        // 1. Level 1: SQL Keywords
        if (context.hasFollowUp && context.followUpKeywords.length > 0) {
            // Prioritize follow-up keywords
            context.followUpKeywords.forEach(kw => {
                if (!wordLower || kw.toLowerCase().startsWith(wordLower)) {
                    allCandidates.push({
                        name: kw,
                        type: 'keyword',
                        level: 1,
                        displayType: 'Keyword'
                    });
                }
            });
        } else if (!context.qualifier) {
            // Standard keywords (Level 1)
            window.SqlContextAnalyzer.SQL_KEYWORDS.forEach(kw => {
                if (!wordLower || kw.toLowerCase().startsWith(wordLower)) {
                    allCandidates.push({
                        name: kw,
                        type: 'keyword',
                        level: 1,
                        displayType: 'Keyword'
                    });
                }
            });

            // SQL built-in functions
            window.SqlContextAnalyzer.SQL_FUNCTIONS.forEach(fn => {
                if (!wordLower || fn.toLowerCase().startsWith(wordLower)) {
                    allCandidates.push({
                        name: fn,
                        type: 'sql_function',
                        level: 1,
                        displayType: 'Function'
                    });
                }
            });
        }

        // 2. Level 2: Local Script Objects (strictly in file scope)
        if (!context.qualifier) {
            // Temp tables (#temp)
            (context.localTempTables || []).forEach(tbl => {
                if (!wordLower || tbl.toLowerCase().startsWith(wordLower)) {
                    allCandidates.push({
                        name: tbl,
                        type: 'temp_table',
                        level: 2,
                        displayType: 'Temp Table'
                    });
                }
            });

            // Table variables (@var)
            (context.localTableVars || []).forEach(v => {
                if (!wordLower || v.toLowerCase().startsWith(wordLower)) {
                    allCandidates.push({
                        name: v,
                        type: 'table_variable',
                        level: 2,
                        displayType: 'Table Var'
                    });
                }
            });

            // 2b. If tables are present in query, suggest their columns (especially in SELECT clause)
            if (tabCtx.connectionId && context.queryTables && context.queryTables.length > 0) {
                const isExprClause = (context.clause === 'SELECT' || !context.clause || ['WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING'].includes(context.clause));
                if (isExprClause) {
                    for (const tbl of context.queryTables) {
                        const targetSchema = tbl.schema || tabCtx.schema;
                        const cols = await fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tbl.table);
                        cols.forEach(c => {
                            if (!wordLower || c.name.toLowerCase().startsWith(wordLower)) {
                                allCandidates.push({
                                    name: c.name,
                                    type: c.is_pk ? 'pk_column' : 'column',
                                    level: 1.1, // Priority: right next to keywords, top in SELECT
                                    displayType: 'Column',
                                    dataType: c.data_type,
                                    isNullable: c.is_nullable,
                                    isPk: c.is_pk,
                                    schema: targetSchema,
                                    tableName: tbl.table,
                                    tableAlias: tbl.alias
                                });
                            }
                        });
                    }
                }
            }

            // 2c. Suggest SQL Data Types (System types and User-defined types UDT)
            const dtData = await fetchDataTypes(tabCtx.connectionId, tabCtx.database);
            if (dtData.types && dtData.types.length > 0) {
                dtData.types.forEach(dt => {
                    const dtName = dt.toUpperCase();
                    if (!wordLower || dtName.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: dtName,
                            type: 'data_type',
                            level: 1.8,
                            displayType: 'Data Type'
                        });
                    }
                });
            }
            if (dtData.user_types && dtData.user_types.length > 0) {
                dtData.user_types.forEach(udt => {
                    if (!wordLower || udt.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: udt,
                            type: 'user_data_type',
                            level: 1.9,
                            displayType: 'UDT'
                        });
                    }
                });
            }
        }

        // 3. Level 2: Database Objects & Columns
        if (tabCtx.connectionId) {
            // Case A: Dot-qualified (e.g. c.id or dbo.Customer)
            if (context.qualifier) {
                const qualLower = context.qualifier.toLowerCase();

                // Check if qualifier is an alias
                let targetTable = null;
                let targetSchema = tabCtx.schema;

                if (context.aliasMap && context.aliasMap[qualLower]) {
                    const mapped = context.aliasMap[qualLower];
                    targetTable = mapped.table;
                    if (mapped.schema) targetSchema = mapped.schema;
                } else {
                    targetTable = context.qualifier;
                }

                // If qualifier resolves to a table, fetch its columns
                if (targetTable) {
                    const cols = await fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, targetTable);
                    cols.forEach(c => {
                        if (!wordLower || c.name.toLowerCase().startsWith(wordLower)) {
                            allCandidates.push({
                                name: c.name,
                                type: c.is_pk ? 'pk_column' : 'column',
                                level: 2,
                                displayType: 'Column',
                                dataType: c.data_type,
                                isNullable: c.is_nullable,
                                isPk: c.is_pk,
                                schema: targetSchema,
                                tableName: targetTable
                            });
                        }
                    });
                }

                // Also check if qualifier is a schema (e.g. dbo.)
                const dbObjects = await fetchObjects(tabCtx.connectionId, tabCtx.database, context.qualifier);
                dbObjects.forEach(obj => {
                    if (!wordLower || obj.name.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: obj.name,
                            type: obj.type,
                            level: 2,
                            displayType: formatDisplayType(obj.type),
                            schema: obj.schema,
                            targetObject: obj.target_object
                        });
                    }
                });
            } else {
                // General context: Fetch database objects
                const dbObjects = await fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
                dbObjects.forEach(obj => {
                    if (!wordLower || obj.name.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: obj.name,
                            type: obj.type,
                            level: 2,
                            displayType: formatDisplayType(obj.type),
                            schema: obj.schema,
                            targetObject: obj.target_object
                        });
                    }
                });
            }
        }

        // Deduplicate and Rank
        const ranked = rankAndFilterCandidates(allCandidates, wordLower, context);
        if (ranked.length === 0) {
            hidePopup();
            return;
        }

        candidates = ranked;
        renderPopup(cm, context);
    }

    function rankAndFilterCandidates(list, wordLower, context) {
        const seen = new Set();
        const unique = [];

        list.forEach(item => {
            const key = `${item.name.toLowerCase()}::${item.type}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(item);
            }
        });

        // Sorting rule:
        // Level 1 (Keywords) strictly first when matching, then Level 2 (Objects).
        // If in FROM / JOIN clause, prefer tables, views, temp tables, table vars.
        const isFromClause = (context.clause === 'FROM' || context.clause === 'JOIN');

        unique.sort((a, b) => {
            if (isFromClause && !context.qualifier) {
                const aIsSource = ['table', 'view', 'temp_table', 'table_variable', 'synonym'].includes(a.type);
                const bIsSource = ['table', 'view', 'temp_table', 'table_variable', 'synonym'].includes(b.type);
                if (aIsSource && !bIsSource) return -1;
                if (!aIsSource && bIsSource) return 1;
            }

            // If in SELECT clause without qualifier, prioritize query table columns!
            if (context.clause === 'SELECT' && !context.qualifier) {
                const aIsCol = (a.type === 'column' || a.type === 'pk_column');
                const bIsCol = (b.type === 'column' || b.type === 'pk_column');
                if (aIsCol && !bIsCol) return -1;
                if (!aIsCol && bIsCol) return 1;
            }

            // Level comparison
            if (a.level !== b.level) {
                return a.level - b.level;
            }

            // Exact match on top
            if (wordLower) {
                const aExact = a.name.toLowerCase() === wordLower;
                const bExact = b.name.toLowerCase() === wordLower;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
            }

            return a.name.localeCompare(b.name);
        });

        return unique.slice(0, 150); // limit render list for smooth performance
    }

    function formatDisplayType(type) {
        const map = {
            table: 'Table',
            view: 'View',
            procedure: 'Procedure',
            function: 'Function',
            trigger: 'Trigger',
            synonym: 'Synonym',
            sequence: 'Sequence',
            column: 'Column',
            keyword: 'Keyword',
            sql_function: 'Function',
            temp_table: 'Temp Table',
            table_variable: 'Table Var',
            data_type: 'Data Type',
            user_data_type: 'UDT'
        };
        return map[type] || (type.charAt(0).toUpperCase() + type.slice(1));
    }

    async function fetchObjects(connectionId, database, schema) {
        if (!connectionId) return [];
        const cacheKey = `${connectionId}::${database || ''}::${schema || ''}`;
        if (objectsCache.has(cacheKey)) {
            return objectsCache.get(cacheKey);
        }

        try {
            const url = `/api/metadata/${connectionId}/intellisense/objects?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && Array.isArray(data.items)) {
                objectsCache.set(cacheKey, data.items);
                return data.items;
            }
        } catch (e) {
            console.warn('[IntelliSense] fetchObjects error:', e);
        }
        return [];
    }

    async function fetchColumns(connectionId, database, schema, table) {
        if (!connectionId || !table) return [];
        const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${table}`;
        if (columnsCache.has(cacheKey)) {
            return columnsCache.get(cacheKey);
        }

        try {
            const url = `/api/metadata/${connectionId}/intellisense/columns?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&table=${encodeURIComponent(table)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && Array.isArray(data.items)) {
                columnsCache.set(cacheKey, data.items);
                return data.items;
            }
        } catch (e) {
            console.warn('[IntelliSense] fetchColumns error:', e);
        }
        return [];
    }

    async function fetchParameters(connectionId, database, schema, name) {
        if (!connectionId || !name) return [];
        const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${name}`;
        if (parametersCache.has(cacheKey)) {
            return parametersCache.get(cacheKey);
        }

        try {
            const url = `/api/metadata/${connectionId}/intellisense/parameters?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && Array.isArray(data.items)) {
                parametersCache.set(cacheKey, data.items);
                return data.items;
            }
        } catch (e) {
            console.warn('[IntelliSense] fetchParameters error:', e);
        }
        return [];
    }

    async function fetchDefinition(connectionId, database, schema, name, type) {
        if (!connectionId || !name) return null;
        const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${name}::${type || ''}`;
        if (definitionsCache.has(cacheKey)) {
            return definitionsCache.get(cacheKey);
        }

        try {
            const url = `/api/metadata/${connectionId}/definition?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name)}&type=${encodeURIComponent(type || '')}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && data.definition) {
                definitionsCache.set(cacheKey, data.definition);
                return data.definition;
            }
        } catch (e) {
            console.warn('[IntelliSense] fetchDefinition error:', e);
        }
        return null;
    }

    async function fetchDataTypes(connectionId, database) {
        const defaultTypes = (window.SqlContextAnalyzer && window.SqlContextAnalyzer.SQL_DATA_TYPES) ? window.SqlContextAnalyzer.SQL_DATA_TYPES : [
            "BIGINT", "BINARY", "BIT", "BOOLEAN", "BYTEA", "CHAR", "DATE", "DATETIME",
            "DATETIME2", "DATETIMEOFFSET", "DECIMAL", "DOUBLE PRECISION", "FLOAT", "IMAGE",
            "INT", "INTEGER", "JSON", "JSONB", "MONEY", "NCHAR", "NTEXT", "NUMERIC",
            "NVARCHAR", "REAL", "SERIAL", "BIGSERIAL", "SMALLDATETIME", "SMALLINT",
            "SMALLMONEY", "SMALLSERIAL", "TEXT", "TIME", "TIMESTAMP", "TIMESTAMPTZ",
            "TINYINT", "UNIQUEIDENTIFIER", "UUID", "VARBINARY", "VARCHAR", "XML"
        ];

        if (!connectionId) return { types: defaultTypes, user_types: [] };

        const cacheKey = `${connectionId}::${database || ''}`;
        if (dataTypesCache.has(cacheKey)) {
            return dataTypesCache.get(cacheKey);
        }

        try {
            const url = `/api/metadata/${connectionId}/intellisense/types?database=${encodeURIComponent(database || '')}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.success) {
                const resObj = {
                    types: (data.types && data.types.length > 0) ? data.types : defaultTypes,
                    user_types: data.user_types || []
                };
                dataTypesCache.set(cacheKey, resObj);
                return resObj;
            }
        } catch (e) {
            console.warn('[IntelliSense] fetchDataTypes error:', e);
        }

        return { types: defaultTypes, user_types: [] };
    }

    function renderPopup(cm, context) {
        if (!popup || candidates.length === 0) {
            hidePopup();
            return;
        }

        if (popupHasBeenDragged && isPopupVisible) {
            // User manually dragged popup; keep user-chosen position
        } else {
            // Position popup right next to cursor and slightly below (coords.bottom + 4)
            const cursor = cm.getCursor();
            const coords = cm.cursorCoords(cursor, 'window');

            let top = coords.bottom + 4;
            let left = coords.left;

            // Ensure popup doesn't overflow bottom
            const popupHeight = 280;
            const popupWidth = 744;
            if (top + popupHeight > window.innerHeight - 10 && coords.top - popupHeight > 10) {
                top = coords.top - popupHeight - 4;
            }

            // Ensure popup doesn't overflow right
            if (left + popupWidth > window.innerWidth - 10) {
                left = window.innerWidth - popupWidth - 10;
            }
            if (left < 10) left = 10;

            popup.style.top = top + 'px';
            popup.style.left = left + 'px';
        }

        popup.classList.remove('d-none');
        isPopupVisible = true;
        mouseEnteredPopup = false;

        // Render List
        listEl.innerHTML = '';
        candidates.forEach((cand, idx) => {
            const row = document.createElement('div');
            row.className = `ide-intellisense-item ${cand.type === 'keyword' ? 'is-keyword' : ''}`;
            row.dataset.index = idx;

            const iconClass = ICON_MAP[cand.type] || (cand.isPk ? ICON_MAP.pk_column : 'fa-circle-dot text-secondary');
            row.innerHTML = `
                <i class="fa-solid ${iconClass} item-icon"></i>
                <span class="item-name">${cand.name}</span>
                <span class="badge-type">[${cand.displayType}]</span>
            `;

            row.addEventListener('mouseenter', () => {
                selectIndex(idx, false);
            });

            row.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                selectIndex(idx, false);
                chooseCurrentItem(cm);
            });

            listEl.appendChild(row);
        });

        if (countBadge) {
            countBadge.textContent = candidates.length;
        }

        selectIndex(0, true);
    }

    function selectIndex(index, shouldScroll = false) {
        if (index < 0 || index >= candidates.length) return;
        selectedIndex = index;

        const items = listEl.querySelectorAll('.ide-intellisense-item');
        items.forEach((item, idx) => {
            if (idx === index) {
                item.classList.add('active');
                if (shouldScroll) {
                    item.scrollIntoView({ block: 'nearest' });
                }
            } else {
                item.classList.remove('active');
            }
        });

        // Update detail panel preview
        updateDetailPreview(candidates[index]);
    }

    function moveSelection(delta) {
        if (candidates.length === 0) return;
        let newIndex = selectedIndex + delta;
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= candidates.length) newIndex = candidates.length - 1;
        selectIndex(newIndex, true);
    }

    async function updateDetailPreview(item) {
        if (!item || !summaryContent || !scriptContent) return;

        const tabCtx = getActiveTabContext();

        // 1. Render Summary View
        if (item.type === 'table' || item.type === 'view') {
            summaryContent.innerHTML = `<div class="p-2 text-center text-muted small"><i class="fa-solid fa-spinner fa-spin me-1"></i>Loading columns...</div>`;
            const cols = await fetchColumns(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name);
            if (cols.length > 0) {
                let html = `
                    <div class="mb-1 fw-bold text-truncate" style="font-size: 11px;">
                        <i class="fa-solid ${ICON_MAP[item.type]} me-1"></i>${item.schema ? item.schema + '.' : ''}${item.name}
                    </div>
                    <table class="ide-is-summary-table">
                        <thead>
                            <tr><th>Name</th><th>Data Type</th><th>Null</th><th>PK</th></tr>
                        </thead>
                        <tbody>
                `;
                cols.forEach(c => {
                    html += `
                        <tr>
                            <td class="font-monospace">${c.name}</td>
                            <td class="text-info">${c.data_type || ''}</td>
                            <td class="text-muted">${c.is_nullable ? 'YES' : 'NO'}</td>
                            <td>${c.is_pk ? '<i class="fa-solid fa-key text-warning"></i>' : ''}</td>
                        </tr>
                    `;
                });
                html += '</tbody></table>';
                summaryContent.innerHTML = html;
            } else {
                summaryContent.innerHTML = `<div class="p-2 small text-muted">No column information available.</div>`;
            }
        } else if (item.type === 'procedure' || item.type === 'function') {
            summaryContent.innerHTML = `<div class="p-2 text-center text-muted small"><i class="fa-solid fa-spinner fa-spin me-1"></i>Loading parameters...</div>`;
            const params = await fetchParameters(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name);
            if (params.length > 0) {
                let html = `
                    <div class="mb-1 fw-bold text-truncate" style="font-size: 11px;">
                        <i class="fa-solid ${ICON_MAP[item.type]} me-1"></i>${item.schema ? item.schema + '.' : ''}${item.name}
                    </div>
                    <table class="ide-is-summary-table">
                        <thead>
                            <tr><th>Parameter</th><th>Type</th><th>Output</th></tr>
                        </thead>
                        <tbody>
                `;
                params.forEach(p => {
                    html += `
                        <tr>
                            <td class="font-monospace">${p.name}</td>
                            <td class="text-info">${p.data_type || ''}</td>
                            <td class="text-muted">${p.is_output ? 'OUT' : 'IN'}</td>
                        </tr>
                    `;
                });
                html += '</tbody></table>';
                summaryContent.innerHTML = html;
            } else {
                summaryContent.innerHTML = `<div class="p-2 small text-muted">Routine has no parameters.</div>`;
            }
        } else if (item.type === 'column' || item.type === 'pk_column') {
            summaryContent.innerHTML = `
                <div class="p-2">
                    <div class="fw-bold font-monospace mb-1"><i class="fa-solid fa-columns text-info me-1"></i>${item.name}</div>
                    ${item.tableName ? `<div class="small text-muted mb-1">Table: <span class="font-monospace text-primary">${item.schema ? item.schema + '.' : ''}${item.tableName}${item.tableAlias ? ' (' + item.tableAlias + ')' : ''}</span></div>` : ''}
                    <div class="small text-muted">Data Type: <span class="text-info fw-semibold">${item.dataType || 'Unknown'}</span></div>
                    <div class="small text-muted">Nullable: <span class="fw-semibold">${item.isNullable ? 'YES' : 'NO'}</span></div>
                    <div class="small text-muted">Primary Key: <span class="fw-semibold">${item.isPk ? 'YES' : 'NO'}</span></div>
                </div>
            `;
            scriptContent.textContent = `-- Column: ${item.name} ${item.dataType || ''}\n-- Table: ${item.tableName || 'N/A'}`;
        } else if (item.type === 'data_type' || item.type === 'user_data_type') {
            summaryContent.innerHTML = `
                <div class="p-2">
                    <div class="fw-bold font-monospace mb-1"><i class="fa-solid ${ICON_MAP[item.type] || 'fa-cube'} me-1"></i>${item.name}</div>
                    <div class="small text-muted">Category: <span class="fw-semibold text-info">${item.displayType}</span></div>
                    <div class="small text-muted mt-1">SQL data type for columns, variables, and parameters.</div>
                </div>
            `;
            scriptContent.textContent = `-- Data Type: ${item.name}\n-- Category: ${item.displayType}`;
        } else {
            summaryContent.innerHTML = `
                <div class="p-2">
                    <div class="fw-bold mb-1"><i class="fa-solid ${ICON_MAP[item.type] || 'fa-info-circle'} me-1"></i>${item.name}</div>
                    <div class="small text-muted">Type: <span class="fw-semibold">${item.displayType}</span></div>
                    ${item.targetObject ? `<div class="small text-muted mt-1">Target: <span class="font-monospace text-secondary">${item.targetObject}</span></div>` : ''}
                </div>
            `;
        }

        // 2. Render Script Definition View
        scriptContent.textContent = '-- Loading definition...';
        if (['table', 'view', 'procedure', 'function', 'trigger'].includes(item.type)) {
            const def = await fetchDefinition(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name, item.type);
            scriptContent.textContent = def || '-- Definition script not available.';
        } else if (item.type !== 'column' && item.type !== 'pk_column' && item.type !== 'data_type' && item.type !== 'user_data_type') {
            scriptContent.textContent = `-- Definition not available for [${item.displayType}]`;
        }
    }

    async function chooseCurrentItem(cm) {
        if (selectedIndex < 0 || selectedIndex >= candidates.length) {
            hidePopup();
            return;
        }

        const item = candidates[selectedIndex];
        isConfirmingCompletion = true;
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        hidePopup();

        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);

        // Find range to replace: back to the start of currentWord
        const wordLen = activeContext ? (activeContext.currentWord || '').length : 0;
        const fromPos = { line: cursor.line, ch: cursor.ch - wordLen };
        const toPos = cursor;

        // Check if user is writing ALTER / CREATE OR ALTER context
        if (activeContext && activeContext.isAlterContext && ['procedure', 'function', 'trigger', 'view'].includes(item.type)) {
            const tabCtx = getActiveTabContext();
            const defScript = await fetchDefinition(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name, item.type);

            if (defScript) {
                // Find start of statement: e.g. "ALTER PROCEDURE ..."
                // Replace entire line/statement with defScript
                cm.replaceRange(defScript, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });

                // Position cursor immediately after object name in the header!
                setTimeout(() => {
                    const newText = cm.getValue();
                    const regex = new RegExp(
                        `\\b(?:ALTER|CREATE\\s+OR\\s+ALTER|CREATE\\s+OR\\s+REPLACE)\\s+(?:PROCEDURE|FUNCTION|TRIGGER|VIEW)\\s+(?:\\[?\\w+\\]?\\.)?\\[?(${item.name})\\]?`,
                        'i'
                    );
                    const match = regex.exec(newText);
                    if (match) {
                        const targetIdx = match.index + match[0].length;
                        const targetPos = cm.posFromIndex(targetIdx);
                        cm.setCursor(targetPos);
                        cm.scrollIntoView(targetPos, 50);
                    }
                    cm.focus();
                }, 30);
                return;
            }
        }

        // Standard completion replacement
        let textToInsert = item.name;
        const hasFollowUp = (item.type === 'keyword' && window.SqlContextAnalyzer.FOLLOW_UP_KEYWORDS[item.name]);
        if (hasFollowUp) {
            textToInsert += ' ';
        }

        cm.replaceRange(textToInsert, fromPos, toPos);
        cm.focus();
        // Do NOT re-trigger suggestions automatically after completion.
        // Wait until user resumes typing next characters.
    }

    async function goToDefinition() {
        const cm = window.AppEditor;
        if (!cm) return;

        const cursor = cm.getCursor();
        const wordRange = cm.findWordAt(cursor);
        const word = cm.getRange(wordRange.anchor, wordRange.head).trim();
        if (!word) return;

        const tabCtx = getActiveTabContext();
        if (!tabCtx.connectionId) return;

        // Search object in db objects
        const objects = await fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
        const match = objects.find(o => o.name.toLowerCase() === word.toLowerCase());

        if (match) {
            const defScript = await fetchDefinition(tabCtx.connectionId, tabCtx.database, match.schema || tabCtx.schema, match.name, match.type);
            if (defScript) {
                if (window.AppTabs && window.AppTabs.createTab) {
                    window.AppTabs.createTab({
                        title: `${match.name}.sql`,
                        content: defScript,
                        database: tabCtx.database,
                        schema: match.schema || tabCtx.schema,
                        connectionId: tabCtx.connectionId,
                        connectionName: window.ActiveConnectionName
                    });
                }
                return;
            }
        }

        if (typeof showToast === 'function') {
            showToast(`Could not resolve definition for '${word}'.`, 'warning');
        }
    }

    function hidePopup() {
        if (!popup) return;
        popup.classList.add('d-none');
        isPopupVisible = false;
        mouseEnteredPopup = false;
        popupHasBeenDragged = false;
        isDraggingPopup = false;
        selectedIndex = -1;
        candidates = [];
    }

    // Expose API
    window.AppIntelliSense = {
        init,
        attachEditor,
        triggerIntelliSense,
        hidePopup,
        goToDefinition
    };

    document.addEventListener('DOMContentLoaded', () => {
        init();
    });

})(window);
