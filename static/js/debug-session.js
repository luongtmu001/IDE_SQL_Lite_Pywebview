/**
 * Debug Session & Trace Model for Web IDE
 * Manages Debug Session lifecycle, source trace mappings, and runtime trace events
 * Reference: .SKILL/custom_function_debug.md (Section 7, 8, 9, 18, 19, 21, 22)
 */

(function (window) {
    'use strict';

    class DebugSession {
        constructor(opts = {}) {
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
            const randSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();

            this.debugSessionId = opts.debugSessionId || `DBG_${dateStr}_${randSuffix}`;
            this.mode = 'debug';
            this.connectionId = opts.connectionId || null;
            this.connectionName = opts.connectionName || null;
            this.database = opts.database || null;
            this.schema = opts.schema || null;
            this.startedAt = now;
            this.completedAt = null;

            // Source trace definitions: Map<sourceTraceId, TraceDefinition>
            this.traces = new Map();
            if (Array.isArray(opts.traces)) {
                opts.traces.forEach(t => {
                    if (t && t.sourceTraceId) {
                        this.traces.set(t.sourceTraceId, t);
                    }
                });
            }

            // Runtime events collected during execution
            this.events = [];
            this.runtimeOrderCounter = 0;
            this.iterationCounters = new Map(); // sourceTraceId -> count
        }

        /**
         * Register or update a trace definition from source code
         */
        registerTraceDefinition(traceDef) {
            if (!traceDef || !traceDef.sourceTraceId) return;
            this.traces.set(traceDef.sourceTraceId, traceDef);
        }

        /**
         * Record a runtime trace event emitted by PostgreSQL
         */
        recordEvent(rawEvent) {
            this.runtimeOrderCounter++;
            const sourceTraceId = rawEvent.trace_id || rawEvent.sourceTraceId || `trace_${this.runtimeOrderCounter}`;

            const currentIter = (this.iterationCounters.get(sourceTraceId) || 0) + 1;
            this.iterationCounters.set(sourceTraceId, currentIter);

            const sourceDef = this.traces.get(sourceTraceId);

            const eventObj = {
                debugSessionId: this.debugSessionId,
                runtimeOrder: this.runtimeOrderCounter,
                iteration: rawEvent.iteration !== undefined ? rawEvent.iteration : currentIter,
                sourceTraceId: sourceTraceId,
                callDepth: rawEvent.call_depth || rawEvent.callDepth || 1,
                functionName: rawEvent.function_name || rawEvent.functionName || (sourceDef ? sourceDef.functionName : ''),
                sourceLocation: sourceDef ? {
                    startLine: sourceDef.startLine,
                    startCol: sourceDef.startCol,
                    endLine: sourceDef.endLine,
                    endCol: sourceDef.endCol,
                    rawText: sourceDef.rawText,
                    innerContent: sourceDef.innerContent
                } : (rawEvent.sourceLocation || null),
                data: rawEvent.data !== undefined ? rawEvent.data : (rawEvent.rows || []),
                columns: rawEvent.columns || [],
                rowCount: rawEvent.row_count !== undefined ? rawEvent.row_count : (Array.isArray(rawEvent.data) ? rawEvent.data.length : 0),
                loggedAt: rawEvent.logged_at || new Date().toISOString()
            };

            this.events.push(eventObj);
            return eventObj;
        }

        /**
         * Get all events sorted by actual execution runtime order
         */
        getEvents() {
            return [...this.events].sort((a, b) => a.runtimeOrder - b.runtimeOrder);
        }

        complete() {
            this.completedAt = new Date();
        }
    }

    let _currentSession = null;

    window.DebugSessionManager = {
        createSession(opts = {}) {
            _currentSession = new DebugSession(opts);
            return _currentSession;
        },

        getCurrentSession() {
            return _currentSession;
        },

        clearCurrentSession() {
            if (_currentSession) {
                _currentSession.complete();
            }
            _currentSession = null;
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
