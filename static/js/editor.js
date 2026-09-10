// Editor Initialization — CodeMirror

function initEditor() {
    const textarea = document.getElementById('sql-editor');

    if (typeof CodeMirror === 'undefined') {
        console.warn('CodeMirror not loaded!');
        return null;
    }

    const currentTheme = document.documentElement.getAttribute('data-bs-theme');
    const cmTheme = currentTheme === 'light' ? 'default' : 'darcula';

    const config = {
        mode:            'text/x-sql',
        theme:           cmTheme,
        lineNumbers:     true,
        matchBrackets:   true,
        autoCloseBrackets: true,
        indentUnit:      4,
        tabSize:         4,
        indentWithTabs:  false,
        lineWrapping:    false,
        viewportMargin:  Infinity,
        extraKeys: {
            'F5': () => { if (window.AppQuery) window.AppQuery.executeQuery(); },
            'Ctrl-E': () => { if (window.AppQuery) window.AppQuery.executeQuery(); },
            'Cmd-E': () => { if (window.AppQuery) window.AppQuery.executeQuery(); },
            'Ctrl-Enter': () => { if (window.AppQuery) window.AppQuery.executeQuery(); },
            'Cmd-Enter': () => { if (window.AppQuery) window.AppQuery.executeQuery(); },
            'Ctrl-F': () => { if (window.AppFindReplace) window.AppFindReplace.show(); },
            'Cmd-F': () => { if (window.AppFindReplace) window.AppFindReplace.show(); },
            'F12': () => { if (window.AppIntelliSense) window.AppIntelliSense.goToDefinition(); },
            'Ctrl-R': () => { if (window.toggleResultPanel) window.toggleResultPanel(); },
            'Cmd-R': () => { if (window.toggleResultPanel) window.toggleResultPanel(); }
        }
    };

    const cm = CodeMirror.fromTextArea(textarea, config);
    cm.setSize('100%', '100%');

    if (window.AppIntelliSense) {
        window.AppIntelliSense.attachEditor(cm);
    }
    setupEditorContextMenu(cm);

    let cm2 = null;

    window.addEventListener('resize', () => { 
        if (cm) cm.refresh(); 
        if (cm2) cm2.refresh();
    });

    // Sync theme when ThemeManager fires
    document.addEventListener('ide-theme-changed', e => {
        const t = e.detail.theme === 'light' ? 'default' : 'darcula';
        cm.setOption('theme', t);
        if (cm2) cm2.setOption('theme', t);
        setTimeout(() => {
            cm.refresh();
            if (cm2) cm2.refresh();
        }, 50);
    });

    // Split Editor API
    window.isEditorSplit = function() {
        const p2 = document.getElementById('editor-pane-2');
        return p2 ? !p2.classList.contains('d-none') : false;
    };

    window.splitEditor = function() {
        const p1 = document.getElementById('editor-pane-1');
        const p2 = document.getElementById('editor-pane-2');
        const resizer = document.getElementById('editor-resizer');
        if (!p1 || !p2 || !resizer) return;
        
        p1.style.width = '50%';
        p2.style.width = '50%';
        p2.classList.remove('d-none');
        resizer.classList.remove('d-none');

        if (!cm2) {
            const textarea2 = document.getElementById('sql-editor-2');
            if (textarea2) {
                cm2 = CodeMirror.fromTextArea(textarea2, config);
                cm2.setSize('100%', '100%');
                window.AppEditor2 = cm2;
                if (window.AppIntelliSense) {
                    window.AppIntelliSense.attachEditor(cm2);
                }
                setupEditorContextMenu(cm2);
            }
        }
        
        if (cm2 && cm) {
            cm2.setValue(cm.getValue());
        }

        setTimeout(() => {
            if (cm) cm.refresh();
            if (cm2) cm2.refresh();
        }, 30);
    };

    window.unsplitEditor = function() {
        const p1 = document.getElementById('editor-pane-1');
        const p2 = document.getElementById('editor-pane-2');
        const resizer = document.getElementById('editor-resizer');
        if (!p1 || !p2 || !resizer) return;
        
        p1.style.width = '100%';
        p2.classList.add('d-none');
        resizer.classList.add('d-none');
        setTimeout(() => {
            if (cm) cm.refresh();
        }, 30);
    };

    window.toggleSplitEditor = function() {
        if (window.isEditorSplit()) {
            window.unsplitEditor();
        } else {
            window.splitEditor();
        }
    };

    // Resizer Drag Logic
    const resizer = document.getElementById('editor-resizer');
    if (resizer) {
        let isDragging = false;
        resizer.addEventListener('mousedown', function(e) {
            isDragging = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            const container = document.querySelector('.ide-editor-wrap');
            if (!container) return;
            const containerRect = container.getBoundingClientRect();
            let newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            if (newWidth < 10) newWidth = 10;
            if (newWidth > 90) newWidth = 90;
            
            document.getElementById('editor-pane-1').style.width = newWidth + '%';
            document.getElementById('editor-pane-2').style.width = (100 - newWidth) + '%';
        });
        document.addEventListener('mouseup', function(e) {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (cm) cm.refresh();
                if (cm2) cm2.refresh();
            }
        });
    }

    function setupEditorContextMenu(editorInstance) {
        if (!editorInstance) return;
        const wrapper = editorInstance.getWrapperElement();
        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            document.getElementById('ide-editor-context-menu')?.remove();

            const menu = document.createElement('ul');
            menu.id = 'ide-editor-context-menu';
            menu.className = 'dropdown-menu shadow-sm show';
            menu.style.position = 'absolute';
            menu.style.display = 'block';
            menu.style.zIndex = '1080';
            menu.style.left = e.pageX + 'px';
            menu.style.top = e.pageY + 'px';

            menu.innerHTML = `
                <li><a class="dropdown-item" href="#" id="ctx-editor-run"><i class="fa-solid fa-play me-2 text-success"></i>Execute (F5)</a></li>
                <li><a class="dropdown-item" href="#" id="ctx-editor-goto"><i class="fa-solid fa-arrow-up-right-from-square me-2 text-info"></i>Go to Definition (F12)</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" id="ctx-editor-find"><i class="fa-solid fa-magnifying-glass me-2 text-primary"></i>Find & Replace (Ctrl+F)</a></li>
            `;

            document.body.appendChild(menu);

            const closeMenu = () => menu.remove();
            setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);

            menu.querySelector('#ctx-editor-run').addEventListener('click', (ev) => {
                ev.preventDefault();
                if (window.AppQuery) window.AppQuery.executeQuery();
            });
            menu.querySelector('#ctx-editor-goto').addEventListener('click', (ev) => {
                ev.preventDefault();
                if (window.AppIntelliSense) window.AppIntelliSense.goToDefinition();
            });
            menu.querySelector('#ctx-editor-find').addEventListener('click', (ev) => {
                ev.preventDefault();
                if (window.AppFindReplace) window.AppFindReplace.show();
            });
        });
    }

    return cm;
}
