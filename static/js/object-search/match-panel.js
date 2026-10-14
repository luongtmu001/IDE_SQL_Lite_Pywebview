/**
 * match-panel.js
 * Match Location Panel showing line numbers and snippets, with jump-to-line navigation.
 */
(function (global) {
    'use strict';

    class MatchPanel {
        constructor(panelEl, listEl, countEl, toggleBtnEl, onSelectMatch) {
            this.panel = panelEl;
            this.listEl = listEl;
            this.countEl = countEl;
            this.toggleBtn = toggleBtnEl;
            this.onSelectMatch = onSelectMatch;
            this.matches = [];
            this.activeIndex = -1;
            this.isCollapsed = false;

            this._initEvents();
        }

        _initEvents() {
            if (this.toggleBtn) {
                this.toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleCollapse();
                });
            }

            const headerEl = this.panel?.querySelector('.ocs-match-panel-header');
            if (headerEl) {
                headerEl.addEventListener('click', () => {
                    this.toggleCollapse();
                });
            }
        }

        setMatches(matches, keyword = '', activeIndex = 0) {
            this.matches = matches || [];
            this.activeIndex = activeIndex;

            if (this.countEl) {
                this.countEl.textContent = this.matches.length;
            }

            if (!this.listEl) return;
            this.listEl.innerHTML = '';

            if (this.matches.length === 0) {
                this.listEl.innerHTML = `
                    <div class="text-muted p-2 text-center" style="font-size: 11px;">
                        Không có vị trí khớp nào trong object này.
                    </div>
                `;
                return;
            }

            const fragment = document.createDocumentFragment();

            this.matches.forEach((m, idx) => {
                const item = document.createElement('div');
                item.className = 'ocs-match-item' + (idx === this.activeIndex ? ' active' : '');
                item.dataset.index = idx;

                const loc = document.createElement('span');
                loc.className = 'ocs-match-loc';
                loc.textContent = `Line ${m.line}:${m.column}`;

                const snippet = document.createElement('span');
                snippet.className = 'ocs-match-snippet';

                // Highlight keyword in snippet safely
                const lineText = m.text || '';
                if (keyword && lineText) {
                    const kwEscaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const parts = lineText.split(new RegExp(`(${kwEscaped})`, 'gi'));
                    snippet.innerHTML = parts.map(p => 
                        p.toLowerCase() === keyword.toLowerCase() 
                            ? `<mark>${escapeHtml(p)}</mark>` 
                            : escapeHtml(p)
                    ).join('');
                } else {
                    snippet.textContent = lineText;
                }

                item.appendChild(loc);
                item.appendChild(snippet);

                item.addEventListener('click', () => {
                    if (typeof this.onSelectMatch === 'function') {
                        this.onSelectMatch(idx);
                    }
                });

                fragment.appendChild(item);
            });

            this.listEl.appendChild(fragment);
            this.scrollToActive();
        }

        setActiveIndex(index) {
            this.activeIndex = index;
            if (!this.listEl) return;

            const items = this.listEl.querySelectorAll('.ocs-match-item');
            items.forEach((item, idx) => {
                if (idx === index) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            this.scrollToActive();
        }

        scrollToActive() {
            if (!this.listEl || this.activeIndex < 0) return;
            const activeItem = this.listEl.querySelector(`.ocs-match-item[data-index="${this.activeIndex}"]`);
            if (activeItem) {
                activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }

        toggleCollapse() {
            this.isCollapsed = !this.isCollapsed;
            if (this.panel) {
                this.panel.classList.toggle('collapsed', this.isCollapsed);
            }
            if (this.toggleBtn) {
                const icon = this.toggleBtn.querySelector('i');
                if (icon) {
                    icon.className = this.isCollapsed ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
                }
            }
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    global.MatchPanel = MatchPanel;
})(window);
