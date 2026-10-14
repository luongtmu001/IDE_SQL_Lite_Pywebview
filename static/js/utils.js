/**
 * Shared utility functions for luoBTool IDE Frontend.
 * Supports both standard browser global scope (window.escapeHtml)
 * and CommonJS / ES module environments.
 */
(function (global) {
    'use strict';

    /**
     * Sanitizes untrusted text to prevent XSS when inserted into HTML contexts.
     * Replaces &, <, >, ", and ' with their safe HTML entity representations.
     * Null or undefined values are safely converted to an empty string.
     *
     * @param {any} value - The input value to escape.
     * @returns {string} Safe HTML escaped string.
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).replace(/[&<>"']/g, function (char) {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#039;';
                default: return char;
            }
        });
    }

    // Attach to global window / globalThis
    if (typeof window !== 'undefined') {
        window.escapeHtml = escapeHtml;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.escapeHtml = escapeHtml;
    }
    if (global && typeof global === 'object') {
        global.escapeHtml = escapeHtml;
    }

    // Export for CommonJS / Node environments if present
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml: escapeHtml };
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
