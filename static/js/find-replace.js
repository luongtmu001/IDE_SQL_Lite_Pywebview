// Find and Replace Logic (SSMS-like) — Monaco Edition

(function () {
    let dialog, toggleBtn, toggleIcon, replaceContainer;
    let findInput, replaceInput, findNextBtn, findPrevBtn;
    let replaceBtn, replaceAllBtn, scopeSelect, closeBtn, statusText;

    // Search state
    let lastQuery = null;
    let lastMatches = [];
    let lastMatchIndex = -1;

    document.addEventListener("DOMContentLoaded", () => {
        dialog = document.getElementById("ide-find-replace-dialog");
        if (!dialog) return;

        toggleBtn = document.getElementById("fr-toggle-btn");
        toggleIcon = document.getElementById("fr-toggle-icon");
        replaceContainer = document.getElementById("fr-replace-container");
        findInput = document.getElementById("fr-find-input");
        replaceInput = document.getElementById("fr-replace-input");
        findNextBtn = document.getElementById("fr-find-next-btn");
        findPrevBtn = document.getElementById("fr-find-prev-btn");
        replaceBtn = document.getElementById("fr-replace-btn");
        replaceAllBtn = document.getElementById("fr-replace-all-btn");
        scopeSelect = document.getElementById("fr-scope-select");
        closeBtn = document.getElementById("fr-close-btn");
        statusText = document.getElementById("fr-status-text");

        // Toggle Replace UI
        toggleBtn.addEventListener("click", () => {
            const isHidden = replaceContainer.classList.contains("d-none");
            if (isHidden) {
                replaceContainer.classList.remove("d-none");
                toggleIcon.classList.replace("fa-chevron-right", "fa-chevron-down");
            } else {
                replaceContainer.classList.add("d-none");
                toggleIcon.classList.replace("fa-chevron-down", "fa-chevron-right");
            }
        });

        closeBtn.addEventListener("click", hide);
        dialog.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
        findInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); findNext(e.shiftKey); }
        });
        findNextBtn.addEventListener("click", () => findNext(false));
        findPrevBtn.addEventListener("click", () => findNext(true));
        replaceBtn.addEventListener("click", replaceCurrent);
        replaceAllBtn.addEventListener("click", replaceAll);
    });

    function show() {
        if (!dialog) return;
        dialog.classList.remove("d-none");
        const editor = window.AppEditor;
        if (editor) {
            const sel = editor.getModel().getValueInRange(editor.getSelection());
            if (sel && sel.indexOf("\n") === -1) findInput.value = sel;
        }
        findInput.focus();
        findInput.select();
        setStatus("");
        lastMatches = [];
        lastMatchIndex = -1;
    }

    function hide() {
        if (!dialog) return;
        dialog.classList.add("d-none");
        // Clear search decorations
        if (window.AppEditor) {
            window.AppEditor.setSelection(new monaco.Selection(1,1,1,1));
            window.AppEditor.focus();
        }
    }

    function setStatus(msg, isError = false) {
        if (statusText) {
            statusText.textContent = msg;
            statusText.className = isError ? "text-danger small" : "text-muted small";
        }
    }

    function getMatches(model, query) {
        if (!query) return [];
        // findMatches(searchStr, searchOnlyEditableRange, isRegex, matchCase, wordSep, captureMatches, limitResultCount)
        return model.findMatches(query, false, false, false, null, false, 9999);
    }

    function findNext(reverse = false) {
        const query = findInput.value;
        if (!query) return;
        const editor = window.AppEditor;
        if (!editor) return;
        const model = editor.getModel();

        if (query !== lastQuery) {
            lastQuery = query;
            lastMatches = getMatches(model, query);
            lastMatchIndex = -1;
        }

        if (!lastMatches.length) {
            setStatus("No matches found.", true);
            return;
        }

        if (reverse) {
            lastMatchIndex = (lastMatchIndex <= 0) ? lastMatches.length - 1 : lastMatchIndex - 1;
        } else {
            lastMatchIndex = (lastMatchIndex >= lastMatches.length - 1) ? 0 : lastMatchIndex + 1;
        }

        const match = lastMatches[lastMatchIndex];
        editor.setSelection(match.range);
        editor.revealRangeInCenter(match.range);
        setStatus(`Match ${lastMatchIndex + 1} of ${lastMatches.length}`);

        // Check scope=all and wrap across tabs
        if (lastMatchIndex === 0 && !reverse) {
            setStatus(`Wrapped. Match 1 of ${lastMatches.length}`);
        }
    }

    function replaceCurrent() {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;
        const editor = window.AppEditor;
        if (!editor) return;
        const model = editor.getModel();

        // If current selection matches query, replace it
        const sel = editor.getSelection();
        const selText = model.getValueInRange(sel);
        if (selText.toLowerCase() === query.toLowerCase()) {
            editor.executeEdits("find-replace", [{
                range: sel,
                text: replacement
            }]);
            // Find next
            lastMatches = getMatches(model, query);
            lastMatchIndex = -1;
            findNext(false);
        } else {
            findNext(false);
        }
    }

    function replaceAll() {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;

        const scope = scopeSelect ? scopeSelect.value : "current";
        let count = 0;

        if (scope === "current") {
            const editor = window.AppEditor;
            if (!editor) return;
            const model = editor.getModel();
            const matches = getMatches(model, query);
            if (!matches.length) { setStatus("No matches found.", true); return; }
            const edits = matches.map(m => ({ range: m.range, text: replacement }));
            editor.executeEdits("replace-all", edits);
            count = matches.length;
            setStatus(`Replaced ${count} occurrences.`);
        } else if (scope === "all") {
            if (!window.AppTabs) return;
            const tabsMap = window.AppTabs.getAllTabs();
            const activeTabId = window.AppTabs.getActiveTabId();
            const regex = new RegExp(escapeRegExp(query), "gi");

            tabsMap.forEach((state, tabId) => {
                if (state.tabType === "query") {
                    if (tabId === activeTabId && window.AppEditor) {
                        const model = window.AppEditor.getModel();
                        const matches = getMatches(model, query);
                        if (matches.length) {
                            window.AppEditor.executeEdits("replace-all", matches.map(m => ({ range: m.range, text: replacement })));
                            count += matches.length;
                        }
                    } else {
                        const content = state.content || "";
                        const matchCount = (content.match(regex) || []).length;
                        if (matchCount > 0) {
                            state.content = content.replace(regex, replacement);
                            if (window.AppTabs.setTabDirty) window.AppTabs.setTabDirty(tabId, true);
                            count += matchCount;
                        }
                    }
                }
            });
            setStatus(`Replaced ${count} occurrences across all tabs.`);
        }
        lastMatches = [];
        lastMatchIndex = -1;
    }

    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    window.AppFindReplace = { show, hide };
})();
