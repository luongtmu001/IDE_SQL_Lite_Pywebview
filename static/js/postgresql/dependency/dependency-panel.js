/**
 * PostgreSQL Dependency Graph - Detail Panel Manager
 * Handles the right-hand metadata drawer, SQL definition viewing and suggested resolutions.
 */
(function (global) {
    'use strict';

    class PostgresDependencyPanel {
        constructor(panelContainer, options = {}) {
            this.container = panelContainer;
            this.options = options;
            this.currentNode = null;
            this.currentGraph = null;
            this.connId = options.connId || null;
            this.database = options.database || null;
        }

        setConnectionContext(connId, database) {
            this.connId = connId;
            this.database = database;
        }

        setGraph(graph) {
            this.currentGraph = graph;
            this.render();
        }

        setSelectedNode(node) {
            this.currentNode = node;
            this.render();
        }

        render() {
            if (!this.container) return;

            if (!this.currentNode) {
                this.renderEmptyState();
                return;
            }

            const node = this.currentNode;
            const objType = (node.object_type || '').toUpperCase();
            const confidence = (node.confidence || 'CONFIRMED').toUpperCase();
            const source = (node.source || 'CATALOG').toUpperCase();
            const isRoot = node.level === 0;

            const iconClass = this.getObjectIconClass(objType);
            const badgeClass = `ide-dep-badge-${confidence.toLowerCase()}`;

            let html = `
                <div class="ide-dep-panel-header">
                    <h6 class="ide-dep-panel-title">
                        <i class="fa-solid fa-circle-info me-1"></i> Object Details
                    </h6>
                    <button type="button" class="btn btn-sm btn-link text-muted p-0 text-decoration-none" id="ide-dep-panel-close-btn" title="Close Panel">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="ide-dep-panel-body">
                    <!-- Object Identity Card -->
                    <div class="ide-dep-info-card">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <i class="${iconClass}" style="font-size: 16px;"></i>
                            <div class="fw-bold text-truncate" title="${node.display_name || node.name}">
                                ${node.name}
                            </div>
                        </div>
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">Object Type</span>
                            <span class="ide-dep-meta-val badge bg-secondary">${objType}</span>
                        </div>
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">Schema</span>
                            <span class="ide-dep-meta-val">${node.schema || 'public'}</span>
                        </div>
                        ${node.parent_name ? `
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">Table</span>
                            <span class="ide-dep-meta-val">${node.parent_name}</span>
                        </div>` : ''}
                        ${node.oid ? `
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">OID</span>
                            <span class="ide-dep-meta-val font-monospace">${node.oid}</span>
                        </div>` : ''}
                    </div>

                    <!-- Dependency Confidence & Source -->
                    <div class="ide-dep-info-card">
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">Confidence</span>
                            <span class="ide-dep-badge ${badgeClass}" title="Dependency level of certainty">
                                ${confidence === 'CONFIRMED' ? '✓ ' : (confidence === 'POSSIBLE' ? '⚠ ' : '')}${confidence}
                            </span>
                        </div>
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">Source</span>
                            <span class="ide-dep-meta-val">${source === 'CATALOG' ? 'PostgreSQL Catalog' : 'Source Code Analysis'}</span>
                        </div>
                        <div class="ide-dep-meta-row">
                            <span class="ide-dep-meta-label">Relation</span>
                            <span class="ide-dep-meta-val">${node.dependency_type || 'DIRECT'}</span>
                        </div>
                    </div>
            `;

            // Warnings section
            const relevantWarnings = this.getWarningsForNode(node);
            if (relevantWarnings.length > 0) {
                html += `<div class="mt-1">
                    <div class="fw-semibold small mb-2 text-warning">
                        <i class="fa-solid fa-triangle-exclamation me-1"></i> Warnings & Notices
                    </div>`;
                for (const w of relevantWarnings) {
                    const isInfo = w.level === 'INFO';
                    html += `
                        <div class="ide-dep-warning-box ${isInfo ? 'info' : ''}">
                            <div class="fw-bold mb-1">${w.message}</div>
                            ${w.details ? `<div class="small opacity-75">${w.details}</div>` : ''}
                        </div>
                    `;
                }
                html += `</div>`;
            }

            // Snippets section (if detected by source analysis)
            if (node.metadata && node.metadata.snippets && node.metadata.snippets.length > 0) {
                html += `
                    <div class="mt-1">
                        <div class="fw-semibold small mb-1 text-info">
                            <i class="fa-solid fa-code me-1"></i> Detected References
                        </div>
                        <pre class="ide-dep-snippet-pre">${node.metadata.snippets.join('\n')}</pre>
                    </div>
                `;
            }

            // Action Buttons
            html += `
                <div class="d-flex flex-column gap-2 mt-auto pt-3 border-top border-secondary-subtle">
                    <button type="button" class="btn btn-sm btn-primary w-100 fw-semibold" id="ide-dep-open-def-btn">
                        <i class="fa-solid fa-arrow-up-right-from-square me-1"></i> Open Definition in Editor
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary w-100" id="ide-dep-copy-sql-btn">
                        <i class="fa-solid fa-copy me-1"></i> Copy Definition SQL
                    </button>
                    ${isRoot ? `
                    <button type="button" class="btn btn-sm btn-outline-warning w-100" id="ide-dep-suggested-steps-btn">
                        <i class="fa-solid fa-shield-halved me-1"></i> Impact & Suggested Steps
                    </button>` : ''}
                </div>
            </div>`;

            this.container.innerHTML = html;
            this.container.classList.remove('collapsed');
            this.bindEvents();
        }

        renderEmptyState() {
            this.container.innerHTML = `
                <div class="ide-dep-panel-header">
                    <h6 class="ide-dep-panel-title">Object Details</h6>
                </div>
                <div class="ide-dep-panel-body text-center justify-content-center text-muted">
                    <i class="fa-solid fa-arrow-pointer mb-2" style="font-size: 24px; opacity: 0.4;"></i>
                    <p class="small mb-0">Select a node in the graph to inspect object metadata and definitions.</p>
                </div>
            `;
        }

        getWarningsForNode(node) {
            if (!this.currentGraph || !this.currentGraph.warnings) return [];
            return this.currentGraph.warnings.filter(w => {
                if (w.node_id && w.node_id === node.id) return true;
                // If node is root or warning is global
                if (node.level === 0 && (w.type === 'EXTERNAL_DEPENDENCY' || w.type === 'CATALOG_NOTICE')) return true;
                return false;
            });
        }

        getObjectIconClass(objType) {
            switch (objType) {
                case 'TABLE': return 'fa-solid fa-table text-primary';
                case 'COLUMN': return 'fa-solid fa-hashtag text-info';
                case 'VIEW': return 'fa-solid fa-table-columns text-success';
                case 'MATERIALIZED_VIEW': return 'fa-solid fa-layer-group text-success';
                case 'FUNCTION': return 'fa-solid fa-code text-warning';
                case 'PROCEDURE': return 'fa-solid fa-terminal text-warning';
                case 'TRIGGER': return 'fa-solid fa-bolt text-danger';
                case 'CONSTRAINT': return 'fa-solid fa-lock text-secondary';
                case 'FOREIGN_KEY': return 'fa-solid fa-key text-warning';
                case 'INDEX': return 'fa-solid fa-list-ol text-info';
                default: return 'fa-solid fa-cube text-secondary';
            }
        }

        bindEvents() {
            const closeBtn = this.container.querySelector('#ide-dep-panel-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    this.container.classList.add('collapsed');
                });
            }

            const openDefBtn = this.container.querySelector('#ide-dep-open-def-btn');
            if (openDefBtn && this.currentNode) {
                openDefBtn.addEventListener('click', () => this.handleOpenDefinition());
            }

            const copySqlBtn = this.container.querySelector('#ide-dep-copy-sql-btn');
            if (copySqlBtn && this.currentNode) {
                copySqlBtn.addEventListener('click', () => this.handleCopyDefinition());
            }

            const stepsBtn = this.container.querySelector('#ide-dep-suggested-steps-btn');
            if (stepsBtn && this.currentNode) {
                stepsBtn.addEventListener('click', () => this.handleShowSuggestedSteps());
            }
        }

        async handleOpenDefinition() {
            if (!this.currentNode) return;
            const node = this.currentNode;
            try {
                if (window.AppLoader) window.AppLoader.show('Loading definition...');
                const res = await PostgresDependencyApi.getObjectDefinition(this.connId, {
                    type: node.object_type,
                    schema: node.schema,
                    name: node.name,
                    oid: node.oid,
                    database: this.database
                });
                if (window.AppLoader) window.AppLoader.hide();

                if (res && res.success && res.definition) {
                    if (typeof this.options.onOpenDefinition === 'function') {
                        this.options.onOpenDefinition(res.definition, `${node.name}.sql`, node);
                    } else if (window.createTab) {
                        window.createTab({
                            title: `${node.name}.sql`,
                            content: res.definition,
                            tabType: 'query',
                            connectionId: this.connId,
                            database: this.database,
                            schema: node.schema
                        });
                    }
                } else {
                    alert(res?.error || 'SQL definition is not available for this object.');
                }
            } catch (err) {
                if (window.AppLoader) window.AppLoader.hide();
                alert(`Failed to load definition: ${err.message}`);
            }
        }

        async handleCopyDefinition() {
            if (!this.currentNode) return;
            const node = this.currentNode;
            try {
                const res = await PostgresDependencyApi.getObjectDefinition(this.connId, {
                    type: node.object_type,
                    schema: node.schema,
                    name: node.name,
                    oid: node.oid,
                    database: this.database
                });

                if (res && res.success && res.definition) {
                    await navigator.clipboard.writeText(res.definition);
                    if (window.AppAlert) {
                        window.AppAlert.success('Definition SQL copied to clipboard');
                    } else {
                        alert('Definition SQL copied to clipboard!');
                    }
                } else {
                    alert(res?.error || 'SQL definition is not available for this object.');
                }
            } catch (err) {
                alert(`Copy failed: ${err.message}`);
            }
        }

        async handleShowSuggestedSteps() {
            if (!this.currentNode) return;
            const node = this.currentNode;
            try {
                if (window.AppLoader) window.AppLoader.show('Analyzing impact...');
                const res = await PostgresDependencyApi.getSuggestedSteps(this.connId, {
                    schema: node.schema,
                    table: node.parent_name || '',
                    column: node.name,
                    action: 'ALTER',
                    database: this.database
                });
                if (window.AppLoader) window.AppLoader.hide();

                if (res && res.success && res.steps) {
                    this.showSuggestedStepsModal(res.target, res.steps);
                }
            } catch (err) {
                if (window.AppLoader) window.AppLoader.hide();
                alert(`Failed to analyze impact: ${err.message}`);
            }
        }

        showSuggestedStepsModal(target, steps) {
            let stepsHtml = steps.map(s => `
                <div class="card mb-2 bg-dark-subtle border-secondary">
                    <div class="card-body p-2">
                        <div class="fw-bold small text-primary mb-1">
                            Step ${s.step}: ${s.title}
                        </div>
                        <div class="small text-secondary">${s.description}</div>
                    </div>
                </div>
            `).join('');

            const modalHtml = `
                <div class="modal fade" id="ide-dep-steps-modal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-dialog-centered modal-lg">
                        <div class="modal-content bg-dark text-light border-secondary">
                            <div class="modal-header py-2">
                                <h6 class="modal-title fw-bold">
                                    <i class="fa-solid fa-shield-halved text-warning me-2"></i>
                                    Suggested Resolution Steps: ${target}
                                </h6>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <p class="small text-muted mb-3">
                                    These guidelines are recommended before executing ALTER/DROP on this column.
                                    No database alterations will be performed automatically.
                                </p>
                                ${stepsHtml}
                            </div>
                            <div class="modal-footer py-2">
                                <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            let existingModal = document.getElementById('ide-dep-steps-modal');
            if (existingModal) existingModal.remove();

            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modalEl = document.getElementById('ide-dep-steps-modal');
            if (window.bootstrap && window.bootstrap.Modal) {
                const modal = new window.bootstrap.Modal(modalEl);
                modal.show();
            }
        }
    }

    global.PostgresDependencyPanel = PostgresDependencyPanel;
})(window);
