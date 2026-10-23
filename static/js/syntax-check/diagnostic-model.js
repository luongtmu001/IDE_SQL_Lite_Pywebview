/**
 * Diagnostic Model for Monaco Editor SQL Syntax Check
 * Standardizes diagnostic format across SQL Server, PostgreSQL, and offline parsers.
 * Reference: .SKILL/sytax_check.md
 */

(function (window) {
    'use strict';

    class Diagnostic {
        constructor(opts = {}) {
            this.severity = opts.severity || 'error'; // 'error' | 'warning' | 'info'
            this.message = String(opts.message || 'Syntax error');
            this.code = opts.code || 'SQL_SYNTAX_ERROR';
            this.source = opts.source || 'syntax-check';
            this.startLine = Math.max(1, parseInt(opts.startLine || opts.line || 1, 10));
            this.startColumn = Math.max(1, parseInt(opts.startColumn || opts.column || opts.col || 1, 10));
            this.endLine = Math.max(this.startLine, parseInt(opts.endLine || this.startLine, 10));
            this.endColumn = Math.max(this.startColumn + 1, parseInt(opts.endColumn || (this.startColumn + 1), 10));
            this.token = opts.token || '';
        }

        toMonacoMarker(monacoInstance) {
            const m = monacoInstance || window.monaco || (typeof monaco !== 'undefined' ? monaco : null);
            if (!m || !m.MarkerSeverity) return null;

            let sev = m.MarkerSeverity.Error;
            if (this.severity === 'warning') sev = m.MarkerSeverity.Warning;
            else if (this.severity === 'info') sev = m.MarkerSeverity.Info;
            else if (this.severity === 'hint') sev = (m.MarkerSeverity.Hint !== undefined ? m.MarkerSeverity.Hint : m.MarkerSeverity.Info);

            return {
                severity: sev,
                message: this.message,
                startLineNumber: this.startLine,
                startColumn: this.startColumn,
                endLineNumber: this.endLine,
                endColumn: this.endColumn,
                source: this.source,
                code: this.code
            };
        }
    }

    window.SqlDiagnosticModel = {
        Diagnostic,
        createDiagnostic: (opts) => new Diagnostic(opts),
        toMonacoMarkers: (diagnostics, monacoInstance) => {
            const m = monacoInstance || window.monaco || (typeof monaco !== 'undefined' ? monaco : null);
            if (!m || !Array.isArray(diagnostics)) return [];
            return diagnostics
                .map(d => (d instanceof Diagnostic ? d : new Diagnostic(d)).toMonacoMarker(m))
                .filter(Boolean);
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
