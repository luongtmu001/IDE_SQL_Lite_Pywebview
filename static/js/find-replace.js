// Find and Replace Logic — Monaco Native Integration

(function () {
    function getActiveMonacoEditor() {
        if (window.AppEditor) {
            if (typeof window.AppEditor.getMonacoInstance === 'function') {
                return window.AppEditor.getMonacoInstance();
            }
            if (window.AppEditor.rawEditor) {
                return window.AppEditor.rawEditor;
            }
        }
        return null;
    }

    function show(isReplace = false) {
        const ed = getActiveMonacoEditor();
        if (!ed) return;
        ed.focus();
        const actionId = isReplace ? 'editor.action.startFindReplaceAction' : 'actions.find';
        const action = ed.getAction(actionId);
        if (action) {
            action.run();
        } else {
            ed.trigger('keyboard', actionId, {});
        }
    }

    function hide() {
        const ed = getActiveMonacoEditor();
        if (!ed) return;
        const action = ed.getAction('closeFindWidget');
        if (action) action.run();
    }

    window.AppFindReplace = { show, hide };
})();
