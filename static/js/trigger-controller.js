/**
 * trigger-controller.js - IntelliSense Keyboard Trigger & Lifecycle Controller
 * 
 * Implements the architecture specified in .SKILL/INTELLISENSE_KEYBOARD_TRIGGER_PLAN.md:
 * - Keyboard Event Layer & Input Classification (Section 5, 6, 7, 11-20)
 * - Completion State Machine: IDLE, OPENING, VISIBLE, REFRESHING, NAVIGATING, ACCEPTING (Section 10)
 * - Separate Decision Logic from UI / CodeMirror Event Handlers (Section 2, 5, 43, 52)
 * - Distinction between Explicit Trigger, Character Trigger, Refresh, and Close (Section 8, 9, 26)
 * - Comment & String Literal Protection (Section 20, 21, 22)
 * - Double Trigger Prevention (Section 29)
 * - Cursor Movement & Selection Change Control (Section 33, 34)
 * - Paste, Cut, Undo, Redo Handling (Section 35, 36, 37)
 * - Debug Timeline & Performance Metrics (Section 27, 28, 48)
 */

(function (window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. COMPLETION STATE MACHINE ENUM (Section 10)
    // ─────────────────────────────────────────────────────────────────────────────
    const CompletionState = Object.freeze({
        IDLE: 'IDLE',
        OPENING: 'OPENING',
        VISIBLE: 'VISIBLE',
        REFRESHING: 'REFRESHING',
        NAVIGATING: 'NAVIGATING',
        ACCEPTING: 'ACCEPTING'
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. KEYBOARD INPUT CATEGORIES (Section 5, 6)
    // ─────────────────────────────────────────────────────────────────────────────
    const KeyCategory = Object.freeze({
        TRIGGER_EXPLICIT: 'TRIGGER_EXPLICIT',   // Ctrl + Space
        TRIGGER_CHAR: 'TRIGGER_CHAR',           // '.', '@'
        ACTION_NAVIGATE: 'ACTION_NAVIGATE',     // ArrowUp, ArrowDown, PageUp, PageDown
        ACTION_ACCEPT: 'ACTION_ACCEPT',         // Enter, Tab
        ACTION_CLOSE: 'ACTION_CLOSE',           // Escape
        ACTION_BACKSPACE: 'ACTION_BACKSPACE',   // Backspace
        ACTION_DELETE: 'ACTION_DELETE',         // Delete
        ACTION_TYPING: 'ACTION_TYPING',         // Alphanumeric, '_', '#', '$'
        ACTION_DELIMITER: 'ACTION_DELIMITER',   // Space, comma, parens, semicolon, operators
        ACTION_IGNORE: 'ACTION_IGNORE'          // Modifiers, ArrowLeft/Right, Home/End, F-keys
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. STANDARDIZED DECISION ACTIONS (Section 44)
    // ─────────────────────────────────────────────────────────────────────────────
    const DecisionAction = Object.freeze({
        NONE: 'none',
        TRIGGER: 'trigger',
        REFRESH: 'refresh',
        CLOSE: 'close',
        ACCEPT: 'accept',
        NAVIGATE: 'navigate'
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. FUNCTIONAL HELPERS (Section 5)
    // ─────────────────────────────────────────────────────────────────────────────
    function classifyKeyEvent(e) {
        if (!e) return { category: KeyCategory.ACTION_IGNORE, key: '' };

        const key = e.key || '';
        const code = e.code || '';
        const isCtrl = Boolean(e.ctrlKey || e.metaKey);
        const isAlt = Boolean(e.altKey);
        const isShift = Boolean(e.shiftKey);

        // 1. Explicit Trigger: Ctrl+Space (or Meta+Space)
        if (isCtrl && !isAlt && (code === 'Space' || key === ' ' || key === 'Spacebar')) {
            return { category: KeyCategory.TRIGGER_EXPLICIT, key: 'Ctrl+Space' };
        }

        // 2. Modifiers alone
        if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(key) && !isCtrl && !isAlt) {
            if (key === 'Tab') return { category: KeyCategory.ACTION_ACCEPT, key: 'Tab' };
            return { category: KeyCategory.ACTION_IGNORE, key };
        }

        // 3. Modifier combinations to ignore for IntelliSense (e.g. Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+A)
        if (isCtrl || isAlt) {
            return { category: KeyCategory.ACTION_IGNORE, key };
        }

        // 4. Navigation Keys
        if (key === 'ArrowDown') return { category: KeyCategory.ACTION_NAVIGATE, key, step: 1 };
        if (key === 'ArrowUp') return { category: KeyCategory.ACTION_NAVIGATE, key, step: -1 };
        if (key === 'PageDown') return { category: KeyCategory.ACTION_NAVIGATE, key, step: 8 };
        if (key === 'PageUp') return { category: KeyCategory.ACTION_NAVIGATE, key, step: -8 };

        // 5. Accept & Close
        if (key === 'Enter') return { category: KeyCategory.ACTION_ACCEPT, key };
        if (key === 'Escape') return { category: KeyCategory.ACTION_CLOSE, key };

        // 6. Edits
        if (key === 'Backspace') return { category: KeyCategory.ACTION_BACKSPACE, key };
        if (key === 'Delete') return { category: KeyCategory.ACTION_DELETE, key };

        // 7. Character Triggers: '.', '@', '#', '[', '"', '`'
        if (key === '.' || key === '@' || key === '#' || key === '[' || key === '"' || key === '`') return { category: KeyCategory.TRIGGER_CHAR, key };

        // 8. Delimiters
        if (key === ' ' || key === 'Spacebar') return { category: KeyCategory.ACTION_DELIMITER, key: ' ' };
        if ([',', '(', ')', ';', ']', '{', '}', '=', '+', '-', '*', '/', '<', '>', '!', '%', '&', '|', '^', '~'].includes(key)) {
            return { category: KeyCategory.ACTION_DELIMITER, key };
        }

        // 9. Typing characters (identifiers)
        if (key.length === 1 && /^[\w$#]$/i.test(key)) {
            return { category: KeyCategory.ACTION_TYPING, key };
        }

        // 10. Horizontal arrows, Home, End, F-keys, etc.
        return { category: KeyCategory.ACTION_IGNORE, key };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4b. EARLY OBJECT SUGGESTION TRIGGER DETECTOR (SQL Prompt Style)
    // ─────────────────────────────────────────────────────────────────────────────
    function isPostKeywordObjectTrigger(context) {
        if (!context) return null;

        // 1. Follow-up keywords (e.g. 'CREATE OR ', 'ALTER ', 'DROP ', 'GROUP ', 'ORDER ')
        // Note: Do NOT trigger followup_space on BEGIN inside routine bodies
        if (context.hasFollowUp && !(context.previousToken === 'BEGIN' && context.isInRoutineBody)) {
            return { kind: 'keyword', reason: 'followup_space' };
        }

        const prevTokenUpper = (context.previousToken || '').toUpperCase();

        // 2. ALTER / DROP / CREATE OR ALTER object keyword (e.g. 'ALTER PROCEDURE ', 'ALTER FUNCTION ', 'DROP TABLE ')
        if (context.isAlterContext && context.alterObjectType) {
            const validObjectWords = ['PROCEDURE', 'PROC', 'FUNCTION', 'FUNC', 'TABLE', 'VIEW', 'TRIGGER'];
            if (validObjectWords.includes(prevTokenUpper)) {
                return { kind: context.alterObjectType, reason: 'alter_object_space' };
            }
        }

        // 3. EXEC / EXECUTE keyword (e.g. 'EXEC ')
        if (context.execContext && context.execContext.isExec && !context.execContext.procedureName) {
            if (prevTokenUpper === 'EXEC' || prevTokenUpper === 'EXECUTE') {
                return { kind: 'procedure', reason: 'exec_space' };
            }
        }

        // 4. FROM / JOIN / INSERT INTO (e.g. 'FROM ', 'JOIN ', 'INSERT INTO ')
        // Must strictly immediately follow the keyword (NOT after a table name or on a new line)
        if (['FROM', 'JOIN', 'INTO'].includes(prevTokenUpper)) {
            return { kind: 'table', reason: 'from_join_space' };
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. INTELLISENSE TRIGGER CONTROLLER (Section 5, 10, 52)
    // ─────────────────────────────────────────────────────────────────────────────
    class IntelliSenseTriggerController {
        constructor() {
            this.state = CompletionState.IDLE;
            this.activeToken = null;
            this.activeCandidates = null;
            this.justDismissedByEscape = false;
            this._escapeTimer = null;

            // Debug Metrics (Section 48)
            this.metrics = {
                triggers: 0,
                refreshes: 0,
                closes: 0,
                navigates: 0,
                accepts: 0,
                ignored: 0
            };

            // Debug History Ring Buffer (Section 28)
            this.history = [];
            this.maxHistorySize = 50;
        }

        getState() {
            return this.state;
        }

        setState(newState, reason = '') {
            const oldState = this.state;
            this.state = newState;
            this.recordEvent({
                type: 'STATE_CHANGE',
                from: oldState,
                to: newState,
                reason: reason
            });
        }

        isSessionActive() {
            return this.state === CompletionState.VISIBLE ||
                   this.state === CompletionState.REFRESHING ||
                   this.state === CompletionState.NAVIGATING;
        }

        setDismissedByEscape() {
            this.justDismissedByEscape = true;
            if (this._escapeTimer) clearTimeout(this._escapeTimer);
            this._escapeTimer = setTimeout(() => {
                this.justDismissedByEscape = false;
                this._escapeTimer = null;
            }, 300);
        }

        clearDismissedByEscape() {
            this.justDismissedByEscape = false;
            if (this._escapeTimer) {
                clearTimeout(this._escapeTimer);
                this._escapeTimer = null;
            }
        }

        setActiveCandidates(candidates) {
            this.activeCandidates = Array.isArray(candidates) ? [...candidates] : null;
        }

        getActiveCandidates() {
            return this.activeCandidates;
        }

        clearActiveCandidates() {
            this.activeCandidates = null;
        }

        setActiveToken(tokenInfo) {
            this.activeToken = tokenInfo ? { ...tokenInfo } : null;
        }

        getActiveToken() {
            return this.activeToken;
        }

        clearActiveToken() {
            this.activeToken = null;
        }

        classifyKey(event) {
            return classifyKeyEvent(event);
        }

        /**
         * KeyDown Decision Layer (Sections 11-13, 29)
         * Evaluates whether to intercept keydown before CodeMirror mutates text.
         */
        decideKeyDown(event, isVisible, hasSelection = false) {
            const classified = this.classifyKey(event);
            const key = classified.key;

            this.recordEvent({
                type: 'KEYDOWN',
                key: key,
                category: classified.category,
                state: this.state,
                isVisible: isVisible,
                hasSelection: hasSelection
            });

            // Rule 1: Text Selection Active (Section 34)
            if (hasSelection && classified.category !== KeyCategory.TRIGGER_EXPLICIT) {
                if (isVisible && classified.category === KeyCategory.ACTION_CLOSE) {
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'escape_selection');
                    return { action: DecisionAction.CLOSE, reason: 'escape' };
                }
                this.metrics.ignored++;
                return { action: DecisionAction.NONE, reason: 'selection' };
            }

            // Rule 2: Explicit Trigger (Ctrl+Space) (Section 6)
            if (classified.category === KeyCategory.TRIGGER_EXPLICIT) {
                this.metrics.triggers++;
                this.setState(CompletionState.OPENING, 'explicit');
                return {
                    action: DecisionAction.TRIGGER,
                    reason: 'explicit',
                    kind: 'all'
                };
            }

            // Rule 3: Close via Escape (Section 13)
            if (classified.category === KeyCategory.ACTION_CLOSE) {
                if (isVisible) {
                    this.metrics.closes++;
                    this.setDismissedByEscape();
                    this.setState(CompletionState.IDLE, 'escape');
                    return { action: DecisionAction.CLOSE, reason: 'escape' };
                }
                return { action: DecisionAction.NONE, reason: 'ignored' };
            }

            // Rule 4: Accept via Enter / Tab (Section 12)
            if (classified.category === KeyCategory.ACTION_ACCEPT) {
                if (isVisible) {
                    this.metrics.accepts++;
                    this.setState(CompletionState.ACCEPTING, 'accept');
                    return { action: DecisionAction.ACCEPT, reason: 'accept' };
                }
                return { action: DecisionAction.NONE, reason: 'newline' };
            }

            // Rule 5: Navigation via ArrowUp / ArrowDown / PageUp / PageDown (Section 11)
            if (classified.category === KeyCategory.ACTION_NAVIGATE) {
                if (isVisible) {
                    this.metrics.navigates++;
                    this.setState(CompletionState.NAVIGATING, 'navigate');
                    return {
                        action: DecisionAction.NAVIGATE,
                        reason: 'navigate',
                        step: classified.step || 1
                    };
                }
                return { action: DecisionAction.NONE, reason: 'cursor_nav' };
            }

            // For all regular typing, backspace, delete, delimiters:
            // Propagate to editor first; evaluate resulting context during 'change' event!
            return { action: DecisionAction.NONE, reason: 'propagate_to_editor' };
        }

        /**
         * Change Decision Layer (Sections 7, 8, 9, 14-22, 35-37)
         * Evaluates buffer changes after text mutation has occurred.
         */
        decideChange(changeObj, context, isVisible, hasSelection = false) {
            const origin = (changeObj && changeObj.origin) || '';

            // Section 35, 36, 37: Paste, Cut, Undo, Redo, setValue must NEVER open autocomplete
            if (['setValue', 'paste', 'cut', 'undo', 'redo'].includes(origin)) {
                this.recordEvent({ type: 'CHANGE_IGNORED', origin, state: this.state });
                if (isVisible) {
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'change_origin_' + origin);
                    return { action: DecisionAction.CLOSE, reason: 'change_origin_' + origin };
                }
                return { action: DecisionAction.NONE, reason: 'change_origin_' + origin };
            }

            // Section 13: Temporary suppression after Escape
            if (this.justDismissedByEscape) {
                this.clearDismissedByEscape();
                return { action: DecisionAction.NONE, reason: 'suppressed_by_escape' };
            }

            // Section 34: Active selection prevents automatic trigger
            if (hasSelection) {
                if (isVisible) {
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'selection');
                    return { action: DecisionAction.CLOSE, reason: 'selection' };
                }
                return { action: DecisionAction.NONE, reason: 'selection' };
            }

            // Section 20, 21, 22: Inside comment or string literal -> strictly disabled
            if (context && (context.isInsideComment || context.isInsideString)) {
                this.recordEvent({ type: 'CHANGE_COMMENT_STRING', contextType: context.contextType });
                if (isVisible) {
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'comment_or_string');
                    return { action: DecisionAction.CLOSE, reason: 'comment_or_string' };
                }
                return { action: DecisionAction.NONE, reason: 'comment_or_string' };
            }

            const insertedText = (changeObj && Array.isArray(changeObj.text)) ? changeObj.text.join('\n') : '';
            const removedText = (changeObj && Array.isArray(changeObj.removed)) ? changeObj.removed.join('\n') : '';
            const isDeletion = removedText.length > 0 && insertedText.length === 0;
            const currentWord = (context && context.currentWord) || '';
            const triggerChar = (context && context.triggerChar) || '';

            // Section 12, 13: Newline insertion (Enter key in editor) must NEVER auto-trigger from idle!
            if (insertedText.includes('\n')) {
                if (isVisible) {
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'newline');
                    return { action: DecisionAction.CLOSE, reason: 'newline' };
                }
                return { action: DecisionAction.NONE, reason: 'newline' };
            }

            // ── Case A: Completion Popup is VISIBLE ──────────────────────────────
            if (isVisible) {
                if (isDeletion) {
                    // Section 14, 15: Backspace / Delete in active completion
                    if (!currentWord && triggerChar !== '.') {
                        this.metrics.closes++;
                        this.setState(CompletionState.IDLE, 'backspace_empty');
                        return { action: DecisionAction.CLOSE, reason: 'backspace_empty' };
                    }
                    if (triggerChar === '.' && removedText.includes('.')) {
                        this.metrics.closes++;
                        this.setState(CompletionState.IDLE, 'dot_deleted');
                        return { action: DecisionAction.CLOSE, reason: 'dot_deleted' };
                    }
                    // Token still exists: Refresh locally without querying DB! (Section 31)
                    this.metrics.refreshes++;
                    this.setState(CompletionState.REFRESHING, 'backspace');
                    return {
                        action: DecisionAction.REFRESH,
                        reason: 'backspace',
                        token: currentWord,
                        kind: context ? context.contextType : null
                    };
                }

                // If user typed a delimiter (e.g. Space, comma, paren, semicolon)
                if (insertedText === ' ' || [',', '(', ')', ';'].includes(insertedText)) {
                    if (insertedText === ' ') {
                        const eagerTrigger = isPostKeywordObjectTrigger(context);
                        if (eagerTrigger) {
                            this.metrics.triggers++;
                            this.setState(CompletionState.OPENING, eagerTrigger.reason);
                            return { action: DecisionAction.TRIGGER, reason: eagerTrigger.reason, kind: eagerTrigger.kind, token: '' };
                        }
                    }
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'delimiter');
                    return { action: DecisionAction.CLOSE, reason: 'delimiter' };
                }

                // Normal typing while completion is active -> REFRESH (Section 8, 9)
                this.metrics.refreshes++;
                this.setState(CompletionState.REFRESHING, 'typing');
                return {
                    action: DecisionAction.REFRESH,
                    reason: 'identifier',
                    token: currentWord,
                    kind: context ? context.contextType : null
                };
            }

            // ── Case B: Completion Popup is IDLE ─────────────────────────────────
            if (isDeletion) {
                // Section 14, 15: Backspace / Delete from idle NEVER triggers completion
                return { action: DecisionAction.NONE, reason: 'delete_idle' };
            }

            // Section 16 & Early Trigger: Space after specific object-demanding keywords triggers early suggestions (SQL Prompt style)
            if (insertedText === ' ') {
                const eagerTrigger = isPostKeywordObjectTrigger(context);
                if (eagerTrigger) {
                    this.metrics.triggers++;
                    this.setState(CompletionState.OPENING, eagerTrigger.reason);
                    return {
                        action: DecisionAction.TRIGGER,
                        reason: eagerTrigger.reason,
                        kind: eagerTrigger.kind,
                        token: ''
                    };
                }
                return { action: DecisionAction.NONE, reason: 'space_idle' };
            }

            // Section 7, 18: Character Trigger '.'
            if (insertedText === '.' || triggerChar === '.') {
                // Verify qualifier is a valid table/alias/schema (not a numeric decimal literal)
                if (context && context.qualifier && context.qualifier.length > 0) {
                    this.metrics.triggers++;
                    this.setState(CompletionState.OPENING, 'character_dot');
                    return {
                        action: DecisionAction.TRIGGER,
                        reason: 'character',
                        kind: 'column',
                        token: context.qualifier
                    };
                }
                return { action: DecisionAction.NONE, reason: 'invalid_dot' };
            }

            // Section 7: Character Trigger '@'
            if (insertedText === '@' || triggerChar === '@') {
                this.metrics.triggers++;
                this.setState(CompletionState.OPENING, 'character_at');
                return {
                    action: DecisionAction.TRIGGER,
                    reason: 'character',
                    kind: 'parameter',
                    token: currentWord
                };
            }

            // Section 7: Character Trigger '#' (Local temp tables in SQL Server)
            if (insertedText === '#' || triggerChar === '#' || currentWord === '#') {
                this.metrics.triggers++;
                this.setState(CompletionState.OPENING, 'character_hash');
                return {
                    action: DecisionAction.TRIGGER,
                    reason: 'character',
                    kind: 'temp_table',
                    token: currentWord
                };
            }

            // Section 4.1, 7: Character Trigger '[', '"', '`' (Quoted Identifier)
            if (insertedText === '[' || triggerChar === '[' || insertedText === '"' || triggerChar === '"' || insertedText === '`' || triggerChar === '`' || (context && context.isQuotedIdentifier)) {
                this.metrics.triggers++;
                this.setState(CompletionState.OPENING, 'character_quote');
                return {
                    action: DecisionAction.TRIGGER,
                    reason: 'character',
                    kind: context ? context.contextType : 'column',
                    token: currentWord
                };
            }

            // Section 8: Identifier typing in SQL Context or Snippet prefix
            if (currentWord.length >= 1) {
                // Check if current word matches a snippet prefix
                const hasSnippetMatch = Boolean(
                    window.AppSnippets &&
                    typeof window.AppSnippets.getSnippets === 'function' &&
                    (window.AppSnippets.getSnippets() || []).some(s => (s.prefix || '').toLowerCase().startsWith(currentWord.toLowerCase()))
                );

                // Must be in a valid SQL construct / clause OR matching a snippet prefix OR at start of statement
                const hasValidContext = Boolean(
                    hasSnippetMatch ||
                    (context && context.clause) ||
                    (context && context.hasFollowUp) ||
                    (context && context.isAlterContext) ||
                    (context && context.isInRoutineBody) ||
                    (context && context.execContext && context.execContext.isExec) ||
                    !context || !context.clause
                );

                if (hasValidContext) {
                    this.metrics.triggers++;
                    this.setState(CompletionState.OPENING, 'identifier');
                    const eager = isPostKeywordObjectTrigger(context);
                    return {
                        action: DecisionAction.TRIGGER,
                        reason: 'automatic',
                        kind: (eager && eager.kind) ? eager.kind : (hasSnippetMatch ? 'snippet' : (context ? context.contextType : 'keyword')),
                        token: currentWord
                    };
                }
            }

            return { action: DecisionAction.NONE, reason: 'no_context' };
        }

        /**
         * Cursor Activity Decision Layer (Section 33)
         * Closes popup if cursor leaves token boundaries. NEVER triggers from idle!
         */
        decideCursor(curOffset, curLine, isVisible) {
            if (!isVisible) {
                return { action: DecisionAction.NONE, reason: 'idle' };
            }

            if (this.activeToken) {
                // Line changed
                if (curLine !== undefined && this.activeToken.line !== undefined && curLine !== this.activeToken.line) {
                    this.metrics.closes++;
                    this.setState(CompletionState.IDLE, 'cursor_line_change');
                    return { action: DecisionAction.CLOSE, reason: 'cursor_leave' };
                }

                // Cursor moved significantly outside completion token
                if (this.activeToken.start !== undefined && this.activeToken.end !== undefined) {
                    if (curOffset < this.activeToken.start || curOffset > (this.activeToken.end + 5)) {
                        this.metrics.closes++;
                        this.setState(CompletionState.IDLE, 'cursor_outside_token');
                        return { action: DecisionAction.CLOSE, reason: 'cursor_leave' };
                    }
                }
            }

            return { action: DecisionAction.NONE, reason: 'cursor_within_token' };
        }

        /**
         * Standard Section 5 Decision Interface
         */
        shouldTrigger(eventOrChange, context, isVisible = false) {
            if (eventOrChange && (eventOrChange.key || eventOrChange.code)) {
                const d = this.decideKeyDown(eventOrChange, isVisible);
                return d.action === DecisionAction.TRIGGER;
            }
            const d = this.decideChange(eventOrChange, context, isVisible);
            return d.action === DecisionAction.TRIGGER;
        }

        shouldRefresh(changeObj, context, isVisible = true) {
            const d = this.decideChange(changeObj, context, isVisible);
            return d.action === DecisionAction.REFRESH;
        }

        shouldClose(eventOrChange, context, isVisible = true) {
            if (eventOrChange && (eventOrChange.key || eventOrChange.code)) {
                const d = this.decideKeyDown(eventOrChange, isVisible);
                return d.action === DecisionAction.CLOSE;
            }
            const d = this.decideChange(eventOrChange, context, isVisible);
            return d.action === DecisionAction.CLOSE;
        }

        decide(params = {}) {
            const { event, changeObj, cursorOffset, cursorLine, context, isVisible, hasSelection } = params;
            if (event) {
                return this.decideKeyDown(event, Boolean(isVisible), Boolean(hasSelection));
            }
            if (changeObj) {
                return this.decideChange(changeObj, context, Boolean(isVisible), Boolean(hasSelection));
            }
            if (cursorOffset !== undefined) {
                return this.decideCursor(cursorOffset, cursorLine, Boolean(isVisible));
            }
            return { action: DecisionAction.NONE, reason: 'no_input' };
        }

        recordEvent(record) {
            const entry = {
                timestamp: Date.now(),
                ...record
            };
            this.history.push(entry);
            if (this.history.length > this.maxHistorySize) {
                this.history.shift();
            }
        }

        getHistory() {
            return [...this.history];
        }

        getMetrics() {
            return { ...this.metrics };
        }

        resetMetrics() {
            this.metrics = {
                triggers: 0,
                refreshes: 0,
                closes: 0,
                navigates: 0,
                accepts: 0,
                ignored: 0
            };
            this.history = [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. PUBLIC EXPORTS & FUNCTIONAL COMPATIBILITY (Section 5, 50)
    // ─────────────────────────────────────────────────────────────────────────────
    const defaultTriggerController = new IntelliSenseTriggerController();

    window.CompletionState = CompletionState;
    window.KeyCategory = KeyCategory;
    window.DecisionAction = DecisionAction;
    window.IntelliSenseTriggerController = IntelliSenseTriggerController;
    window.TriggerController = IntelliSenseTriggerController;
    window.DefaultTriggerController = defaultTriggerController;

    // Helper functions compliant with Section 5 functional style
    window.classifyKeyEvent = classifyKeyEvent;
    window.isPostKeywordObjectTrigger = isPostKeywordObjectTrigger;
    window.shouldTriggerIntelliSense = function (event, context, isVisible) {
        const d = defaultTriggerController.decideKeyDown(event, isVisible);
        return d.action === DecisionAction.TRIGGER;
    };
    window.shouldRefreshIntelliSense = function (changeObj, context, isVisible) {
        const d = defaultTriggerController.decideChange(changeObj, context, isVisible);
        return d.action === DecisionAction.REFRESH;
    };
    window.shouldCloseIntelliSense = function (eventOrChange, context, isVisible) {
        if (eventOrChange && eventOrChange.key) {
            const d = defaultTriggerController.decideKeyDown(eventOrChange, isVisible);
            return d.action === DecisionAction.CLOSE;
        }
        const d = defaultTriggerController.decideChange(eventOrChange, context, isVisible);
        return d.action === DecisionAction.CLOSE;
    };
    window.decideCompletionAction = function (params) {
        return defaultTriggerController.decide(params);
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            CompletionState,
            KeyCategory,
            DecisionAction,
            IntelliSenseTriggerController,
            defaultTriggerController,
            classifyKeyEvent,
            isPostKeywordObjectTrigger,
            shouldTriggerIntelliSense: window.shouldTriggerIntelliSense,
            shouldRefreshIntelliSense: window.shouldRefreshIntelliSense,
            shouldCloseIntelliSense: window.shouldCloseIntelliSense,
            decideCompletionAction: window.decideCompletionAction
        };
    }

})(typeof window !== 'undefined' ? window : globalThis);
