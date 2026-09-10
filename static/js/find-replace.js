// Find and Replace Logic (SSMS-like)

(function () {
    let dialog, toggleBtn, toggleIcon, replaceContainer;
    let findInput, replaceInput, findNextBtn, findPrevBtn;
    let replaceBtn, replaceAllBtn, scopeSelect, closeBtn, statusText;

    let currentCursor = null; // CodeMirror search cursor
    let lastQuery = null;

    document.addEventListener('DOMContentLoaded', () => {
        dialog = document.getElementById('ide-find-replace-dialog');
        if (!dialog) return;

        toggleBtn = document.getElementById('fr-toggle-btn');
        toggleIcon = document.getElementById('fr-toggle-icon');
        replaceContainer = document.getElementById('fr-replace-container');
        findInput = document.getElementById('fr-find-input');
        replaceInput = document.getElementById('fr-replace-input');
        findNextBtn = document.getElementById('fr-find-next-btn');
        findPrevBtn = document.getElementById('fr-find-prev-btn');
        replaceBtn = document.getElementById('fr-replace-btn');
        replaceAllBtn = document.getElementById('fr-replace-all-btn');
        scopeSelect = document.getElementById('fr-scope-select');
        closeBtn = document.getElementById('fr-close-btn');
        statusText = document.getElementById('fr-status-text');

        // Toggle Replace UI
        toggleBtn.addEventListener('click', () => {
            const isHidden = replaceContainer.classList.contains('d-none');
            if (isHidden) {
                replaceContainer.classList.remove('d-none');
                toggleIcon.classList.remove('fa-chevron-right');
                toggleIcon.classList.add('fa-chevron-down');
            } else {
                replaceContainer.classList.add('d-none');
                toggleIcon.classList.remove('fa-chevron-down');
                toggleIcon.classList.add('fa-chevron-right');
            }
        });

        // Close Dialog
        closeBtn.addEventListener('click', hide);

        // Escape to close
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hide();
        });

        // Enter in Find triggers Find Next
        findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                findNext(e.shiftKey); // Shift+Enter = Find Prev
            }
        });

        findNextBtn.addEventListener('click', () => findNext(false));
        findPrevBtn.addEventListener('click', () => findNext(true));

        replaceBtn.addEventListener('click', replaceCurrent);
        replaceAllBtn.addEventListener('click', replaceAll);

        // Global shortcuts for F3 and Alt+... (will be handled if dialog is focused)
        // If not focused, CodeMirror extraKeys could handle F3.
    });

    function show() {
        if (!dialog) return;
        dialog.classList.remove('d-none');

        // Auto-fill from selection if available
        const cm = window.AppEditor;
        if (cm && cm.somethingSelected()) {
            const selectedText = cm.getSelection();
            if (selectedText.indexOf('\n') === -1) {
                findInput.value = selectedText;
            }
        }

        findInput.focus();
        findInput.select();
        setStatus('');
        currentCursor = null;
    }

    function hide() {
        if (!dialog) return;
        dialog.classList.add('d-none');
        if (window.AppEditor) window.AppEditor.focus();
    }

    function setStatus(msg, isError = false) {
        statusText.textContent = msg;
        statusText.className = isError ? 'text-danger small' : 'text-muted small';
    }

    function clearHighlight(cm) {
        // Optional: clear previous search highlights if implemented
    }

    function findNext(reverse = false) {
        const query = findInput.value;
        if (!query) return;

        const scope = scopeSelect.value; // 'current' or 'all'

        // Setup Search Cursor if query changed or cursor missing
        if (!currentCursor || query !== lastQuery) {
            const cm = window.AppEditor;
            if (!cm) return;
            currentCursor = cm.getSearchCursor(query, cm.getCursor(), true); // case insensitive
            lastQuery = query;
        }

        let found = reverse ? currentCursor.findPrevious() : currentCursor.findNext();
        const cm = window.AppEditor;

        if (found) {
            cm.setSelection(currentCursor.from(), currentCursor.to());
            cm.scrollIntoView({ from: currentCursor.from(), to: currentCursor.to() }, 20);
            setStatus('');
        } else {
            // Wrap around or Search across tabs
            if (scope === 'all') {
                const nextTabId = findInNextTab(query, reverse);
                if (nextTabId) {
                    window.AppTabs.switchTab(nextTabId);
                    setTimeout(() => {
                        // After switching tab, active editor changed
                        const newCm = window.AppEditor;
                        // Start search from beginning/end of the new file
                        const startPos = reverse ? CodeMirror.Pos(newCm.lastLine()) : CodeMirror.Pos(newCm.firstLine(), 0);
                        currentCursor = newCm.getSearchCursor(query, startPos, true);
                        if (reverse ? currentCursor.findPrevious() : currentCursor.findNext()) {
                            newCm.setSelection(currentCursor.from(), currentCursor.to());
                            newCm.scrollIntoView({ from: currentCursor.from(), to: currentCursor.to() }, 20);
                        }
                    }, 50);
                    setStatus('Switched tab to find match.');
                    return;
                }
            }

            // Just wrap around the current document
            currentCursor = cm.getSearchCursor(query, reverse ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0), true);
            if (reverse ? currentCursor.findPrevious() : currentCursor.findNext()) {
                cm.setSelection(currentCursor.from(), currentCursor.to());
                cm.scrollIntoView({ from: currentCursor.from(), to: currentCursor.to() }, 20);
                setStatus('Wrapped around document.');
            } else {
                setStatus('No matches found.', true);
            }
        }
    }

    function findInNextTab(query, reverse) {
        if (!window.AppTabs || !window.AppTabs.getAllTabs) return null;

        const activeTabId = window.AppTabs.getActiveTabId();
        const tabsMap = window.AppTabs.getAllTabs();
        const tabKeys = Array.from(tabsMap.keys());

        if (tabKeys.length <= 1) return null; // No other tabs

        let currentIndex = tabKeys.indexOf(activeTabId);
        if (currentIndex === -1) return null;

        // Check remaining tabs in order
        let checkCount = 0;
        let idx = currentIndex;
        const qLower = query.toLowerCase();

        while (checkCount < tabKeys.length - 1) {
            idx = reverse ? (idx - 1 + tabKeys.length) % tabKeys.length : (idx + 1) % tabKeys.length;
            const tabId = tabKeys[idx];
            const state = tabsMap.get(tabId);

            if (state && state.tabType === 'query') {
                const content = (state.content || '').toLowerCase();
                if (content.indexOf(qLower) !== -1) {
                    return tabId;
                }
            }
            checkCount++;
        }
        return null;
    }

    function replaceCurrent() {
        if (!currentCursor) {
            findNext(false);
            return;
        }

        const cm = window.AppEditor;
        const replacement = replaceInput.value;
        const query = findInput.value;
        if (!query) return;

        // Check if currently selected text matches the search query
        const selection = cm.getSelection();
        if (selection.toLowerCase() === query.toLowerCase() && currentCursor.from()) {
            currentCursor.replace(replacement);
            // Move to next automatically
            findNext(false);
        } else {
            // Find first, then next click will replace
            findNext(false);
        }
    }

    function replaceAll() {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;

        const scope = scopeSelect.value;
        let count = 0;

        if (scope === 'current') {
            const cm = window.AppEditor;
            cm.operation(() => {
                const cursor = cm.getSearchCursor(query, CodeMirror.Pos(cm.firstLine(), 0), true);
                while (cursor.findNext()) {
                    cursor.replace(replacement);
                    count++;
                }
            });
            setStatus(`Replaced ${count} occurrences.`);
        } else if (scope === 'all') {
            if (!window.AppTabs) return;
            const tabsMap = window.AppTabs.getAllTabs();

            // Case-insensitive regex with global flag
            const regex = new RegExp(escapeRegExp(query), 'gi');

            tabsMap.forEach((state, tabId) => {
                if (state.tabType === 'query') {
                    // Update active editor explicitly if it's the current tab
                    if (tabId === window.AppTabs.getActiveTabId() && window.AppEditor) {
                        const cm = window.AppEditor;
                        cm.operation(() => {
                            const cursor = cm.getSearchCursor(query, CodeMirror.Pos(cm.firstLine(), 0), true);
                            while (cursor.findNext()) {
                                cursor.replace(replacement);
                                count++;
                            }
                        });
                    } else {
                        // Replace in background tab content
                        let content = state.content || '';
                        let matchCount = (content.match(regex) || []).length;
                        if (matchCount > 0) {
                            state.content = content.replace(regex, replacement);
                            window.AppTabs.setTabDirty(tabId, true);
                            count += matchCount;
                        }
                    }
                }
            });
            setStatus(`Replaced ${count} occurrences across all tabs.`);
        }
        currentCursor = null; // reset search state
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    // Export API
    window.AppFindReplace = {
        show,
        hide
    };

})();
