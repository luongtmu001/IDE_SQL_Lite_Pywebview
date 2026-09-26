/**
 * BRAVO Feature Registry
 * Plug-and-play module system: features register themselves here.
 * The BRAVO window reads this registry to populate its nav panel.
 */
(function (global) {
    'use strict';

    const _registry = new Map();

    const BravoFeatureRegistry = {
        /**
         * Register a feature module.
         * @param {Object} feature - { id, displayName, icon, order, mount(el, ctx), destroy() }
         */
        register(feature) {
            if (!feature.id) {
                console.warn('[BRAVO] Feature missing id, skipping registration.');
                return;
            }
            _registry.set(feature.id, Object.assign({
                icon: 'fa-puzzle-piece',
                order: 999,
                mount(containerEl, context) {
                    containerEl.innerHTML = `<div class="bravo-content-empty">
                        <i class="fa-solid fa-puzzle-piece"></i>
                        <p>Feature "${feature.displayName}" chưa có giao diện.</p>
                    </div>`;
                },
                destroy() {}
            }, feature));
            // Sort by order
            const sorted = [..._registry.entries()].sort((a, b) => a[1].order - b[1].order);
            _registry.clear();
            sorted.forEach(([k, v]) => _registry.set(k, v));
        },

        /**
         * Get all registered features sorted by order.
         * @returns {Array}
         */
        getAll() {
            return [..._registry.values()];
        },

        /**
         * Get a feature by id.
         * @param {string} id
         * @returns {Object|null}
         */
        get(id) {
            return _registry.get(id) || null;
        },

        has(id) {
            return _registry.has(id);
        }
    };

    global.BravoFeatureRegistry = BravoFeatureRegistry;

})(window);
