/**
 * syntax-reference-window.js
 * Standalone Desktop Subwindow Controller for Cross-Database Syntax Reference & Compare.
 * Strictly Zero Inline CSS Compliant.
 * Features read-only Monaco Editor instances for all SQL code blocks,
 * full comprehensive display of all catalog fields, and modern IDE UI polish.
 */

(function () {
    'use strict';

    // ── Application State ───────────────────────────────────────────────────
    let currentTab = 'reference';
    let currentScopeFilter = 'all';
    let currentCategoryFilter = 'all';
    let currentSearchTerm = '';
    let searchDebounceTimer = null;
    let selectedSyntaxId = null;
    let catalogEntries = [];
    let isMonacoReady = false;

    // ── Monaco Editor Instances ─────────────────────────────────────────────
    let sourceMonacoEditor = null;
    let targetMonacoEditor = null;
    let detailMonacoInstances = [];
    let compareMonacoInstances = [];

    function getActiveMonacoTheme() {
        const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
            return window.MonacoInit.getMonacoTheme(curTheme);
        }
        return (curTheme === 'light' || curTheme.includes('light')) ? 'ide-light' : 'ide-dark';
    }

    function disposeDetailMonacoInstances() {
        if (detailMonacoInstances && detailMonacoInstances.length > 0) {
            detailMonacoInstances.forEach((inst) => {
                try {
                    inst.dispose();
                } catch (e) {
                    console.warn('[SyntaxWindow] Error disposing detail Monaco editor:', e);
                }
            });
            detailMonacoInstances = [];
        }
    }

    function disposeCompareMonacoInstances() {
        if (compareMonacoInstances && compareMonacoInstances.length > 0) {
            compareMonacoInstances.forEach((inst) => {
                try {
                    inst.dispose();
                } catch (e) {
                    console.warn('[SyntaxWindow] Error disposing compare Monaco editor:', e);
                }
            });
            compareMonacoInstances = [];
        }
    }

    function createMonacoCodeViewer(containerEl, codeText, lang = 'sql') {
        if (!containerEl) return null;
        const code = (codeText || '').trim();
        const lines = code ? code.split('\n').length : 1;
        // Dynamic height calculation: clamp between 38px and 320px
        const dynamicHeight = Math.min(320, Math.max(38, lines * 19 + 14));
        containerEl.style.height = `${dynamicHeight}px`;

        if (!window.monaco || !window.monaco.editor) {
            // Graceful fallback if Monaco is not yet loaded
            const pre = document.createElement('pre');
            pre.className = 'syntax-cmp-code';
            pre.textContent = code;
            containerEl.innerHTML = '';
            containerEl.appendChild(pre);
            return null;
        }

        try {
            const editor = window.monaco.editor.create(containerEl, {
                value: code,
                language: lang,
                theme: getActiveMonacoTheme(),
                readOnly: true,
                domReadOnly: true,
                fontSize: 12,
                lineHeight: 19,
                fontFamily: "var(--ide-font-mono, 'JetBrains Mono', Consolas, monospace)",
                minimap: { enabled: false },
                lineNumbers: lines > 2 ? 'on' : 'off',
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: false,
                contextmenu: false,
                automaticLayout: true,
                wordWrap: 'on',
                renderLineHighlight: 'none',
                scrollBeyondLastLine: false,
                scrollbar: {
                    vertical: lines > 14 ? 'auto' : 'hidden',
                    horizontal: 'auto',
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6
                },
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true
            });
            return editor;
        } catch (err) {
            console.warn('[SyntaxWindow] Failed to mount Monaco viewer:', err);
            const pre = document.createElement('pre');
            pre.className = 'syntax-cmp-code';
            pre.textContent = code;
            containerEl.innerHTML = '';
            containerEl.appendChild(pre);
            return null;
        }
    }

    function mountDetailMonacoViewers() {
        disposeDetailMonacoInstances();
        const detailEl = document.getElementById('win-syntax-detail');
        if (!detailEl) return;
        const targets = detailEl.querySelectorAll('.syntax-monaco-viewer');
        targets.forEach((el) => {
            const code = el.getAttribute('data-code') || '';
            const lang = el.getAttribute('data-lang') || 'sql';
            const ed = createMonacoCodeViewer(el, code, lang);
            if (ed) detailMonacoInstances.push(ed);
        });
    }

    function mountCompareMonacoViewers() {
        disposeCompareMonacoInstances();
        const resultPanel = document.getElementById('cmp-result-panel');
        if (!resultPanel) return;
        const targets = resultPanel.querySelectorAll('.syntax-monaco-viewer');
        targets.forEach((el) => {
            const code = el.getAttribute('data-code') || '';
            const lang = el.getAttribute('data-lang') || 'sql';
            const ed = createMonacoCodeViewer(el, code, lang);
            if (ed) compareMonacoInstances.push(ed);
        });
    }

    function getSourceSql() {
        if (sourceMonacoEditor) return sourceMonacoEditor.getValue();
        const ta = document.getElementById('cmp-source-editor');
        return ta ? ta.value : '';
    }

    function setSourceSql(val) {
        if (sourceMonacoEditor) {
            sourceMonacoEditor.setValue(val || '');
        }
        const ta = document.getElementById('cmp-source-editor');
        if (ta) ta.value = val || '';
    }

    function getTargetSql() {
        if (targetMonacoEditor) return targetMonacoEditor.getValue();
        const ta = document.getElementById('cmp-target-editor');
        return ta ? ta.value : '';
    }

    function setTargetSql(val) {
        if (targetMonacoEditor) {
            targetMonacoEditor.setValue(val || '');
        }
        const ta = document.getElementById('cmp-target-editor');
        if (ta) ta.value = val || '';
    }

    // ── Predefined Presets for Quick Testing & Demonstration ─────────────────
    const PRESETS = {
        limit_offset: {
            pg: "SELECT id, name, created_at FROM users\nORDER BY created_at DESC\nLIMIT 50 OFFSET 100;",
            ms: "SELECT id, name, created_at FROM users\nORDER BY created_at DESC\nOFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY;"
        },
        string_agg: {
            pg: "SELECT dept_id, string_agg(emp_name, ', ' ORDER BY emp_name) AS members\nFROM emps\nGROUP BY dept_id;",
            ms: "SELECT dept_id, STRING_AGG(emp_name, ', ') WITHIN GROUP (ORDER BY emp_name) AS members\nFROM emps\nGROUP BY dept_id;"
        },
        lateral_apply: {
            pg: "SELECT d.id, d.name, sub.emp_name\nFROM departments d\nCROSS JOIN LATERAL (\n    SELECT emp_name FROM emps WHERE dept_id = d.id ORDER BY salary DESC LIMIT 3\n) sub;",
            ms: "SELECT d.id, d.name, sub.emp_name\nFROM departments d\nCROSS APPLY (\n    SELECT TOP (3) emp_name FROM emps WHERE dept_id = d.id ORDER BY salary DESC\n) sub;"
        },
        coalesce_isnull: {
            pg: "SELECT id, COALESCE(phone, mobile, 'N/A') AS contact_phone\nFROM contacts;",
            ms: "SELECT id, ISNULL(phone, 'N/A') AS contact_phone\nFROM contacts;"
        },
        ilike: {
            pg: "SELECT * FROM products\nWHERE product_name ILIKE '%laptop%';",
            ms: "SELECT * FROM products\nWHERE product_name COLLATE Latin1_General_CI_AS LIKE '%laptop%';"
        },
        string_concat: {
            pg: "SELECT first_name || ' ' || last_name AS full_name,\n       CONCAT(first_name, ' ', last_name) AS safe_name\nFROM users;",
            ms: "SELECT first_name + ' ' + last_name AS full_name,\n       CONCAT(first_name, ' ', last_name) AS safe_name\nFROM users;"
        },
        substring: {
            pg: "SELECT emp_code,\n       SUBSTR(emp_code, 1, 3) AS dept_prefix,\n       SUBSTRING(emp_code FROM 4) AS emp_num\nFROM employees;",
            ms: "SELECT emp_code,\n       SUBSTRING(emp_code, 1, 3) AS dept_prefix,\n       SUBSTRING(emp_code, 4, LEN(emp_code)) AS emp_num\nFROM employees;"
        },
        dateadd: {
            pg: "SELECT order_id, order_date,\n       order_date + INTERVAL '30 days' AS due_date\nFROM orders;",
            ms: "SELECT order_id, order_date,\n       DATEADD(day, 30, order_date) AS due_date\nFROM orders;"
        },
        casting: {
            pg: "SELECT id, score::text, CAST(score AS integer)\nFROM submissions;",
            ms: "SELECT id, CAST(score AS varchar(20)), TRY_CAST(score AS int)\nFROM submissions;"
        },
        returning_output: {
            pg: "INSERT INTO audit_logs (action, user_id)\nVALUES ('login', 1001)\nRETURNING id, created_at;",
            ms: "INSERT INTO audit_logs (action, user_id)\nOUTPUT inserted.id, inserted.created_at\nVALUES ('login', 1001);"
        },
        upsert_merge: {
            pg: "INSERT INTO products (id, name, price)\nVALUES (101, 'Mechanical Keyboard', 120)\nON CONFLICT (id) DO UPDATE\nSET price = EXCLUDED.price;",
            ms: "MERGE INTO products AS target\nUSING (VALUES (101, 'Mechanical Keyboard', 120)) AS source (id, name, price)\nON target.id = source.id\nWHEN MATCHED THEN\n    UPDATE SET price = source.price\nWHEN NOT MATCHED THEN\n    INSERT (id, name, price) VALUES (source.id, source.name, source.price);"
        },
        generate_series: {
            pg: "SELECT generate_series(1, 10) AS num;\n-- Hoặc sinh dãy ngày:\nSELECT generate_series('2026-01-01'::date, '2026-01-07'::date, '1 day'::interval);",
            ms: "-- Mô phỏng generate_series bằng Recursive CTE trên SQL Server:\nWITH Numbers AS (\n    SELECT 1 AS num\n    UNION ALL\n    SELECT num + 1 FROM Numbers WHERE num < 10\n)\nSELECT num FROM Numbers OPTION (MAXRECURSION 100);"
        },
        select_into_temp: {
            pg: "CREATE TEMP TABLE temp_top_users AS\nSELECT id, name, email FROM users WHERE active = true;\nSELECT * FROM temp_top_users;",
            ms: "SELECT id, name, email\nINTO #temp_top_users\nFROM users WHERE active = 1;\nSELECT * FROM #temp_top_users;"
        }
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getEquivalenceBadge(level) {
        const lvl = (level || '').toLowerCase();
        if (lvl === 'equivalent' || lvl === 'exact') {
            return { cls: 'equiv-exact', label: 'Tương đương hoàn toàn (Exact)' };
        }
        if (lvl === 'conditional') {
            return { cls: 'equiv-diff', label: 'Tương đương có điều kiện (Conditional)' };
        }
        if (lvl === 'behavioral_difference') {
            return { cls: 'equiv-diff', label: 'Khác biệt hành vi (Behavioral Difference)' };
        }
        if (lvl === 'partial_equivalent' || lvl === 'partial') {
            return { cls: 'equiv-diff', label: 'Tương đương một phần (Partial)' };
        }
        if (lvl === 'rewrite_required') {
            return { cls: 'equiv-warn', label: 'Cần viết lại câu lệnh (Rewrite Required)' };
        }
        if (lvl === 'workaround_only' || lvl === 'workaround') {
            return { cls: 'equiv-warn', label: 'Giải pháp thay thế (Workaround)' };
        }
        if (lvl === 'no_direct_equivalent') {
            return { cls: 'equiv-warn', label: 'Không có tương đương trực tiếp' };
        }
        return { cls: 'equiv-info', label: 'Cú pháp liên quan (Related)' };
    }

    function getSourceBadge(source) {
        const st = (source && source.source_type || '').toLowerCase();
        if (st === 'w3schools') {
            return {
                cls: 'w3schools',
                icon: 'fa-solid fa-graduation-cap text-success',
                badgeHtml: '<span class="syntax-source-type-badge w3schools"><i class="fa-solid fa-graduation-cap me-1"></i>W3Schools</span>'
            };
        }
        if (st === 'ai') {
            return {
                cls: 'ai',
                icon: 'fa-solid fa-wand-magic-sparkles text-info',
                badgeHtml: '<span class="syntax-source-type-badge ai"><i class="fa-solid fa-robot me-1"></i>AI Knowledge Base</span>'
            };
        }
        if (st === 'tutorial') {
            return {
                cls: 'tutorial',
                icon: 'fa-solid fa-book-open text-primary',
                badgeHtml: '<span class="syntax-source-type-badge tutorial"><i class="fa-solid fa-book-open me-1"></i>Tutorial</span>'
            };
        }
        return {
            cls: 'official',
            icon: 'fa-solid fa-book-bookmark text-warning',
            badgeHtml: '<span class="syntax-source-type-badge official"><i class="fa-solid fa-certificate me-1"></i>Official Docs</span>'
        };
    }

    async function openExternalUrl(url) {
        if (!url) return;
        try {
            const api = await waitForBridge();
            if (api && typeof api.open_external_url === 'function') {
                await api.open_external_url(url);
                return;
            }
        } catch (e) {
            console.warn('[SyntaxWindow] open_external_url bridge call failed:', e);
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function waitForBridge(timeoutMs = 8000) {
        return new Promise((resolve) => {
            if (window.pywebview && window.pywebview.api) {
                return resolve(window.pywebview.api);
            }
            const start = Date.now();
            const interval = setInterval(() => {
                if (window.pywebview && window.pywebview.api) {
                    clearInterval(interval);
                    resolve(window.pywebview.api);
                } else if (Date.now() - start > timeoutMs) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 50);
        });
    }

    // ── Tab Switching & Monaco Integration ──────────────────────────────────
    function switchTab(targetTab) {
        if (!targetTab) return;
        currentTab = targetTab;

        const navBtns = document.querySelectorAll('.syntax-window-tab');
        navBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));

        const refView = document.getElementById('syntax-view-reference');
        const cmpView = document.getElementById('syntax-view-compare');
        if (refView) refView.classList.toggle('active', currentTab === 'reference');
        if (cmpView) cmpView.classList.toggle('active', currentTab === 'compare');

        setTimeout(() => {
            if (currentTab === 'compare') {
                if (sourceMonacoEditor) sourceMonacoEditor.layout();
                if (targetMonacoEditor) targetMonacoEditor.layout();
                compareMonacoInstances.forEach((ed) => {
                    try { ed.layout(); } catch (e) { }
                });
            } else {
                detailMonacoInstances.forEach((ed) => {
                    try { ed.layout(); } catch (e) { }
                });
            }
        }, 80);
    }

    function initTabNavigation() {
        const navBtns = document.querySelectorAll('.syntax-window-tab');
        navBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                switchTab(btn.dataset.tab);
            });
        });
    }

    function openInCompare(sql, sourceDb) {
        switchTab('compare');

        const sSelect = document.getElementById('cmp-source-dialect');
        const tSelect = document.getElementById('cmp-target-dialect');
        if (sSelect && tSelect && sourceDb) {
            const isPg = sourceDb.toLowerCase().includes('postgre');
            sSelect.value = isPg ? 'postgresql' : 'sqlserver';
            tSelect.value = isPg ? 'sqlserver' : 'postgresql';
            const changeEvent = new Event('change');
            sSelect.dispatchEvent(changeEvent);
        }

        setSourceSql(sql || '');
        setTargetSql('');
        triggerAnalyze();
    }

    function initMonacoEditors() {
        if (typeof window.require === 'undefined') {
            return;
        }
        window.require(['vs/editor/editor.main'], function () {
            try {
                isMonacoReady = true;
                const monacoTheme = getActiveMonacoTheme();

                const srcContainer = document.getElementById('cmp-source-monaco');
                const tgtContainer = document.getElementById('cmp-target-monaco');
                const srcTa = document.getElementById('cmp-source-editor');
                const tgtTa = document.getElementById('cmp-target-editor');

                if (srcContainer && !sourceMonacoEditor) {
                    sourceMonacoEditor = monaco.editor.create(srcContainer, {
                        value: srcTa ? srcTa.value : '',
                        language: 'sql',
                        theme: monacoTheme,
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineHeight: 20,
                        fontFamily: "var(--ide-font-mono, 'JetBrains Mono', Consolas, monospace)",
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        renderLineHighlight: 'all',
                    });
                    if (srcTa) srcTa.classList.add('d-none');
                }

                if (tgtContainer && !targetMonacoEditor) {
                    targetMonacoEditor = monaco.editor.create(tgtContainer, {
                        value: tgtTa ? tgtTa.value : '',
                        language: 'sql',
                        theme: monacoTheme,
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineHeight: 20,
                        fontFamily: "var(--ide-font-mono, 'JetBrains Mono', Consolas, monospace)",
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        renderLineHighlight: 'all',
                    });
                    if (tgtTa) tgtTa.classList.add('d-none');
                }

                // If detail or compare viewers are pending mount, mount them now
                mountDetailMonacoViewers();
                mountCompareMonacoViewers();

                // Dynamic theme synchronization with IDE theme changes
                const themeObserver = new MutationObserver(() => {
                    if (window.monaco && window.monaco.editor) {
                        const mTheme = getActiveMonacoTheme();
                        window.monaco.editor.setTheme(mTheme);
                    }
                });
                themeObserver.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ['data-bs-theme']
                });

                // Window resize handler for all Monaco instances
                window.addEventListener('resize', () => {
                    if (sourceMonacoEditor) sourceMonacoEditor.layout();
                    if (targetMonacoEditor) targetMonacoEditor.layout();
                    detailMonacoInstances.forEach((ed) => {
                        try { ed.layout(); } catch (e) { }
                    });
                    compareMonacoInstances.forEach((ed) => {
                        try { ed.layout(); } catch (e) { }
                    });
                });

                // Dispose Monaco editors and disconnect observers on window unload
                window.addEventListener('beforeunload', () => {
                    try {
                        themeObserver.disconnect();
                        disposeDetailMonacoInstances();
                        disposeCompareMonacoInstances();
                        if (sourceMonacoEditor) sourceMonacoEditor.dispose();
                        if (targetMonacoEditor) targetMonacoEditor.dispose();
                    } catch (e) { }
                });
            } catch (err) {
                console.warn('[SyntaxReference] Monaco initialization fallback:', err);
            }
        });
    }

    // ── Reference View Controller ───────────────────────────────────────────
    async function loadCatalog() {
        const countEl = document.getElementById('win-syntax-count');
        const listEl = document.getElementById('win-syntax-list');
        if (countEl) countEl.textContent = 'Đang nạp kho kiến thức...';

        try {
            const api = await waitForBridge();
            if (!api || typeof api.search_syntax_catalog !== 'function') {
                if (countEl) countEl.textContent = 'Chưa kết nối được Desktop API';
                return;
            }

            let dbParam = null;
            let exclusiveParam = null;

            if (currentScopeFilter === 'postgresql') {
                dbParam = 'postgresql';
            } else if (currentScopeFilter === 'sqlserver') {
                dbParam = 'sqlserver';
            } else if (currentScopeFilter === 'exclusive-pg') {
                dbParam = 'postgresql';
                exclusiveParam = true;
            } else if (currentScopeFilter === 'exclusive-ms') {
                dbParam = 'sqlserver';
                exclusiveParam = true;
            } else if (currentScopeFilter === 'mapped') {
                exclusiveParam = false;
            }

            const catParam = currentCategoryFilter === 'all' ? null : currentCategoryFilter;

            const res = await api.search_syntax_catalog(currentSearchTerm, dbParam, catParam, null, exclusiveParam);
            if (res && res.success) {
                catalogEntries = res.results || [];
                renderList(catalogEntries);
            } else {
                if (countEl) countEl.textContent = 'Lỗi nạp dữ liệu';
            }
        } catch (err) {
            console.error('[SyntaxWindow] loadCatalog error:', err);
            if (countEl) countEl.textContent = 'Lỗi kết nối';
        }
    }

    function renderList(entries) {
        const countEl = document.getElementById('win-syntax-count');
        const listEl = document.getElementById('win-syntax-list');
        if (!listEl) return;

        if (countEl) {
            let scopeLabel = 'mục cú pháp';
            if (currentScopeFilter === 'exclusive-pg') scopeLabel = 'lệnh đặc thù PostgreSQL';
            else if (currentScopeFilter === 'exclusive-ms') scopeLabel = 'lệnh đặc thù SQL Server';
            else if (currentScopeFilter === 'mapped') scopeLabel = 'cặp cú pháp đối chiếu 2 bên';
            else if (currentScopeFilter === 'postgresql') scopeLabel = 'cú pháp PostgreSQL';
            else if (currentScopeFilter === 'sqlserver') scopeLabel = 'cú pháp SQL Server';
            countEl.textContent = `Hiển thị ${entries.length} ${scopeLabel}`;
        }

        if (!entries || entries.length === 0) {
            listEl.innerHTML = `
                <div class="syntax-empty-state">
                    <i class="fa-solid fa-folder-open syntax-empty-icon"></i>
                    <span>Không tìm thấy cú pháp phù hợp</span>
                </div>
            `;
            return;
        }

        let html = '';
        entries.forEach((item) => {
            const isSelected = item.id === selectedSyntaxId;
            const isPg = (item.database || '').toLowerCase().includes('postgre');
            const dbBadgeClass = isPg ? 'badge-pg' : 'badge-ms';
            const dbLabel = isPg ? 'PostgreSQL' : 'SQL Server';

            const exclusiveTag = item.is_exclusive
                ? `<span class="syntax-exclusive-tag ${isPg ? 'exclusive-pg' : 'exclusive-ms'}">
                       <i class="fa-solid ${isPg ? 'fa-cube' : 'fa-gem'} me-1"></i>Lệnh riêng
                   </span>`
                : '';

            html += `
                <div class="syntax-list-card ${isSelected ? 'selected' : ''}" data-id="${escapeHtml(item.id)}">
                    <div class="syntax-card-top">
                        <span class="syntax-db-badge ${dbBadgeClass}">${dbLabel}</span>
                        ${exclusiveTag}
                        <span class="syntax-card-category">${escapeHtml(item.category || '')}</span>
                    </div>
                    <div class="syntax-card-name">${escapeHtml(item.display_name || item.name || item.id)}</div>
                    <div class="syntax-card-code-preview">${escapeHtml(item.syntax || '')}</div>
                </div>
            `;
        });

        listEl.innerHTML = html;

        listEl.querySelectorAll('.syntax-list-card').forEach((el) => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                selectItem(id);
            });
        });

        // Auto select first item if none selected or selection not in entries
        if (entries.length > 0) {
            const currentExists = entries.some(e => e.id === selectedSyntaxId);
            if (!selectedSyntaxId || !currentExists) {
                selectItem(entries[0].id);
            }
        }
    }

    async function selectItem(syntaxId) {
        selectedSyntaxId = syntaxId;

        document.querySelectorAll('.syntax-list-card').forEach((el) => {
            el.classList.toggle('selected', el.dataset.id === syntaxId);
        });

        const detailEl = document.getElementById('win-syntax-detail');
        if (!detailEl) return;
        detailEl.innerHTML = `
            <div class="syntax-empty-state">
                <i class="fa-solid fa-spinner fa-spin syntax-empty-icon"></i>
                <span>Đang tải thông tin chi tiết và đối chiếu...</span>
            </div>
        `;

        try {
            const api = await waitForBridge();
            if (!api) return;

            const res = await api.get_syntax_entry(syntaxId);
            if (res && res.success && res.entry) {
                renderDetail(res.entry, res.mappings || []);
            } else {
                detailEl.innerHTML = `<div class="alert alert-warning">${escapeHtml((res && res.error) || 'Không tìm thấy mục')}</div>`;
            }
        } catch (err) {
            console.error('[SyntaxWindow] selectItem error:', err);
            detailEl.innerHTML = `<div class="alert alert-danger">Lỗi khi tải chi tiết</div>`;
        }
    }

    function renderDetail(entry, mappings) {
        const detailEl = document.getElementById('win-syntax-detail');
        if (!detailEl) return;

        const isPg = (entry.database || '').toLowerCase().includes('postgre');
        const dbBadgeClass = isPg ? 'badge-pg' : 'badge-ms';
        const dbLabel = isPg ? 'PostgreSQL' : 'SQL Server';
        const counterpartDb = isPg ? 'SQL Server' : 'PostgreSQL';

        // 1. Header Badges: Context & Version & Category & Exclusive
        let badgesHtml = `<span class="syntax-db-badge ${dbBadgeClass}">${dbLabel}</span>`;
        if (entry.is_exclusive) {
            badgesHtml += `
                <span class="syntax-exclusive-tag ${isPg ? 'exclusive-pg' : 'exclusive-ms'}">
                    <i class="fa-solid ${isPg ? 'fa-cube' : 'fa-gem'} me-1"></i>Lệnh đặc thù ${dbLabel}
                </span>
            `;
        }
        if (entry.category) {
            badgesHtml += `<span class="syntax-card-category">${escapeHtml(entry.category)}</span>`;
        }
        if (entry.context) {
            badgesHtml += `<span class="syntax-context-badge"><i class="fa-solid fa-layer-group me-1"></i>${escapeHtml(entry.context)}</span>`;
        }
        if (entry.version_min) {
            badgesHtml += `<span class="syntax-version-badge"><i class="fa-solid fa-code-branch me-1"></i>≥ v${escapeHtml(entry.version_min)}</span>`;
        }

        // 2. Aliases Row
        let aliasesHtml = '';
        if (entry.aliases && entry.aliases.length > 0) {
            aliasesHtml = `
                <div class="syntax-aliases-row">
                    <span class="syntax-aliases-label"><i class="fa-solid fa-tag me-1"></i>Bí danh &amp; Tên gọi khác:</span>
                    ${entry.aliases.map(a => `<code class="syntax-alias-tag">${escapeHtml(a)}</code>`).join(' ')}
                </div>
            `;
        }

        // 3. Exclusive Banner (if engine-exclusive)
        let exclusiveBannerHtml = '';
        if (entry.is_exclusive) {
            exclusiveBannerHtml = `
                <div class="syntax-detail-section">
                    <div class="syntax-exclusive-banner ${isPg ? 'exclusive-pg' : 'exclusive-ms'}">
                        <div class="syntax-exclusive-banner-icon">
                            <i class="fa-solid ${isPg ? 'fa-cube' : 'fa-gem'}"></i>
                        </div>
                        <div class="syntax-exclusive-banner-body">
                            <h6>Tính năng / Cú pháp đặc thù riêng của ${dbLabel} (Engine Exclusive)</h6>
                            <p>
                                Đây là câu lệnh chuyên biệt của hệ quản trị ${dbLabel}, không thuộc chuẩn ANSI-SQL chung.
                                ${counterpartDb} không có câu lệnh tương đương trực tiếp 1-1 cho cú pháp này mà phải thông qua giải pháp mô phỏng hoặc viết lại logic.
                            </p>
                        </div>
                    </div>
                </div>
            `;
        }

        // 4. Workaround Emulation Card (if workaround is provided)
        let workaroundHtml = '';
        if (entry.workaround) {
            workaroundHtml = `
                <div class="syntax-detail-section">
                    <div class="syntax-workaround-card">
                        <div class="syntax-workaround-hdr">
                            <span class="syntax-workaround-title">
                                <i class="fa-solid fa-shuffle text-warning me-1"></i>
                                Giải pháp mô phỏng / thay thế trên ${counterpartDb} (Workaround &amp; Alternative)
                            </span>
                            <span class="syntax-source-type-badge official"><i class="fa-solid fa-screwdriver-wrench me-1"></i>Emulation</span>
                        </div>
                        <div class="syntax-workaround-body">
                            <p class="syntax-workaround-desc">${escapeHtml(entry.workaround)}</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // 5. AI Guidance & Architectural Insights
        let aiInsightsHtml = '';
        if (entry.ai_insights) {
            aiInsightsHtml = `
                <div class="syntax-detail-section">
                    <div class="syntax-ai-card">
                        <div class="syntax-ai-hdr">
                            <span class="syntax-ai-title">
                                <i class="fa-solid fa-wand-magic-sparkles text-info me-1"></i>
                                Khuyến nghị kiến trúc &amp; Phân tích chuyên sâu từ AI (AI Insights)
                            </span>
                            <span class="syntax-source-type-badge ai"><i class="fa-solid fa-robot me-1"></i>AI Verified</span>
                        </div>
                        <div class="syntax-ai-body">
                            <div class="syntax-ai-text">${escapeHtml(entry.ai_insights)}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // 6. Examples Section (handles array `examples` with title, sql, explanation)
        let examplesList = [];
        if (Array.isArray(entry.examples) && entry.examples.length > 0) {
            examplesList = entry.examples;
        } else if (entry.example) {
            examplesList = [{
                title: 'Ví dụ minh họa',
                sql: entry.example,
                explanation: ''
            }];
        }

        let examplesHtml = '';
        if (examplesList.length > 0) {
            examplesHtml = `
                <div class="syntax-detail-section">
                    <h5 class="syntax-section-heading">
                        <i class="fa-solid fa-terminal me-1"></i> Ví dụ thực tế (Example Usage)
                    </h5>
                    ${examplesList.map((ex, idx) => `
                        <div class="syntax-example-card">
                            <div class="syntax-example-hdr">
                                <span class="syntax-example-title">
                                    <i class="fa-solid fa-code-branch text-info me-1"></i> ${escapeHtml(ex.title || `Ví dụ ${idx + 1}`)}
                                </span>
                                <div class="syntax-cmp-actions">
                                    <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(ex.sql || '')}" title="Sao chép ví dụ">
                                        <i class="fa-regular fa-copy me-1"></i> Copy
                                    </button>
                                    <button type="button" class="syntax-btn-open-compare" data-sql="${escapeHtml(ex.sql || '')}" data-db="${escapeHtml(entry.database)}" title="Mở ví dụ này trong tab So sánh">
                                        <i class="fa-solid fa-code-compare me-1"></i> So sánh
                                    </button>
                                    <button type="button" class="syntax-btn-insert" data-code="${escapeHtml(ex.sql || '')}" title="Chèn vào tab Editor chính đang mở">
                                        <i class="fa-solid fa-arrow-turn-down me-1"></i> Chèn vào Editor
                                    </button>
                                </div>
                            </div>
                            <div class="syntax-monaco-viewer" data-code="${escapeHtml(ex.sql || '')}" data-lang="sql"></div>
                            ${ex.explanation ? `
                                <div class="syntax-example-explanation">
                                    <i class="fa-solid fa-circle-info text-info me-1"></i> ${escapeHtml(ex.explanation)}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // 7. Gotchas & Notes
        let gotchasHtml = '';
        if (entry.gotchas && entry.gotchas.length > 0) {
            gotchasHtml = `
                <div class="syntax-detail-section">
                    <div class="syntax-notice-box warning">
                        <div class="syntax-notice-title">
                            <i class="fa-solid fa-triangle-exclamation text-warning me-1"></i> Lưu ý &amp; Trường hợp đặc biệt (Gotchas)
                        </div>
                        <ul class="syntax-gotchas-list">
                            ${entry.gotchas.map(g => `<li>${escapeHtml(g)}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
        }

        // 8. Cross-Database Mappings
        let mappingsHtml = '';
        if (mappings && mappings.length > 0) {
            mappingsHtml = `
                <div class="syntax-detail-section">
                    <h5 class="syntax-section-heading">
                        <i class="fa-solid fa-code-compare me-1"></i> Đối chiếu sang hệ quản trị CSDL tương đương
                    </h5>
                    ${mappings.map(m => renderMappingCard(m, entry.database)).join('')}
                </div>
            `;
        }

        // 9. Documentation Sources (W3Schools, Official, Tutorials, AI Knowledge Base)
        const allSources = [];
        const rawSources = (entry.sources || entry.official_sources || []);
        rawSources.forEach(s => {
            if (s && s.url && !allSources.some(existing => existing.url === s.url)) {
                allSources.push(s);
            }
        });
        (mappings || []).forEach(m => {
            (m.sources || []).forEach(s => {
                if (s && s.url && !allSources.some(existing => existing.url === s.url)) {
                    allSources.push(s);
                }
            });
        });

        let sourcesHtml = '';
        if (allSources.length > 0) {
            sourcesHtml = `
                <div class="syntax-detail-section">
                    <h5 class="syntax-section-heading">
                        <i class="fa-solid fa-book-open-reader me-1"></i> Nguồn tài liệu &amp; Tham chiếu mở rộng (Docs, W3Schools, AI)
                    </h5>
                    <div class="d-flex flex-column gap-2">
                        ${allSources.map(s => {
                            const badgeInfo = getSourceBadge(s);
                            return `
                                <a href="${escapeHtml(s.url)}" class="syntax-source-link" data-url="${escapeHtml(s.url)}">
                                    <i class="${badgeInfo.icon}"></i>
                                    <span class="syntax-source-link-title">${escapeHtml(s.title || s.url)}</span>
                                    ${badgeInfo.badgeHtml}
                                    <span class="syntax-source-verified"><i class="fa-solid fa-circle-check text-success me-1"></i>Đã kiểm chứng</span>
                                    <i class="fa-solid fa-arrow-up-right-from-square ms-auto"></i>
                                </a>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        detailEl.innerHTML = `
            <div class="syntax-detail-header">
                <div class="syntax-detail-tags">
                    ${badgesHtml}
                </div>
                <h4 class="syntax-detail-title">${escapeHtml(entry.display_name || entry.name || entry.id)}</h4>
                <p class="syntax-detail-desc">${escapeHtml(entry.description || entry.summary || '')}</p>
                ${aliasesHtml}
            </div>

            ${exclusiveBannerHtml}

            <div class="syntax-detail-section">
                <div class="syntax-code-card">
                    <div class="syntax-code-card-hdr">
                        <span class="syntax-code-card-title">
                            <i class="fa-solid fa-code text-info me-1"></i> Cú pháp chuẩn (Syntax Definition)
                        </span>
                        <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(entry.syntax || '')}" title="Sao chép cú pháp">
                            <i class="fa-regular fa-copy me-1"></i> Copy
                        </button>
                    </div>
                    <div class="syntax-monaco-viewer" data-code="${escapeHtml(entry.syntax || '')}" data-lang="sql"></div>
                </div>
            </div>

            ${workaroundHtml}
            ${aiInsightsHtml}
            ${examplesHtml}
            ${gotchasHtml}
            ${mappingsHtml}
            ${sourcesHtml}
        `;

        // Mount all read-only Monaco viewers in the detail pane
        mountDetailMonacoViewers();

        // Wire copy buttons
        detailEl.querySelectorAll('.syntax-btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                copyToClipboard(btn.dataset.code, btn);
            });
        });

        // Wire insert to editor buttons
        detailEl.querySelectorAll('.syntax-btn-insert').forEach(btn => {
            btn.addEventListener('click', () => {
                insertToActiveEditor(btn.dataset.code, btn);
            });
        });

        // Wire open in compare buttons
        detailEl.querySelectorAll('.syntax-btn-open-compare').forEach(btn => {
            btn.addEventListener('click', () => {
                openInCompare(btn.dataset.sql, btn.dataset.db);
            });
        });

        // Wire external source links
        detailEl.querySelectorAll('.syntax-source-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const url = link.dataset.url || link.getAttribute('href');
                if (url) openExternalUrl(url);
            });
        });
    }

    function renderMappingCard(mapping, currentDb) {
        const isPg = (currentDb || '').toLowerCase().includes('postgre');
        const counterpartDb = isPg ? 'SQL Server' : 'PostgreSQL';
        const counterpartBadgeClass = isPg ? 'badge-ms' : 'badge-pg';

        const eqBadge = getEquivalenceBadge(mapping.equivalence_level);

        // Find counterpart syntax entries from mapping
        const allMapped = (mapping.source_syntaxes || []).concat(mapping.target_syntaxes || []);
        let counterparts = allMapped.filter(s => s && s.database !== currentDb);

        // Fallback to legacy fields if counterparts array is empty
        if (counterparts.length === 0) {
            const fallbackCode = isPg ? (mapping.sqlserver_syntax || '') : (mapping.postgresql_syntax || '');
            const fallbackEx = isPg ? (mapping.sqlserver_example || '') : (mapping.postgresql_example || '');
            if (fallbackCode) {
                counterparts.push({
                    id: 'fallback_counterpart',
                    database: isPg ? 'sqlserver' : 'postgresql',
                    display_name: mapping.concept_title || mapping.concept_id || counterpartDb,
                    syntax: fallbackCode,
                    examples: fallbackEx ? [{ title: 'Ví dụ tương đương', sql: fallbackEx, explanation: '' }] : []
                });
            }
        }

        const conceptTitle = (mapping.concept && mapping.concept.title) || mapping.concept_title || mapping.concept_id;

        let counterpartsHtml = '';
        if (counterparts.length > 0) {
            counterpartsHtml = counterparts.map((cp) => {
                const cpIsPg = (cp.database || '').toLowerCase().includes('postgre');
                const cpBadge = cpIsPg ? 'badge-pg' : 'badge-ms';
                const cpDbName = cpIsPg ? 'PostgreSQL' : 'SQL Server';

                let cpExamplesHtml = '';
                if (Array.isArray(cp.examples) && cp.examples.length > 0) {
                    cpExamplesHtml = cp.examples.map((ex, exIdx) => `
                        <div class="syntax-cmp-row mt-2">
                            <div class="syntax-cmp-row-header">
                                <span><i class="fa-solid fa-code me-1"></i> Ví dụ tương đương (${cpDbName}${ex.title ? `: ${escapeHtml(ex.title)}` : ''}):</span>
                                <div class="syntax-cmp-actions">
                                    <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(ex.sql || '')}" title="Copy ví dụ">
                                        <i class="fa-regular fa-copy"></i> Copy
                                    </button>
                                    <button type="button" class="syntax-btn-open-compare" data-sql="${escapeHtml(ex.sql || '')}" data-db="${escapeHtml(cp.database)}" title="Mở ví dụ này trong tab So sánh">
                                        <i class="fa-solid fa-code-compare"></i> So sánh
                                    </button>
                                    <button type="button" class="syntax-btn-insert" data-code="${escapeHtml(ex.sql || '')}" title="Chèn vào Editor chính">
                                        <i class="fa-solid fa-arrow-turn-down"></i> Chèn vào Editor
                                    </button>
                                </div>
                            </div>
                            <div class="syntax-monaco-viewer" data-code="${escapeHtml(ex.sql || '')}" data-lang="sql"></div>
                            ${ex.explanation ? `<div class="syntax-example-explanation mt-1"><i class="fa-solid fa-circle-info text-info me-1"></i> ${escapeHtml(ex.explanation)}</div>` : ''}
                        </div>
                    `).join('');
                }

                return `
                    <div class="syntax-counterpart-item">
                        <div class="syntax-cmp-row-header">
                            <div>
                                <span class="syntax-db-badge ${cpBadge}">${cpDbName}</span>
                                <strong class="ms-2">${escapeHtml(cp.display_name || cp.name || cp.id)}</strong>
                            </div>
                            <div class="syntax-cmp-actions">
                                <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(cp.syntax || '')}" title="Copy cú pháp">
                                    <i class="fa-regular fa-copy"></i> Copy
                                </button>
                                <button type="button" class="syntax-btn-open-compare" data-sql="${escapeHtml(cp.syntax || '')}" data-db="${escapeHtml(cp.database)}" title="Mở cú pháp này trong tab So sánh">
                                    <i class="fa-solid fa-code-compare"></i> So sánh
                                </button>
                                <button type="button" class="syntax-btn-insert" data-code="${escapeHtml(cp.syntax || '')}" title="Chèn vào Editor chính">
                                    <i class="fa-solid fa-arrow-turn-down"></i> Chèn vào Editor
                                </button>
                            </div>
                        </div>
                        <div class="syntax-monaco-viewer" data-code="${escapeHtml(cp.syntax || '')}" data-lang="sql"></div>
                        ${cpExamplesHtml}
                    </div>
                `;
            }).join('');
        }

        // Comparison Examples from mapping (paired side-by-side or stacked)
        let compExHtml = '';
        if (Array.isArray(mapping.comparison_examples) && mapping.comparison_examples.length > 0) {
            compExHtml = `
                <div class="syntax-comparison-examples-box mt-2">
                    <div class="syntax-comparison-examples-title">
                        <i class="fa-solid fa-code-compare text-info me-1"></i> Ví dụ đối chiếu thực tế (PostgreSQL ⟷ SQL Server):
                    </div>
                    ${mapping.comparison_examples.map((ce, cIdx) => `
                        <div class="syntax-comparison-example-pair">
                            <div class="syntax-comp-pair-grid">
                                <div class="syntax-comp-col">
                                    <div class="syntax-comp-col-hdr">
                                        <span class="syntax-db-badge badge-pg">PostgreSQL</span>
                                        <div class="syntax-cmp-actions">
                                            <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(ce.postgresql || '')}" title="Copy SQL PostgreSQL">
                                                <i class="fa-regular fa-copy"></i> Copy
                                            </button>
                                            <button type="button" class="syntax-btn-open-compare" data-sql="${escapeHtml(ce.postgresql || '')}" data-db="postgresql" title="Mở trong tab So sánh">
                                                <i class="fa-solid fa-code-compare"></i> So sánh
                                            </button>
                                        </div>
                                    </div>
                                    <div class="syntax-monaco-viewer" data-code="${escapeHtml(ce.postgresql || '')}" data-lang="sql"></div>
                                </div>
                                <div class="syntax-comp-col">
                                    <div class="syntax-comp-col-hdr">
                                        <span class="syntax-db-badge badge-ms">SQL Server</span>
                                        <div class="syntax-cmp-actions">
                                            <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(ce.sqlserver || '')}" title="Copy SQL SQL Server">
                                                <i class="fa-regular fa-copy"></i> Copy
                                            </button>
                                            <button type="button" class="syntax-btn-open-compare" data-sql="${escapeHtml(ce.sqlserver || '')}" data-db="sqlserver" title="Mở trong tab So sánh">
                                                <i class="fa-solid fa-code-compare"></i> So sánh
                                            </button>
                                        </div>
                                    </div>
                                    <div class="syntax-monaco-viewer" data-code="${escapeHtml(ce.sqlserver || '')}" data-lang="sql"></div>
                                </div>
                            </div>
                            ${ce.notes ? `<div class="syntax-example-explanation mt-1"><i class="fa-solid fa-circle-info text-info me-1"></i> ${escapeHtml(ce.notes)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return `
            <div class="syntax-mapping-card">
                <div class="syntax-mapping-hdr">
                    <div>
                        <span class="syntax-db-badge ${counterpartBadgeClass}">${counterpartDb}</span>
                        <strong class="ms-2">${escapeHtml(conceptTitle)}</strong>
                    </div>
                    <span class="syntax-equiv-badge ${eqBadge.cls}">${eqBadge.label}</span>
                </div>

                ${(mapping.notes || mapping.differences) ? `
                    <div class="syntax-notice-box note">
                        <strong><i class="fa-solid fa-circle-info text-info me-1"></i> Khác biệt &amp; Lưu ý cốt lõi:</strong>
                        <div>${escapeHtml(mapping.notes || mapping.differences)}</div>
                    </div>
                ` : ''}

                ${mapping.conditions ? `
                    <div class="syntax-notice-box info">
                        <strong><i class="fa-solid fa-check-double text-success me-1"></i> Điều kiện tương đương:</strong>
                        <div>${escapeHtml(mapping.conditions)}</div>
                    </div>
                ` : ''}

                ${mapping.limitations ? `
                    <div class="syntax-notice-box danger">
                        <strong><i class="fa-solid fa-triangle-exclamation text-danger me-1"></i> Giới hạn kỹ thuật:</strong>
                        <div>${escapeHtml(mapping.limitations)}</div>
                    </div>
                ` : ''}

                ${counterpartsHtml}
                ${compExHtml}
            </div>
        `;
    }

    async function copyToClipboard(text, btnEl) {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            if (btnEl) {
                const orig = btnEl.innerHTML;
                btnEl.innerHTML = `<i class="fa-solid fa-check text-success me-1"></i> Đã sao chép!`;
                setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
            }
        } catch (err) {
            console.error('[SyntaxWindow] Clipboard write failed:', err);
        }
    }

    async function insertToActiveEditor(sql, btnEl) {
        if (!sql) return;
        try {
            const api = await waitForBridge();
            if (api && typeof api.insert_to_active_editor === 'function') {
                const res = await api.insert_to_active_editor(sql);
                if (res && res.success) {
                    if (btnEl) {
                        const orig = btnEl.innerHTML;
                        btnEl.innerHTML = `<i class="fa-solid fa-check text-success me-1"></i> Đã chèn vào Editor!`;
                        setTimeout(() => { btnEl.innerHTML = orig; }, 1800);
                    }
                } else {
                    alert((res && res.error) || 'Không thể chèn vào editor chính');
                }
            } else {
                copyToClipboard(sql, btnEl);
            }
        } catch (err) {
            console.error('[SyntaxWindow] insertToActiveEditor error:', err);
        }
    }

    function initFilterControls() {
        const searchInput = document.getElementById('win-syntax-search');
        const clearBtn = document.getElementById('win-syntax-search-clear');
        const categorySelect = document.getElementById('win-syntax-category');
        const scopePills = document.querySelectorAll('#win-syntax-db-pills .syntax-ref-pill');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                currentSearchTerm = e.target.value.trim();
                if (clearBtn) clearBtn.classList.toggle('visible', currentSearchTerm.length > 0);

                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    loadCatalog();
                }, 220);
            });
        }

        if (clearBtn && searchInput) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                currentSearchTerm = '';
                clearBtn.classList.remove('visible');
                loadCatalog();
                searchInput.focus();
            });
        }

        if (categorySelect) {
            categorySelect.addEventListener('change', (e) => {
                currentCategoryFilter = e.target.value;
                loadCatalog();
            });
        }

        scopePills.forEach((pill) => {
            pill.addEventListener('click', () => {
                scopePills.forEach((p) => p.classList.remove('active'));
                pill.classList.add('active');
                currentScopeFilter = pill.dataset.scope || 'all';
                loadCatalog();
            });
        });
    }

    // ── Compare View Controller (Phase 3 Core) ───────────────────────────────
    function initCompareView() {
        const sourceSelect = document.getElementById('cmp-source-dialect');
        const targetSelect = document.getElementById('cmp-target-dialect');
        const swapBtn = document.getElementById('cmp-btn-swap');
        const analyzeBtn = document.getElementById('cmp-btn-analyze');
        const sourceClearBtn = document.getElementById('cmp-source-clear');
        const targetCopyBtn = document.getElementById('cmp-target-copy');
        const targetInsertBtn = document.getElementById('cmp-target-insert');
        const sampleBtns = document.querySelectorAll('.syntax-sample-btn');

        function updateDialectLabels() {
            const sVal = sourceSelect.value;
            const tVal = targetSelect.value;
            const sTitle = sVal === 'postgresql' ? 'Đoạn SQL nguồn (PostgreSQL)' : 'Đoạn SQL nguồn (Microsoft SQL Server)';
            const tTitle = tVal === 'sqlserver' ? 'Cú pháp tương đương đích (Microsoft SQL Server)' : 'Cú pháp tương đương đích (PostgreSQL)';

            const sIcon = sVal === 'postgresql' ? 'fa-database text-info' : 'fa-database text-warning';
            const tIcon = tVal === 'sqlserver' ? 'fa-database text-warning' : 'fa-database text-info';

            const sHdr = document.getElementById('cmp-source-hdr-title');
            const tHdr = document.getElementById('cmp-target-hdr-title');
            if (sHdr) sHdr.innerHTML = `<i class="fa-solid ${sIcon} me-1"></i> ${sTitle}`;
            if (tHdr) tHdr.innerHTML = `<i class="fa-solid ${tIcon} me-1"></i> ${tTitle}`;
        }

        if (sourceSelect) sourceSelect.addEventListener('change', updateDialectLabels);
        if (targetSelect) targetSelect.addEventListener('change', updateDialectLabels);

        if (swapBtn) {
            swapBtn.addEventListener('click', () => {
                const temp = sourceSelect.value;
                sourceSelect.value = targetSelect.value;
                targetSelect.value = temp;
                updateDialectLabels();

                // Swap editor contents
                const tempText = getSourceSql();
                setSourceSql(getTargetSql());
                setTargetSql(tempText);

                // Auto-analyze if source has SQL
                if (getSourceSql().trim()) {
                    triggerAnalyze();
                }
            });
        }

        if (sourceClearBtn) {
            sourceClearBtn.addEventListener('click', () => {
                setSourceSql('');
                setTargetSql('');
                disposeCompareMonacoInstances();
                const resPanel = document.getElementById('cmp-result-panel');
                if (resPanel) {
                    resPanel.innerHTML = `
                        <div class="syntax-empty-state">
                            <i class="fa-solid fa-code-compare syntax-empty-icon"></i>
                            <span>Đã xóa nội dung. Nhập câu lệnh SQL mới để phân tích đối chiếu.</span>
                        </div>
                    `;
                }
            });
        }

        sampleBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const sampleKey = btn.dataset.sample;
                const sDialect = sourceSelect.value === 'postgresql' ? 'pg' : 'ms';
                const tDialect = targetSelect.value === 'postgresql' ? 'pg' : 'ms';

                if (PRESETS[sampleKey]) {
                    setSourceSql(PRESETS[sampleKey][sDialect] || '');
                    setTargetSql(PRESETS[sampleKey][tDialect] || '');
                    triggerAnalyze();
                }
            });
        });

        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', triggerAnalyze);
        }

        if (targetCopyBtn) {
            targetCopyBtn.addEventListener('click', () => {
                copyToClipboard(getTargetSql(), targetCopyBtn);
            });
        }

        if (targetInsertBtn) {
            targetInsertBtn.addEventListener('click', () => {
                insertToActiveEditor(getTargetSql(), targetInsertBtn);
            });
        }
    }

    async function triggerAnalyze() {
        const sourceSelect = document.getElementById('cmp-source-dialect');
        const targetSelect = document.getElementById('cmp-target-dialect');
        const resultPanel = document.getElementById('cmp-result-panel');

        const sql = getSourceSql().trim();
        if (!sql) {
            alert('Vui lòng nhập đoạn câu lệnh SQL nguồn cần đối chiếu.');
            return;
        }

        if (resultPanel) {
            disposeCompareMonacoInstances();
            resultPanel.innerHTML = `
                <div class="syntax-empty-state">
                    <i class="fa-solid fa-spinner fa-spin syntax-empty-icon"></i>
                    <span>Đang phân tích cấu trúc cú pháp và đối chiếu kho tri thức...</span>
                </div>
            `;
        }

        try {
            const api = await waitForBridge();
            if (!api || typeof api.compare_syntax_selection !== 'function') {
                if (resultPanel) resultPanel.innerHTML = `<div class="alert alert-warning">Desktop Compare API chưa sẵn sàng.</div>`;
                return;
            }

            const sourceDb = sourceSelect.value;
            const targetDb = targetSelect.value;

            const res = await api.compare_syntax_selection(sql, sourceDb, targetDb);
            if (res && res.success) {
                renderCompareResults(res);
            } else {
                if (resultPanel) {
                    resultPanel.innerHTML = `<div class="alert alert-danger">${escapeHtml((res && res.error) || 'Lỗi đối chiếu')}</div>`;
                }
            }
        } catch (err) {
            console.error('[SyntaxWindow] triggerAnalyze error:', err);
            if (resultPanel) {
                resultPanel.innerHTML = `<div class="alert alert-danger">Lỗi thực thi đối chiếu</div>`;
            }
        }
    }

    function renderCompareResults(res) {
        const resultPanel = document.getElementById('cmp-result-panel');
        if (!resultPanel) return;

        disposeCompareMonacoInstances();

        const matches = res.matched_concepts || [];
        if (matches.length === 0) {
            resultPanel.innerHTML = `
                <div class="syntax-compare-result-card">
                    <div class="d-flex align-items-center gap-2">
                        <i class="fa-solid fa-circle-question text-warning fs-5"></i>
                        <div>
                            <strong>Không nhận diện được quy tắc đối chiếu đặc thù</strong>
                            <div class="text-muted small">Đoạn SQL này có thể tuân theo chuẩn ANSI-SQL chung, hoặc chưa có trong danh mục Version 1.0.0.</div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // Set target editor preview with the first matched target example or syntax if target editor is empty
        const currentTargetVal = getTargetSql().trim();
        if (!currentTargetVal) {
            const firstTarget = matches[0].primary_target_example || matches[0].primary_target_syntax;
            if (firstTarget) {
                setTargetSql(firstTarget);
            }
        }

        let html = '';
        matches.forEach((item) => {
            const rawEq = item.primary_equivalence_level || (item.mappings && item.mappings[0] && item.mappings[0].equivalence_level) || 'equivalent';
            const eqBadge = getEquivalenceBadge(rawEq);

            const targetSyntax = item.primary_target_syntax || '';
            const targetExample = item.primary_target_example || '';
            const conditions = item.conditions || (item.mappings && item.mappings[0] && item.mappings[0].conditions) || '';
            const limitations = item.limitations || (item.mappings && item.mappings[0] && item.mappings[0].limitations) || '';
            const differences = item.differences || (item.mappings && item.mappings[0] && item.mappings[0].notes) || '';

            // Extract unique sources
            const sources = [];
            (item.mappings || []).forEach((m) => {
                (m.sources || []).forEach((s) => {
                    if (s && s.url && !sources.some(existing => existing.url === s.url)) {
                        sources.push(s);
                    }
                });
            });

            html += `
                <div class="syntax-compare-result-card">
                    <div class="syntax-compare-result-hdr">
                        <div class="syntax-compare-match-title">
                            <i class="fa-solid fa-check-double text-success"></i>
                            <span>${escapeHtml(item.concept_title || item.concept_id)}</span>
                            <span class="syntax-card-category">${escapeHtml(item.category || '')}</span>
                        </div>
                        <span class="syntax-equiv-badge ${eqBadge.cls}">${eqBadge.label}</span>
                    </div>

                    ${differences ? `
                        <div class="syntax-notice-box note mb-2">
                            <strong><i class="fa-solid fa-triangle-exclamation text-warning me-1"></i> Khác biệt cốt lõi &amp; Gotchas:</strong>
                            <div>${escapeHtml(differences)}</div>
                        </div>
                    ` : ''}

                    ${conditions ? `
                        <div class="syntax-notice-box info mb-2">
                            <strong><i class="fa-solid fa-circle-info text-info me-1"></i> Điều kiện tương đương:</strong>
                            <div>${escapeHtml(conditions)}</div>
                        </div>
                    ` : ''}

                    ${limitations ? `
                        <div class="syntax-notice-box danger mb-2">
                            <strong><i class="fa-solid fa-triangle-exclamation text-danger me-1"></i> Giới hạn kỹ thuật:</strong>
                            <div>${escapeHtml(limitations)}</div>
                        </div>
                    ` : ''}

                    ${targetSyntax ? `
                        <div class="syntax-cmp-row mb-2">
                            <div class="syntax-cmp-row-header">
                                <span><i class="fa-solid fa-code text-info me-1"></i> Cú pháp chuẩn đích:</span>
                                <div class="syntax-cmp-actions">
                                    <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(targetSyntax)}" title="Copy cú pháp">
                                        <i class="fa-regular fa-copy"></i> Copy
                                    </button>
                                    <button type="button" class="syntax-btn-apply-target" data-code="${escapeHtml(targetSyntax)}" title="Đưa cú pháp này vào khung SQL đích">
                                        <i class="fa-solid fa-arrow-right"></i> Áp dụng vào SQL đích
                                    </button>
                                </div>
                            </div>
                            <div class="syntax-monaco-viewer" data-code="${escapeHtml(targetSyntax)}" data-lang="sql"></div>
                        </div>
                    ` : ''}

                    ${targetExample ? `
                        <div class="syntax-cmp-row mb-2">
                            <div class="syntax-cmp-row-header">
                                <span><i class="fa-solid fa-terminal text-info me-1"></i> Ví dụ câu lệnh đối chiếu thực tế:</span>
                                <div class="syntax-cmp-actions">
                                    <button type="button" class="syntax-btn-copy" data-code="${escapeHtml(targetExample)}" title="Copy ví dụ">
                                        <i class="fa-regular fa-copy"></i> Copy
                                    </button>
                                    <button type="button" class="syntax-btn-apply-target" data-code="${escapeHtml(targetExample)}" title="Đưa ví dụ này vào khung SQL đích">
                                        <i class="fa-solid fa-arrow-right"></i> Áp dụng vào SQL đích
                                    </button>
                                    <button type="button" class="syntax-btn-insert" data-code="${escapeHtml(targetExample)}" title="Chèn vào Editor chính của IDE">
                                        <i class="fa-solid fa-arrow-turn-down"></i> Chèn vào Editor
                                    </button>
                                </div>
                            </div>
                            <div class="syntax-monaco-viewer" data-code="${escapeHtml(targetExample)}" data-lang="sql"></div>
                        </div>
                    ` : ''}

                    ${sources.length > 0 ? `
                        <div class="mt-2 text-muted small">
                            <strong><i class="fa-solid fa-book-open-reader text-info me-1"></i> Nguồn tài liệu &amp; Tham chiếu mở rộng:</strong>
                            <div class="d-flex flex-wrap gap-2 mt-1">
                                ${sources.map(s => {
                                    const bInfo = getSourceBadge(s);
                                    return `
                                        <a href="${escapeHtml(s.url)}" class="syntax-source-link" data-url="${escapeHtml(s.url)}">
                                            <i class="${bInfo.icon} me-1"></i>
                                            <span>${escapeHtml(s.title || s.url)}</span>
                                            ${bInfo.badgeHtml}
                                            <i class="fa-solid fa-arrow-up-right-from-square ms-1"></i>
                                        </a>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        resultPanel.innerHTML = html;

        // Mount all read-only Monaco viewers in compare results
        mountCompareMonacoViewers();

        // Wire copy buttons
        resultPanel.querySelectorAll('.syntax-btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                copyToClipboard(btn.dataset.code, btn);
            });
        });

        // Wire apply to target editor buttons
        resultPanel.querySelectorAll('.syntax-btn-apply-target').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.dataset.code;
                if (code) {
                    setTargetSql(code);
                    const orig = btn.innerHTML;
                    btn.innerHTML = `<i class="fa-solid fa-check text-success"></i> Đã áp dụng`;
                    setTimeout(() => { btn.innerHTML = orig; }, 1500);
                }
            });
        });

        // Wire insert into active editor buttons
        resultPanel.querySelectorAll('.syntax-btn-insert').forEach(btn => {
            btn.addEventListener('click', () => {
                insertToActiveEditor(btn.dataset.code, btn);
            });
        });

        // Wire external source links in compare results
        resultPanel.querySelectorAll('.syntax-source-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const url = link.dataset.url || link.getAttribute('href');
                if (url) openExternalUrl(url);
            });
        });
    }

    // ── Initial Context Handler (Selection & External Bridge) ───────────────
    function applyInitialContext(filter) {
        if (!filter || typeof filter !== 'object') return;

        if (filter.view === 'compare' || (typeof filter.sql_text === 'string' && filter.sql_text.trim())) {
            switchTab('compare');
            const sourceSelect = document.getElementById('cmp-source-dialect');
            const targetSelect = document.getElementById('cmp-target-dialect');
            if (filter.source_db && sourceSelect) {
                sourceSelect.value = filter.source_db;
            }
            if (filter.target_db && targetSelect) {
                targetSelect.value = filter.target_db;
            }
            const sVal = sourceSelect ? sourceSelect.value : 'postgresql';
            const tVal = targetSelect ? targetSelect.value : 'sqlserver';
            const sTitle = sVal === 'postgresql' ? 'Đoạn SQL nguồn (PostgreSQL)' : 'Đoạn SQL nguồn (Microsoft SQL Server)';
            const tTitle = tVal === 'sqlserver' ? 'Cú pháp tương đương đích (Microsoft SQL Server)' : 'Cú pháp tương đương đích (PostgreSQL)';
            const sIcon = sVal === 'postgresql' ? 'fa-database text-info' : 'fa-database text-warning';
            const tIcon = tVal === 'sqlserver' ? 'fa-database text-warning' : 'fa-database text-info';
            const sHdr = document.getElementById('cmp-source-hdr-title');
            const tHdr = document.getElementById('cmp-target-hdr-title');
            if (sHdr) sHdr.innerHTML = `<i class="fa-solid ${sIcon} me-1"></i> ${sTitle}`;
            if (tHdr) tHdr.innerHTML = `<i class="fa-solid ${tIcon} me-1"></i> ${tTitle}`;

            if (typeof filter.sql_text === 'string' && filter.sql_text.trim()) {
                setSourceSql(filter.sql_text);
                setTimeout(() => {
                    triggerAnalyze();
                }, 140);
            }
        } else if (filter.view === 'reference' || filter.query || filter.database) {
            switchTab('reference');
            if (filter.scope) {
                const pill = document.querySelector(`.syntax-ref-pill[data-scope="${filter.scope}"]`);
                if (pill) {
                    document.querySelectorAll('.syntax-ref-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    currentScopeFilter = filter.scope;
                }
            } else if (filter.database) {
                const pill = document.querySelector(`.syntax-ref-pill[data-scope="${filter.database}"]`);
                if (pill) {
                    document.querySelectorAll('.syntax-ref-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    currentScopeFilter = filter.database;
                }
            }
            if (filter.category) {
                const catSel = document.getElementById('win-syntax-category');
                if (catSel) {
                    catSel.value = filter.category;
                    currentCategoryFilter = filter.category;
                }
            }
            if (typeof filter.query === 'string' && filter.query.trim()) {
                const searchInput = document.getElementById('win-syntax-search');
                if (searchInput) {
                    searchInput.value = filter.query.trim();
                    currentSearchTerm = filter.query.trim();
                }
            }
            loadCatalog();
        }
    }

    async function checkAndApplyInitialContext() {
        try {
            const api = await waitForBridge();
            if (api && typeof api.get_initial_filter === 'function') {
                const filter = await api.get_initial_filter();
                if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
                    applyInitialContext(filter);
                }
            }
        } catch (e) {
            console.warn('[SyntaxReference] Error loading initial filter:', e);
        }
    }

    // Expose for desktop subwindow evaluate_js
    window.applyInitialContext = applyInitialContext;

    // ── Bootstrap Initialization ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        initTabNavigation();
        initFilterControls();
        initCompareView();
        loadCatalog();
        initMonacoEditors();
        checkAndApplyInitialContext();
    });

})();
