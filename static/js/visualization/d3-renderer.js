/**
 * SQL Visualization — D3.js Table Relationship Designer Canvas
 * Compliant with Section 6 & 7 of .SKILL/sql_visualization.md
 */

(function (window) {
    'use strict';

    const SqlVisualization = window.SqlVisualization || {};
    const { JoinEdge } = SqlVisualization;

    const CARD_WIDTH = 230;
    const HEADER_HEIGHT = 38;
    const ROW_HEIGHT = 24;
    const PORT_RADIUS = 5;

    class D3CanvasRenderer {
        constructor(containerEl, options = {}) {
            this.container = containerEl;
            this.options = options;
            this.queryModel = null;
            this.onModelChange = options.onModelChange || (() => {});
            this.onTableRemove = options.onTableRemove || (() => {});
            this.onJoinClick = options.onJoinClick || (() => {});
            this.onTableFocus = options.onTableFocus || (() => {});
            this.onNodeSelect = options.onNodeSelect || (() => {});
            this.onOperatorSelect = options.onOperatorSelect || (() => {});
            this.focusedTableId = null;
            this.focusedNodeId = null;
            this.focusedOperatorId = null;
            this.physicalPlan = null;
            this.activeViewTab = 'logical'; // 'logical' | 'physical'
            this.showStepNumbers = options.showStepNumbers !== undefined ? options.showStepNumbers : true;
            this.showLegend = false;
            this.forceViewMode = 'auto'; // 'auto' | 'flow' | 'tables'

            this.width = options.width || 800;
            this.height = options.height || 600;

            this.svg = null;
            this.zoomBehavior = null;
            this.currentTransform = d3.zoomIdentity;

            // Drag-linking state
            this.dragLinkState = null;

            this._initSvg();
        }

        _initSvg() {
            this.container.innerHTML = '';
            
            this.svg = d3.select(this.container)
                .append('svg')
                .attr('class', 'vqd-canvas-svg')
                .attr('width', '100%')
                .attr('height', '100%');

            // Defs
            const defs = this.svg.append('defs');

            // Drop shadow filter for table cards
            const filter = defs.append('filter')
                .attr('id', 'vqd-card-shadow')
                .attr('x', '-10%')
                .attr('y', '-10%')
                .attr('width', '130%')
                .attr('height', '130%');
            filter.append('feDropShadow')
                .attr('dx', 0)
                .attr('dy', 4)
                .attr('stdDeviation', 6)
                .attr('flood-color', 'rgba(0,0,0,0.3)');

            // Background grid pattern
            const pattern = defs.append('pattern')
                .attr('id', 'vqd-grid-pattern')
                .attr('width', 20)
                .attr('height', 20)
                .attr('patternUnits', 'userSpaceOnUse');
            pattern.append('circle')
                .attr('cx', 2)
                .attr('cy', 2)
                .attr('r', 1)
                .attr('fill', 'var(--vqd-grid-dot, rgba(255,255,255,0.08))');

            // Markers for directed flow edges
            const markerTypes = [
                { id: 'vqd-flow-arrow-data-flow', color: '#3b82f6' },
                { id: 'vqd-flow-arrow-union', color: '#f59e0b' },
                { id: 'vqd-flow-arrow-cte', color: '#8b5cf6' },
                { id: 'vqd-flow-arrow-subquery', color: '#6366f1' },
                { id: 'vqd-flow-arrow-join', color: '#10b981' },
                { id: 'vqd-flow-arrow-dependency', color: '#94a3b8' },
                { id: 'vqd-flow-arrow-recursive', color: '#ef4444' },
                { id: 'vqd-flow-arrow-plan', color: '#64748b' }
            ];

            markerTypes.forEach(m => {
                defs.append('marker')
                    .attr('id', m.id)
                    .attr('viewBox', '0 0 10 10')
                    .attr('refX', 8)
                    .attr('refY', 5)
                    .attr('markerWidth', 6)
                    .attr('markerHeight', 6)
                    .attr('orient', 'auto-start-reverse')
                    .append('path')
                    .attr('d', 'M 0 1.5 L 8 5 L 0 8.5 z')
                    .attr('fill', m.color);
            });

            // Canvas background rect
            this.svg.append('rect')
                .attr('class', 'vqd-canvas-background')
                .attr('width', '100%')
                .attr('height', '100%')
                .attr('fill', 'url(#vqd-grid-pattern)');

            // Root transform group for Pan/Zoom
            this.gRoot = this.svg.append('g').attr('class', 'vqd-canvas-root');

            // Layer groups: classic table view + directed flow graph view + physical execution plan view
            this.gJoins = this.gRoot.append('g').attr('class', 'vqd-layer-joins');
            this.gDragLink = this.gRoot.append('g').attr('class', 'vqd-layer-drag-link');
            this.gTables = this.gRoot.append('g').attr('class', 'vqd-layer-tables');
            this.gFlowEdges = this.gRoot.append('g').attr('class', 'vqd-layer-flow-edges');
            this.gFlowNodes = this.gRoot.append('g').attr('class', 'vqd-layer-flow-nodes');
            this.gPlanEdges = this.gRoot.append('g').attr('class', 'vqd-layer-plan-edges').style('display', 'none');
            this.gPlanNodes = this.gRoot.append('g').attr('class', 'vqd-layer-plan-nodes').style('display', 'none');

            // Zoom behavior
            this.zoomBehavior = d3.zoom()
                .scaleExtent([0.2, 2.5])
                .on('zoom', (event) => {
                    this.currentTransform = event.transform;
                    this.gRoot.attr('transform', event.transform);
                });

            this.svg.call(this.zoomBehavior);

            // Double click zoom disable to prevent interference
            this.svg.on('dblclick.zoom', null);

            // Canvas background click: clear table focus, flow node focus & plan operator focus
            this.svg.on('click', (event) => {
                if (event.target === this.svg.node() || d3.select(event.target).classed('vqd-canvas-background')) {
                    if (this.focusedTableId !== null) {
                        this.focusedTableId = null;
                        this.gTables.selectAll('.vqd-table-card').classed('vqd-focused', false);
                        this.onTableFocus(null, null);
                    }
                    if (this.focusedNodeId !== null) {
                        this._clearFlowFocus();
                        this.onNodeSelect(null);
                    }
                    if (this.focusedOperatorId !== null) {
                        this._clearPlanFocus();
                        this.onOperatorSelect(null);
                    }
                }
            });
        }

        shouldRenderFlowGraph() {
            if (this.forceViewMode === 'flow') return true;
            if (this.forceViewMode === 'tables') return false;
            if (!this.queryModel) return false;
            if (this.queryModel.hasFlowGraph()) {
                if (this.queryModel.tables.size === 0) return true;
                const flowNodes = this._getFlowNodesArray();
                const hasComplexNode = flowNodes.some(n => 
                    n.nodeType === 'CTE' || n.nodeType === 'Union' || n.nodeType === 'DerivedTable' ||
                    n.nodeType === 'Subquery' || n.nodeType === 'Filter' || n.nodeType === 'Aggregate'
                );
                if (hasComplexNode) return true;
            }
            return false;
        }

        setForceViewMode(mode) {
            this.forceViewMode = mode; // 'auto' | 'flow' | 'tables'
        }

        getForceViewMode() {
            return this.forceViewMode || (this.shouldRenderFlowGraph() ? 'flow' : 'tables');
        }

        render(queryModel) {
            this.queryModel = queryModel;
            if (!this.queryModel) return;

            if (this.shouldRenderFlowGraph()) {
                this.gJoins.style('display', 'none');
                this.gDragLink.style('display', 'none');
                this.gTables.style('display', 'none');
                this.gFlowEdges.style('display', null);
                this.gFlowNodes.style('display', null);
                this._renderFlowGraph();
            } else {
                this.gFlowEdges.style('display', 'none');
                this.gFlowNodes.style('display', 'none');
                this.gJoins.style('display', null);
                this.gDragLink.style('display', null);
                this.gTables.style('display', null);
                this._renderTables();
                this._renderJoins();
            }
        }

        _renderTables() {
            const self = this;
            const tables = Array.from(this.queryModel.tables.values());

            const tableSel = this.gTables.selectAll('.vqd-table-card')
                .data(tables, d => d.id);

            tableSel.exit().remove();

            const enterSel = tableSel.enter()
                .append('g')
                .attr('class', 'vqd-table-card')
                .attr('data-table-id', d => d.id);

            const mergedSel = enterSel.merge(tableSel);

            mergedSel.attr('transform', d => `translate(${d.x}, ${d.y})`);

            // Setup Table Dragging on the whole card with rAF throttling
            let dragRaf = null;
            const dragBehavior = d3.drag()
                .filter(function (event) {
                    const target = event.target;
                    if (!target) return true;
                    // Ignore clicks on interactive child elements so they don't drag the card
                    if (target.closest('.vqd-header-btn') ||
                        target.closest('.vqd-col-checkbox') ||
                        target.closest('.vqd-port') ||
                        target.closest('.vqd-toggle-more-btn')) {
                        return false;
                    }
                    return !event.button; // Left click only
                })
                .on('start', function (event, d) {
                    if (event.sourceEvent) event.sourceEvent.stopPropagation();
                    d3.select(this).raise();
                    d3.select(this).classed('vqd-dragging', true);
                    self._updateJoinsRealtime();
                })
                .on('drag', function (event, d) {
                    if (event.sourceEvent) event.sourceEvent.stopPropagation();
                    d.x = Math.max(10, d.x + event.dx);
                    d.y = Math.max(10, d.y + event.dy);
                    this.setAttribute('transform', `translate(${d.x}, ${d.y})`);
                    self._updateJoinsRealtime();
                })
                .on('end', function (event, d) {
                    if (event.sourceEvent) event.sourceEvent.stopPropagation();
                    d3.select(this).classed('vqd-dragging', false);
                    self.queryModel.setTablePosition(d.id, d.x, d.y);
                    self._updateJoinsRealtime();
                    self.onModelChange('table-moved', { tableId: d.id, x: d.x, y: d.y });
                });

            // Bind dragBehavior to the entire card group
            mergedSel.call(dragBehavior);

            // Re-render card contents
            mergedSel.each(function (tableNode) {
                self._renderSingleTableCard(d3.select(this), tableNode);
            });

            // Ensure join lines reflect current table card heights and port positions immediately
            this._updateJoinsRealtime();
        }

        _getLinkedColumnNames(tableNode) {
            const linked = new Set();
            const joins = this.queryModel?.joins || [];
            if (!joins || joins.length === 0) return linked;

            const cleanCol = (colStr) => {
                if (!colStr) return '';
                let s = String(colStr).trim();
                if (s.includes('.')) {
                    s = s.split('.').pop().trim();
                }
                return s.toLowerCase().replace(/^[\["`']+|[\]"`']+$/g, '').trim();
            };

            const isThisTable = (tblIdOrName) => {
                if (!tblIdOrName) return false;
                const clean = String(tblIdOrName).toLowerCase().trim().replace(/^[\["`']+|[\]"`']+$/g, '');
                return clean === String(tableNode.id).toLowerCase().trim() ||
                       clean === (tableNode.alias || '').toLowerCase().trim() ||
                       clean === (tableNode.tableName || '').toLowerCase().trim();
            };

            const tableColSet = new Set((tableNode.columns || []).map(c => cleanCol(c.name)));

            joins.forEach(j => {
                const isSource = isThisTable(j.sourceTableId);
                const isTarget = isThisTable(j.targetTableId);
                if (!isSource && !isTarget) return;

                const conditions = j.conditions || [];
                conditions.forEach(c => {
                    const leftColClean = cleanCol(c.leftColumn);
                    const rightColClean = cleanCol(c.rightColumn);

                    // 1. Direct table match via leftTableId / rightTableId
                    if (isThisTable(c.leftTableId) && leftColClean) {
                        linked.add(leftColClean);
                    }
                    if (isThisTable(c.rightTableId) && rightColClean) {
                        linked.add(rightColClean);
                    }

                    // 2. Table prefix in column string e.g. l.Code or d.LayoutCode
                    const rawLeft = String(c.leftColumn || '').trim();
                    if (rawLeft.includes('.')) {
                        const prefix = rawLeft.split('.')[0].trim().replace(/^[\["`']+|[\]"`']+$/g, '').toLowerCase();
                        if (isThisTable(prefix) && leftColClean) {
                            linked.add(leftColClean);
                        }
                    }
                    const rawRight = String(c.rightColumn || '').trim();
                    if (rawRight.includes('.')) {
                        const prefix = rawRight.split('.')[0].trim().replace(/^[\["`']+|[\]"`']+$/g, '').toLowerCase();
                        if (isThisTable(prefix) && rightColClean) {
                            linked.add(rightColClean);
                        }
                    }

                    // 3. Fallback matching by column name existence in table
                    if (tableColSet.has(leftColClean) && (isSource || !tableColSet.has(rightColClean))) {
                        linked.add(leftColClean);
                    }
                    if (tableColSet.has(rightColClean) && (isTarget || !tableColSet.has(leftColClean))) {
                        linked.add(rightColClean);
                    }

                    // 4. Default fallback: if this table is source and leftCol exists, or target and rightCol exists
                    if (isSource && leftColClean) {
                        linked.add(leftColClean);
                    }
                    if (isTarget && rightColClean) {
                        linked.add(rightColClean);
                    }
                });
            });

            return linked;
        }

        _renderSingleTableCard(gCard, tableNode) {
            const self = this;
            gCard.selectAll('*').remove();

            const isFocused = this.focusedTableId === tableNode.id;
            gCard.classed('vqd-focused', isFocused);

            // Card click focus listener
            gCard.on('click', (event) => {
                event.stopPropagation();
                if (self.focusedTableId === tableNode.id) return;
                self.focusedTableId = tableNode.id;
                self.gTables.selectAll('.vqd-table-card').classed('vqd-focused', false);
                gCard.classed('vqd-focused', true);
                self.onTableFocus(tableNode.id, tableNode);
            });

            const allCols = tableNode.columns || [];
            const linkedNames = this._getLinkedColumnNames(tableNode);
            const normalizeCol = s => (s || '').toLowerCase().trim().replace(/^[\["`']+|[\]"`']+$/g, '');

            // Mark columns as linked
            allCols.forEach(c => {
                c.isLinked = linkedNames.has(normalizeCol(c.name));
            });

            // Improvement 1: Stably sort columns: PKs first, then joined columns, then remaining columns
            const getColPriority = (col) => {
                if (col.isPk) return 0;
                if (col.isLinked) return 1;
                return 2;
            };

            const originalIndices = new Map(allCols.map((c, idx) => [c, idx]));
            allCols.sort((a, b) => {
                const pA = getColPriority(a);
                const pB = getColPriority(b);
                if (pA !== pB) return pA - pB;
                return originalIndices.get(a) - originalIndices.get(b);
            });
            tableNode.columns = allCols;

            // Default display: When collapsed (isExpanded = false), show PK columns and joined columns
            let displayCols = [];
            if (tableNode.isExpanded) {
                displayCols = allCols;
            } else {
                const keyCols = allCols.filter(c => c.isPk || c.isLinked);
                if (keyCols.length > 0) {
                    displayCols = keyCols;
                } else {
                    displayCols = allCols.slice(0, Math.min(5, allCols.length));
                }
            }

            // Cache visible columns on tableNode for port calculations
            tableNode._visibleColumns = displayCols;

            const hasToggle = allCols.length > displayCols.length || (tableNode.isExpanded && allCols.length > 0);
            const footerH = hasToggle ? 24 : 0;
            const cardHeight = HEADER_HEIGHT + (displayCols.length * ROW_HEIGHT) + footerH + 6;

            // Card Background Rect
            gCard.append('rect')
                .attr('class', 'vqd-card-bg')
                .attr('width', CARD_WIDTH)
                .attr('height', cardHeight)
                .attr('rx', 6)
                .attr('ry', 6)
                .attr('filter', 'url(#vqd-card-shadow)');

            // Header Group (Unified within card, no separate drag)
            const gHeader = gCard.append('g')
                .attr('class', 'vqd-card-header');

            gHeader.append('rect')
                .attr('class', 'vqd-header-bg')
                .attr('width', CARD_WIDTH)
                .attr('height', HEADER_HEIGHT)
                .attr('rx', 6)
                .attr('ry', 6);

            // Square off bottom corners of header
            gHeader.append('rect')
                .attr('class', 'vqd-header-bottom-square')
                .attr('y', HEADER_HEIGHT - 6)
                .attr('width', CARD_WIDTH)
                .attr('height', 6);

            // Table Icon
            const iconUnicode = tableNode.sourceType === 'view' ? '\uf06e' : (tableNode.sourceType === 'synonym' ? '\uf08e' : '\uf0ce');
            gHeader.append('text')
                .attr('class', 'vqd-header-icon fa-solid')
                .attr('x', 10)
                .attr('y', 23)
                .text(iconUnicode);

            // Table Name
            const displayName = tableNode.tableName;
            gHeader.append('text')
                .attr('class', 'vqd-header-title')
                .attr('x', 28)
                .attr('y', 20)
                .text(displayName)
                .append('title')
                .text(`${tableNode.schema}.${tableNode.tableName}`);

            // Alias Badge
            if (tableNode.alias && tableNode.alias !== tableNode.tableName) {
                gHeader.append('text')
                    .attr('class', 'vqd-header-alias')
                    .attr('x', 28)
                    .attr('y', 32)
                    .text(`AS ${tableNode.alias}`);
            }

            // Selected Columns Count Badge
            const selectedCols = allCols.filter(c => self.queryModel.isColumnSelected(tableNode.id, c.name));
            if (selectedCols.length > 0) {
                const gBadgeCount = gHeader.append('g')
                    .attr('class', 'vqd-header-col-badge')
                    .attr('transform', `translate(${CARD_WIDTH - 65}, 12)`);
                gBadgeCount.append('rect')
                    .attr('class', 'vqd-header-badge-rect')
                    .attr('x', -24)
                    .attr('y', 0)
                    .attr('width', 38)
                    .attr('height', 15)
                    .attr('rx', 7);
                gBadgeCount.append('text')
                    .attr('class', 'vqd-header-badge-text')
                    .attr('x', -5)
                    .attr('y', 11)
                    .attr('text-anchor', 'middle')
                    .text(`${selectedCols.length} sel`);
            }

            // Close / Remove Table Button
            const btnClose = gHeader.append('g')
                .attr('class', 'vqd-header-btn vqd-btn-close')
                .attr('transform', `translate(${CARD_WIDTH - 22}, 10)`)
                .on('click', (event) => {
                    event.stopPropagation();
                    self.onTableRemove(tableNode.id);
                });
            btnClose.append('circle')
                .attr('cx', 6)
                .attr('cy', 8)
                .attr('r', 8);
            btnClose.append('text')
                .attr('x', 6)
                .attr('y', 11)
                .attr('text-anchor', 'middle')
                .text('×');

            // Expand / Collapse Header Button
            const btnToggle = gHeader.append('g')
                .attr('class', 'vqd-header-btn vqd-btn-toggle')
                .attr('transform', `translate(${CARD_WIDTH - 42}, 10)`)
                .on('click', (event) => {
                    event.stopPropagation();
                    tableNode.isExpanded = !tableNode.isExpanded;
                    self._renderSingleTableCard(gCard, tableNode);
                    self._updateJoinsRealtime();
                });
            btnToggle.append('circle')
                .attr('cx', 6)
                .attr('cy', 8)
                .attr('r', 8);
            btnToggle.append('text')
                .attr('class', 'fa-solid')
                .attr('x', 6)
                .attr('y', 11)
                .attr('text-anchor', 'middle')
                .text(tableNode.isExpanded ? '\uf077' : '\uf078'); // fa-chevron-up / down

            // Columns List
            if (displayCols.length > 0) {
                const gColumns = gCard.append('g')
                    .attr('class', 'vqd-card-columns')
                    .attr('transform', `translate(0, ${HEADER_HEIGHT})`);

                displayCols.forEach((col, idx) => {
                    self._renderColumnRow(gColumns, tableNode, col, idx);
                });
            } else {
                // Empty columns placeholder / Loading state
                const gEmpty = gCard.append('g')
                    .attr('class', 'vqd-card-columns-empty')
                    .attr('transform', `translate(0, ${HEADER_HEIGHT})`);
                gEmpty.append('text')
                    .attr('class', 'vqd-col-empty-text')
                    .attr('x', CARD_WIDTH / 2)
                    .attr('y', 20)
                    .attr('text-anchor', 'middle')
                    .text('Không có cột hoặc đang tải...');
            }

            // Expand / Collapse Footer bar
            if (hasToggle) {
                const gFooter = gCard.append('g')
                    .attr('class', 'vqd-toggle-more-btn')
                    .attr('transform', `translate(0, ${HEADER_HEIGHT + (displayCols.length * ROW_HEIGHT)})`)
                    .style('cursor', 'pointer')
                    .on('click', (event) => {
                        event.stopPropagation();
                        tableNode.isExpanded = !tableNode.isExpanded;
                        self._renderSingleTableCard(gCard, tableNode);
                        self._updateJoinsRealtime();
                    });

                gFooter.append('rect')
                    .attr('class', 'vqd-footer-bg')
                    .attr('width', CARD_WIDTH)
                    .attr('height', 24)
                    .attr('rx', 4);

                const hiddenCount = allCols.length - displayCols.length;
                const footerText = tableNode.isExpanded
                    ? `▲ Thu gọn (chỉ hiện cột chính & liên kết)`
                    : `▼ Xem thêm (+${hiddenCount > 0 ? hiddenCount : allCols.length} cột)`;

                gFooter.append('text')
                    .attr('class', 'vqd-footer-text')
                    .attr('x', CARD_WIDTH / 2)
                    .attr('y', 15)
                    .attr('text-anchor', 'middle')
                    .text(footerText);
            }
        }

        _renderColumnRow(gColumns, tableNode, col, index) {
            const self = this;
            const yPos = index * ROW_HEIGHT;
            const isSelected = this.queryModel.isColumnSelected(tableNode.id, col.name);
            const isLinked = !!col.isLinked;

            const gRow = gColumns.append('g')
                .attr('class', `vqd-col-row ${isSelected ? 'vqd-col-selected' : ''} ${isLinked ? 'vqd-col-linked' : ''}`)
                .attr('transform', `translate(0, ${yPos})`)
                .attr('data-column-name', col.name);

            // Row Hover/Selected/Linked Background
            gRow.append('rect')
                .attr('class', 'vqd-col-row-bg')
                .attr('width', CARD_WIDTH)
                .attr('height', ROW_HEIGHT);

            // Checkbox for SELECT inclusion with fast in-place update
            const gCheckbox = gRow.append('g')
                .attr('class', `vqd-col-checkbox ${isSelected ? 'checked' : ''}`)
                .attr('transform', 'translate(8, 5)')
                .on('click', (event) => {
                    event.stopPropagation();
                    const nowSelected = self.queryModel.toggleColumnSelection(tableNode.id, col.name);
                    gRow.classed('vqd-col-selected', nowSelected);
                    gCheckbox.classed('checked', nowSelected);
                    gCheckbox.selectAll('.vqd-check-icon').remove();
                    if (nowSelected) {
                        gCheckbox.append('text')
                            .attr('class', 'fa-solid vqd-check-icon')
                            .attr('x', 6.5)
                            .attr('y', 10.5)
                            .attr('text-anchor', 'middle')
                            .text('\uf00c'); // fa-check
                    }
                    self._updateCardBadgeCount(gCard, tableNode);
                    self.onModelChange('select-toggled', { tableId: tableNode.id, column: col.name, selected: nowSelected });
                });

            gCheckbox.append('rect')
                .attr('width', 13)
                .attr('height', 13)
                .attr('rx', 2);

            if (isSelected) {
                gCheckbox.append('text')
                    .attr('class', 'fa-solid vqd-check-icon')
                    .attr('x', 6.5)
                    .attr('y', 10.5)
                    .attr('text-anchor', 'middle')
                    .text('\uf00c'); // fa-check
            }

            // PK, FK, or Linked Badge Icon
            let iconX = 26;
            if (col.isPk) {
                gRow.append('text')
                    .attr('class', 'fa-solid vqd-pk-icon')
                    .attr('x', iconX)
                    .attr('y', 16)
                    .text('\uf084') // fa-key
                    .append('title')
                    .text('Primary Key');
                iconX += 14;
            } else if (col.isFk) {
                gRow.append('text')
                    .attr('class', 'fa-solid vqd-fk-icon')
                    .attr('x', iconX)
                    .attr('y', 16)
                    .text('\uf0c1') // fa-link
                    .append('title')
                    .text('Foreign Key');
                iconX += 14;
            } else if (isLinked) {
                gRow.append('text')
                    .attr('class', 'fa-solid vqd-link-icon text-info')
                    .attr('x', iconX)
                    .attr('y', 16)
                    .text('\uf0c1') // fa-link
                    .append('title')
                    .text('Cột liên kết JOIN');
                iconX += 14;
            }

            // Column Name
            gRow.append('text')
                .attr('class', `vqd-col-name ${isLinked ? 'vqd-col-name-linked' : ''}`)
                .attr('x', iconX)
                .attr('y', 16)
                .text(col.name)
                .append('title')
                .text(`${col.name} (${col.type})${isLinked ? ' - [Cột liên kết]' : ''}`);

            // Column Data Type Badge
            gRow.append('text')
                .attr('class', 'vqd-col-type')
                .attr('x', CARD_WIDTH - 12)
                .attr('y', 16)
                .attr('text-anchor', 'end')
                .text(col.type);

            // Left Anchor Port
            const portLeft = gRow.append('circle')
                .attr('class', `vqd-port vqd-port-left ${isLinked ? 'vqd-port-linked' : ''}`)
                .attr('cx', 0)
                .attr('cy', ROW_HEIGHT / 2)
                .attr('r', isLinked ? PORT_RADIUS + 1 : PORT_RADIUS);

            // Right Anchor Port
            const portRight = gRow.append('circle')
                .attr('class', `vqd-port vqd-port-right ${isLinked ? 'vqd-port-linked' : ''}`)
                .attr('cx', CARD_WIDTH)
                .attr('cy', ROW_HEIGHT / 2)
                .attr('r', isLinked ? PORT_RADIUS + 1 : PORT_RADIUS);

            // Port Mouse Events for Drag-Linking
            [portLeft, portRight].forEach(p => {
                p.on('mousedown', (event) => {
                    event.stopPropagation();
                    self._startDragLink(tableNode, col, event);
                });
                p.on('mouseover', function () {
                    d3.select(this).classed('vqd-port-hover', true);
                    if (self.dragLinkState) {
                        self.dragLinkState.hoveredTarget = { tableNode, col };
                    }
                });
                p.on('mouseout', function () {
                    d3.select(this).classed('vqd-port-hover', false);
                    if (self.dragLinkState && self.dragLinkState.hoveredTarget?.tableNode?.id === tableNode.id) {
                        self.dragLinkState.hoveredTarget = null;
                    }
                });
            });
        }

        _renderJoins() {
            const self = this;
            const joins = this.queryModel.joins || [];

            const joinSel = this.gJoins.selectAll('.vqd-join-group')
                .data(joins, d => d.id);

            joinSel.exit().remove();

            const enterJoin = joinSel.enter()
                .append('g')
                .attr('class', 'vqd-join-group')
                .attr('data-join-id', d => d.id);

            enterJoin.append('path').attr('class', 'vqd-join-path');
            enterJoin.append('path')
                .attr('class', 'vqd-join-path-hover')
                .on('click', (event, d) => {
                    event.stopPropagation();
                    self.onJoinClick(d, event);
                });
            
            // Join Badge Group
            const gBadge = enterJoin.append('g')
                .attr('class', 'vqd-join-badge-group')
                .on('click', (event, d) => {
                    event.stopPropagation();
                    self.onJoinClick(d, event);
                });

            gBadge.append('rect')
                .attr('class', 'vqd-join-badge-rect')
                .attr('rx', 10)
                .attr('ry', 10);

            gBadge.append('text')
                .attr('class', 'vqd-join-badge-text')
                .attr('text-anchor', 'middle')
                .attr('y', 4);

            const merged = enterJoin.merge(joinSel);
            this._updateJoinGeometry(merged);
        }

        _getJoinEndpoints(join) {
            if (!join) return null;
            const sourceNode = this.queryModel?.getTable(join.sourceTableId);
            const targetNode = this.queryModel?.getTable(join.targetTableId);
            if (!sourceNode || !targetNode) return null;

            const firstCond = (join.conditions && join.conditions[0]) ? join.conditions[0] : {};
            const leftCol = firstCond.leftColumn || '';
            const rightCol = firstCond.rightColumn || '';
            let sourceColName = leftCol;
            let targetColName = rightCol;

            const normalize = s => (s || '').toLowerCase().trim().replace(/^[\["`']+|[\]"`']+$/g, '');
            const sourceCols = new Set((sourceNode.columns || []).map(c => normalize(c.name)));
            const targetCols = new Set((targetNode.columns || []).map(c => normalize(c.name)));

            const cleanLeft = normalize(leftCol).split('.').pop();
            const cleanRight = normalize(rightCol).split('.').pop();

            if (firstCond.leftTableId === targetNode.id || firstCond.rightTableId === sourceNode.id) {
                sourceColName = rightCol;
                targetColName = leftCol;
            } else if (firstCond.leftTableId === sourceNode.id || firstCond.rightTableId === targetNode.id) {
                sourceColName = leftCol;
                targetColName = rightCol;
            } else if (sourceCols.has(cleanRight) && targetCols.has(cleanLeft)) {
                sourceColName = rightCol;
                targetColName = leftCol;
            } else if (sourceCols.has(cleanLeft) && targetCols.has(cleanRight)) {
                sourceColName = leftCol;
                targetColName = rightCol;
            }

            const p1 = this._getColumnPortCoords(sourceNode, sourceColName, targetNode);
            const p2 = this._getColumnPortCoords(targetNode, targetColName, sourceNode);
            return { sourceNode, targetNode, sourceColName, targetColName, p1, p2 };
        }

        _updateJoinsRealtime() {
            const self = this;
            this.gJoins.selectAll('.vqd-join-group').each(function (join) {
                const joinData = join || this.__data__;
                const endpoints = self._getJoinEndpoints(joinData);
                if (!endpoints) {
                    this.style.display = 'none';
                    return;
                }
                this.style.display = '';

                const { sourceNode, targetNode, sourceColName, targetColName, p1, p2 } = endpoints;
                const pathData = self._calculateBezier(p1, p2);

                const path = this.querySelector('.vqd-join-path');
                const hoverPath = this.querySelector('.vqd-join-path-hover');
                if (path) path.setAttribute('d', pathData);
                if (hoverPath) hoverPath.setAttribute('d', pathData);

                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const badge = this.querySelector('.vqd-join-badge-group');
                if (badge) badge.setAttribute('transform', `translate(${midX}, ${midY})`);

                const joinType = ((joinData && joinData.joinType) || 'INNER').toUpperCase();
                const badgeText = this.querySelector('.vqd-join-badge-text');
                if (badgeText) badgeText.textContent = joinType;

                const textWidth = Math.max(48, joinType.length * 9 + 16);
                const badgeRect = this.querySelector('.vqd-join-badge-rect');
                if (badgeRect) {
                    badgeRect.setAttribute('x', -textWidth / 2);
                    badgeRect.setAttribute('y', -10);
                    badgeRect.setAttribute('width', textWidth);
                    badgeRect.setAttribute('height', 20);
                }

                let titleEl = this.querySelector('title');
                if (!titleEl) {
                    titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                    this.appendChild(titleEl);
                }
                const condText = `${sourceNode?.tableName || '?'}.${sourceColName || '?'} = ${targetNode?.tableName || '?'}.${targetColName || '?'}`;
                titleEl.textContent = `[${joinType} JOIN] ${condText}`;
            });
        }

        _updateJoinsFast() {
            this._updateJoinsRealtime();
        }

        _updateCardBadgeCount(gCard, tableNode) {
            const allCols = tableNode.columns || [];
            const selectedCols = allCols.filter(c => this.queryModel.isColumnSelected(tableNode.id, c.name));
            let gBadgeCount = gCard.select('.vqd-header-col-badge');

            if (selectedCols.length > 0) {
                if (gBadgeCount.empty()) {
                    const gHeader = gCard.select('.vqd-card-header');
                    gBadgeCount = gHeader.append('g')
                        .attr('class', 'vqd-header-col-badge')
                        .attr('transform', `translate(${CARD_WIDTH - 65}, 12)`);
                    gBadgeCount.append('rect')
                        .attr('class', 'vqd-header-badge-rect')
                        .attr('x', -24)
                        .attr('y', 0)
                        .attr('width', 38)
                        .attr('height', 15)
                        .attr('rx', 7);
                    gBadgeCount.append('text')
                        .attr('class', 'vqd-header-badge-text')
                        .attr('x', -5)
                        .attr('y', 11)
                        .attr('text-anchor', 'middle');
                }
                gBadgeCount.select('.vqd-header-badge-text').text(`${selectedCols.length} sel`);
            } else {
                gBadgeCount.remove();
            }
        }

        _updateJoinGeometry(selection) {
            this._updateJoinsRealtime();
        }

        _getColumnPortCoords(tableNode, colName, otherTableNode) {
            let colIndex = 0;
            const cols = tableNode._visibleColumns || tableNode.columns || [];
            if (cols && cols.length > 0 && colName) {
                let cleanName = (colName || '').toLowerCase().trim();
                if (cleanName.includes('.')) {
                    cleanName = cleanName.split('.').pop().trim();
                }
                cleanName = cleanName.replace(/^[\["`']+|[\]"`']+$/g, '');

                const normalize = s => (s || '').toLowerCase().trim().replace(/^[\["`']+|[\]"`']+$/g, '');
                const idx = cols.findIndex(c => normalize(c.name) === cleanName);
                if (idx >= 0) {
                    colIndex = idx;
                } else {
                    const allCols = tableNode.columns || [];
                    const allIdx = allCols.findIndex(c => normalize(c.name) === cleanName);
                    if (allIdx >= 0) {
                        colIndex = Math.min(allIdx, Math.max(0, cols.length - 1));
                    } else {
                        colIndex = Math.max(0, cols.length - 1);
                    }
                }
            }

            const y = tableNode.y + HEADER_HEIGHT + (colIndex * ROW_HEIGHT) + (ROW_HEIGHT / 2);
            // Decide left vs right port based on relative position to other table
            const isLeft = otherTableNode ? (otherTableNode.x < tableNode.x) : false;
            const x = isLeft ? tableNode.x : (tableNode.x + CARD_WIDTH);

            return { x, y, isLeft };
        }

        _calculateBezier(p1, p2) {
            const dx = Math.max(50, Math.abs(p2.x - p1.x) * 0.5);
            const c1x = p1.isLeft ? (p1.x - dx) : (p1.x + dx);
            const c2x = p2.isLeft ? (p2.x - dx) : (p2.x + dx);
            return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y}, ${c2x} ${p2.y}, ${p2.x} ${p2.y}`;
        }

        // ── Drag to Link Interactions ─────────────────────────────────────────
        _startDragLink(sourceTableNode, sourceCol, event) {
            const sourceCoords = this._getColumnPortCoords(sourceTableNode, sourceCol.name, null);
            this.dragLinkState = {
                sourceTable: sourceTableNode,
                sourceCol: sourceCol,
                startX: sourceCoords.x,
                startY: sourceCoords.y,
                hoveredTarget: null
            };

            this.gDragLink.selectAll('*').remove();
            this.gDragLink.append('path')
                .attr('class', 'vqd-drag-link-preview')
                .attr('d', `M ${sourceCoords.x} ${sourceCoords.y} L ${sourceCoords.x} ${sourceCoords.y}`);

            // Attach draglink listeners to SVG only while dragging link
            this.svg.on('mousemove.draglink', (e) => this._handleCanvasMouseMove(e));
            this.svg.on('mouseup.draglink', (e) => this._handleCanvasMouseUp(e));
        }

        _handleCanvasMouseMove(event) {
            if (!this.dragLinkState) return;
            const [mouseX, mouseY] = d3.pointer(event, this.gRoot.node());
            this.dragLinkState.currentX = mouseX;
            this.dragLinkState.currentY = mouseY;

            if (!this._linkRaf) {
                this._linkRaf = requestAnimationFrame(() => {
                    if (this.dragLinkState) {
                        const s = this.dragLinkState;
                        const dx = Math.max(40, Math.abs(s.currentX - s.startX) * 0.5);
                        const dStr = `M ${s.startX} ${s.startY} C ${s.startX + dx} ${s.startY}, ${s.currentX - dx} ${s.currentY}, ${s.currentX} ${s.currentY}`;
                        const previewPath = this.gDragLink.node()?.querySelector('.vqd-drag-link-preview');
                        if (previewPath) previewPath.setAttribute('d', dStr);
                    }
                    this._linkRaf = null;
                });
            }
        }

        _handleCanvasMouseUp(event) {
            this.svg.on('mousemove.draglink', null);
            this.svg.on('mouseup.draglink', null);
            if (this._linkRaf) {
                cancelAnimationFrame(this._linkRaf);
                this._linkRaf = null;
            }
            if (!this.dragLinkState) return;

            const { sourceTable, sourceCol, hoveredTarget } = this.dragLinkState;
            this.dragLinkState = null;
            this.gDragLink.selectAll('*').remove();

            if (hoveredTarget && hoveredTarget.tableNode && hoveredTarget.tableNode.id !== sourceTable.id) {
                const targetTable = hoveredTarget.tableNode;
                const targetCol = hoveredTarget.col;

                // Create Join
                const newJoin = new JoinEdge({
                    sourceTableId: sourceTable.id,
                    targetTableId: targetTable.id,
                    joinType: 'INNER',
                    conditions: [{
                        leftColumn: sourceCol.name,
                        operator: '=',
                        rightColumn: targetCol.name
                    }]
                });

                this.queryModel.addJoin(newJoin);
                this.render(this.queryModel);
                this.onModelChange('join-created', { join: newJoin });
            }
        }

        // ── Zoom Controls ─────────────────────────────────────────────────────
        zoomIn() {
            this.svg.transition().duration(250).call(this.zoomBehavior.scaleBy, 1.25);
        }

        zoomOut() {
            this.svg.transition().duration(250).call(this.zoomBehavior.scaleBy, 0.8);
        }

        resetZoom() {
            this.svg.transition().duration(250).call(this.zoomBehavior.transform, d3.zoomIdentity);
        }

        zoomFit() {
            if (!this.queryModel && !this.physicalPlan) return;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            if (this.activeViewTab === 'physical' && this.physicalPlan) {
                const planNodes = this.physicalPlan.nodes || [];
                if (planNodes.length === 0) {
                    this.resetZoom();
                    return;
                }
                planNodes.forEach(n => {
                    const w = n._width || 220;
                    const h = n._height || 80;
                    minX = Math.min(minX, n.x);
                    minY = Math.min(minY, n.y);
                    maxX = Math.max(maxX, n.x + w);
                    maxY = Math.max(maxY, n.y + h);
                });
            } else if (this.shouldRenderFlowGraph()) {
                const flowNodes = this._getFlowNodesArray();
                if (flowNodes.length === 0) {
                    this.resetZoom();
                    return;
                }
                flowNodes.forEach(n => {
                    const w = n._width || (n.nodeType === 'Table' || n.nodeType === 'View' || n.nodeType === 'CTE' || n.nodeType === 'DerivedTable' ? 220 : 200);
                    const h = n._height || 68;
                    minX = Math.min(minX, n.x);
                    minY = Math.min(minY, n.y);
                    maxX = Math.max(maxX, n.x + w);
                    maxY = Math.max(maxY, n.y + h);
                });
            } else {
                const tables = Array.from(this.queryModel?.tables?.values() || []);
                if (tables.length === 0) {
                    this.resetZoom();
                    return;
                }
                tables.forEach(t => {
                    const cols = t._visibleColumns || t.columns || [];
                    const h = HEADER_HEIGHT + (cols.length * ROW_HEIGHT) + 32;
                    minX = Math.min(minX, t.x);
                    minY = Math.min(minY, t.y);
                    maxX = Math.max(maxX, t.x + CARD_WIDTH);
                    maxY = Math.max(maxY, t.y + h);
                });
            }

            if (!isFinite(minX) || !isFinite(maxX)) return;

            const pad = 60;
            const boundsWidth = (maxX - minX) + pad * 2;
            const boundsHeight = (maxY - minY) + pad * 2;

            const clientRect = this.container.getBoundingClientRect();
            const containerWidth = clientRect.width || 800;
            const containerHeight = clientRect.height || 600;

            const scale = Math.min(2.0, Math.max(0.2, Math.min(containerWidth / boundsWidth, containerHeight / boundsHeight)));
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;

            const transX = (containerWidth / 2) - (midX * scale);
            const transY = (containerHeight / 2) - (midY * scale);

            const transform = d3.zoomIdentity.translate(transX, transY).scale(scale);
            this.svg.transition().duration(400).call(this.zoomBehavior.transform, transform);
        }

        applyHierarchicalLayout(force = true) {
            if (!this.queryModel || this.queryModel.tables.size === 0) return;
            const tables = Array.from(this.queryModel.tables.values());
            if (tables.length === 0) return;

            // If not forced, only lay out if tables have uninitialized coordinates
            if (!force) {
                const hasExistingPositions = tables.some(t => typeof t.x === 'number' && typeof t.y === 'number' && (t.x !== 0 || t.y !== 0));
                if (hasExistingPositions) {
                    return; // Preserve existing positions
                }
            }

            const tableIds = tables.map(t => t.id);
            const inDegree = new Map();
            const adj = new Map();

            tableIds.forEach(id => {
                inDegree.set(id, 0);
                adj.set(id, []);
            });

            // Build graph from joins: sourceTableId -> targetTableId
            (this.queryModel.joins || []).forEach(j => {
                const src = j.sourceTableId;
                const tgt = j.targetTableId;
                if (inDegree.has(tgt) && inDegree.has(src)) {
                    inDegree.set(tgt, inDegree.get(tgt) + 1);
                    adj.get(src).push(tgt);
                }
            });

            // Roots: inDegree === 0 (or first table if all have inDegree > 0)
            let roots = tableIds.filter(id => inDegree.get(id) === 0);
            if (roots.length === 0) {
                roots = [tableIds[0]];
            }

            const levels = new Map();
            roots.forEach(r => levels.set(r, 0));

            const queue = [...roots];
            const visited = new Set(roots);

            while (queue.length > 0) {
                const currId = queue.shift();
                const currLvl = levels.get(currId) || 0;
                const children = adj.get(currId) || [];

                for (const childId of children) {
                    const nextLvl = currLvl + 1;
                    if (!levels.has(childId) || nextLvl > levels.get(childId)) {
                        levels.set(childId, nextLvl);
                    }
                    if (!visited.has(childId)) {
                        visited.add(childId);
                        queue.push(childId);
                    }
                }
            }

            // Fallback for any disconnected tables
            tableIds.forEach(id => {
                if (!levels.has(id)) {
                    levels.set(id, 0);
                }
            });

            // Group tables by level
            const levelBuckets = new Map();
            tables.forEach(t => {
                const lvl = levels.get(t.id) || 0;
                if (!levelBuckets.has(lvl)) levelBuckets.set(lvl, []);
                levelBuckets.get(lvl).push(t);
            });

            const sortedLevels = Array.from(levelBuckets.keys()).sort((a, b) => a - b);

            const START_X = 50;
            const START_Y = 50;
            const HORIZONTAL_GAP = 120;
            const VERTICAL_GAP = 30;

            sortedLevels.forEach(lvl => {
                const colTables = levelBuckets.get(lvl);
                const colX = START_X + lvl * (CARD_WIDTH + HORIZONTAL_GAP);
                let curY = START_Y;

                colTables.forEach(t => {
                    t.x = colX;
                    t.y = curY;
                    const cols = t._visibleColumns || t.columns || [];
                    const h = HEADER_HEIGHT + (cols.length * ROW_HEIGHT) + 32;
                    curY += h + VERTICAL_GAP;
                });
            });

            this.render(this.queryModel);
            this.zoomFit();
            this.onModelChange('auto-layout', {});
        }

        autoLayout() {
            if (this.shouldRenderFlowGraph()) {
                this.applyFlowTopologicalLayout(true);
            } else {
                this.applyHierarchicalLayout(true);
            }
        }

        // ── Directed Query Flow Graph Engine (Phases 1-4) ──────────────────────

        _getRawFlowNodesArray() {
            if (!this.queryModel || !this.queryModel.flowGraph) return [];
            const graph = this.queryModel.flowGraph;
            if (graph.nodes instanceof Map) {
                return Array.from(graph.nodes.values());
            }
            if (Array.isArray(graph.nodes)) {
                return graph.nodes;
            }
            if (typeof graph.nodes === 'object' && graph.nodes !== null) {
                return Object.values(graph.nodes);
            }
            return [];
        }

        _getFlowNodesArray() {
            const rawNodes = this._getRawFlowNodesArray();
            if (rawNodes.length === 0) return [];

            // Detect collapsed expandable containers
            const collapsedContainers = rawNodes.filter(n => n.isExpandable && n.isExpanded === false);
            if (collapsedContainers.length === 0) {
                return rawNodes;
            }

            // Collect all hidden descendant IDs recursively
            const hiddenNodeIds = new Set();
            const collectChildren = (node) => {
                const childIds = node.children || [];
                childIds.forEach(cId => {
                    if (!hiddenNodeIds.has(cId)) {
                        hiddenNodeIds.add(cId);
                        const childNode = rawNodes.find(rn => rn.id === cId);
                        if (childNode) collectChildren(childNode);
                    }
                });
            };

            collapsedContainers.forEach(cNode => {
                collectChildren(cNode);
            });

            return rawNodes.filter(n => !hiddenNodeIds.has(n.id));
        }

        _getFlowEdgesArray() {
            if (!this.queryModel || !this.queryModel.flowGraph) return [];
            const graph = this.queryModel.flowGraph;
            const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
            const rawNodes = this._getRawFlowNodesArray();

            const collapsedContainers = rawNodes.filter(n => n.isExpandable && n.isExpanded === false);
            if (collapsedContainers.length === 0) {
                return rawEdges;
            }

            // Build childId -> containerId mapping and hidden set
            const hiddenNodeIds = new Set();
            const childToContainerMap = new Map();

            const mapChildren = (containerId, node) => {
                const childIds = node.children || [];
                childIds.forEach(cId => {
                    hiddenNodeIds.add(cId);
                    childToContainerMap.set(cId, containerId);
                    const childNode = rawNodes.find(rn => rn.id === cId);
                    if (childNode) mapChildren(containerId, childNode);
                });
            };

            collapsedContainers.forEach(cNode => {
                mapChildren(cNode.id, cNode);
            });

            const visibleEdges = [];
            const seenKeys = new Set();

            rawEdges.forEach(e => {
                let srcId = e.sourceNodeId;
                let tgtId = e.targetNodeId;

                // Remap collapsed endpoints to container
                if (childToContainerMap.has(srcId)) {
                    srcId = childToContainerMap.get(srcId);
                }
                if (childToContainerMap.has(tgtId)) {
                    tgtId = childToContainerMap.get(tgtId);
                }

                // Suppress internal edges within the collapsed container
                if (srcId === tgtId && e.sourceNodeId !== e.targetNodeId) {
                    return;
                }

                // If either is still an unmapped hidden node, skip
                if (hiddenNodeIds.has(srcId) || hiddenNodeIds.has(tgtId)) {
                    return;
                }

                // Deduplicate re-routed parallel edges
                const key = `${srcId}->${tgtId}:${e.edgeType || ''}`;
                if (seenKeys.has(key)) {
                    return;
                }
                seenKeys.add(key);

                if (srcId !== e.sourceNodeId || tgtId !== e.targetNodeId) {
                    visibleEdges.push({
                        ...e,
                        id: `remapped_${srcId}_${tgtId}`,
                        sourceNodeId: srcId,
                        targetNodeId: tgtId
                    });
                } else {
                    visibleEdges.push(e);
                }
            });

            return visibleEdges;
        }

        _getFlowNode(nodeId) {
            if (!this.queryModel || !this.queryModel.flowGraph) return null;
            const graph = this.queryModel.flowGraph;
            if (typeof graph.getNode === 'function') {
                return graph.getNode(nodeId);
            }
            if (graph.nodes instanceof Map) {
                return graph.nodes.get(nodeId) || null;
            }
            const arr = this._getRawFlowNodesArray();
            return arr.find(n => n.id === nodeId) || null;
        }

        _renderFlowGraph() {
            if (!this.queryModel || !this.queryModel.flowGraph) return;

            // Ensure stable topological step numbers are assigned
            if (typeof this.queryModel.flowGraph.computeLogicalSteps === 'function') {
                try {
                    this.queryModel.flowGraph.computeLogicalSteps();
                } catch (_) {}
            }

            const flowNodes = this._getFlowNodesArray();
            const needsInitialLayout = flowNodes.length > 0 && flowNodes.every(n => (n.x === 0 || !n.x) && (n.y === 0 || !n.y));
            if (needsInitialLayout) {
                this.applyFlowTopologicalLayout(false);
                return;
            }

            // Sync step badges visibility class
            this.gFlowNodes.classed('vqd-hide-step-badges', !this.showStepNumbers);

            this._renderFlowEdges();
            this._renderFlowNodes();
        }

        _renderFlowNodes() {
            const self = this;
            const nodes = this._getFlowNodesArray();

            const nodeSel = this.gFlowNodes.selectAll('.vqd-flow-node')
                .data(nodes, d => d.id);

            nodeSel.exit().remove();

            const enterSel = nodeSel.enter()
                .append('g')
                .attr('class', 'vqd-flow-node')
                .attr('data-node-id', d => d.id);

            const mergedSel = enterSel.merge(nodeSel);
            mergedSel.attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);

            // Setup Node Dragging with real-time edge update
            const dragBehavior = d3.drag()
                .filter(function (event) {
                    const target = event.target;
                    if (target && (target.closest('.vqd-flow-expand-btn') || target.closest('.vqd-flow-step-badge'))) {
                        return false;
                    }
                    return !event.button; // Left click only
                })
                .on('start', function (event, d) {
                    if (event.sourceEvent) event.sourceEvent.stopPropagation();
                    d3.select(this).raise();
                    d3.select(this).classed('vqd-dragging', true);
                })
                .on('drag', function (event, d) {
                    if (event.sourceEvent) event.sourceEvent.stopPropagation();
                    d.x = (d.x || 0) + event.dx;
                    d.y = (d.y || 0) + event.dy;
                    this.setAttribute('transform', `translate(${d.x}, ${d.y})`);
                    self._updateFlowEdgesRealtime();
                })
                .on('end', function (event, d) {
                    if (event.sourceEvent) event.sourceEvent.stopPropagation();
                    d3.select(this).classed('vqd-dragging', false);
                    self.onModelChange('flow-node-moved', { nodeId: d.id, x: d.x, y: d.y });
                });

            mergedSel.call(dragBehavior);

            // Render each card body
            mergedSel.each(function (d) {
                self._renderSingleFlowNodeCard(d3.select(this), d);
            });
        }

        _renderSingleFlowNodeCard(gCard, node) {
            const self = this;
            gCard.selectAll('*').remove();

            const isFocused = this.focusedNodeId === node.id;
            gCard.classed('vqd-flow-focused', isFocused);

            // Card click focus & dependency path highlight
            gCard.on('click', (event) => {
                event.stopPropagation();
                self._focusFlowNode(node);
            });

            // Visual configuration per Node Type (Section 4.1 & Phase 4)
            const typeConfig = {
                Table: { color: '#2563eb', icon: '\uf0ce', label: 'TABLE', borderStyle: 'solid' },
                View: { color: '#0284c7', icon: '\uf06e', label: 'VIEW', borderStyle: 'solid' },
                CTE: { color: '#8b5cf6', icon: '\uf5fd', label: 'CTE', borderStyle: 'solid' },
                DerivedTable: { color: '#0d9488', icon: '\uf009', label: 'DERIVED', borderStyle: 'dashed' },
                Subquery: { color: '#6366f1', icon: '\uf126', label: 'SUBQUERY', borderStyle: 'dashed' },
                Union: { color: '#f59e0b', icon: '\uf387', label: node.metadata?.operator || 'UNION', borderStyle: 'solid' },
                Join: { color: '#10b981', icon: '\uf542', label: node.metadata?.joinType || 'JOIN', borderStyle: 'solid' },
                Filter: { color: '#f43f5e', icon: '\uf0b0', label: node.metadata?.filterType || 'FILTER', borderStyle: 'solid' },
                Aggregate: { color: '#ec4899', icon: '\uf1ec', label: 'AGGREGATE', borderStyle: 'solid' },
                FinalResult: { color: '#16a34a', icon: '\uf11e', label: 'RESULT', borderStyle: 'solid' },
                Sort: { color: '#64748b', icon: '\uf160', label: 'SORT', borderStyle: 'solid' },
                Distinct: { color: '#64748b', icon: '\uf069', label: 'DISTINCT', borderStyle: 'solid' },
                Unknown: { color: '#64748b', icon: '\uf05a', label: 'UNKNOWN', borderStyle: 'solid' }
            };

            const cfg = typeConfig[node.nodeType] || typeConfig.Unknown;
            const isTableLike = node.nodeType === 'Table' || node.nodeType === 'View' || node.nodeType === 'CTE' || node.nodeType === 'DerivedTable';
            const allCols = node.columns || [];
            const displayCols = node.isExpanded ? allCols.slice(0, 4) : [];
            const hasCols = displayCols.length > 0;

            const width = node._width || (isTableLike ? 220 : 200);
            const baseHeight = isTableLike ? 68 : 58;
            const height = node._height || (hasCols ? baseHeight + (displayCols.length * 18) + 6 : baseHeight);
            node._width = width;
            node._height = height;

            // Card Background Rect
            const bgRect = gCard.append('rect')
                .attr('class', 'vqd-flow-node-bg')
                .attr('width', width)
                .attr('height', height)
                .attr('rx', 8)
                .attr('ry', 8)
                .attr('stroke', cfg.color)
                .attr('filter', 'url(#vqd-card-shadow)');

            if (cfg.borderStyle === 'dashed') {
                bgRect.attr('stroke-dasharray', '5 3');
            }

            // Header Background Bar (26px height)
            gCard.append('rect')
                .attr('class', 'vqd-flow-header-bg')
                .attr('width', width)
                .attr('height', 26)
                .attr('rx', 8)
                .attr('ry', 8)
                .attr('fill', cfg.color)
                .attr('opacity', 0.16);

            // Accent bar on left edge
            gCard.append('rect')
                .attr('class', 'vqd-flow-accent-bar')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', 4)
                .attr('height', height)
                .attr('rx', 2)
                .attr('fill', cfg.color);

            // Node Icon
            gCard.append('text')
                .attr('class', 'vqd-flow-node-icon fa-solid')
                .attr('x', 12)
                .attr('y', 18)
                .attr('fill', cfg.color)
                .text(cfg.icon);

            // Node Label / Title
            const titleText = gCard.append('text')
                .attr('class', 'vqd-flow-node-title')
                .attr('x', 30)
                .attr('y', 17)
                .attr('fill', 'var(--ide-text-main, #d4d4d4)')
                .attr('font-size', '12px')
                .attr('font-weight', '600')
                .text(node.label || node.nodeType);

            titleText.append('title').text(`${node.nodeType}: ${node.label}\n${node.sqlFragment || ''}`);

            // Type Badge on Top-Right
            const badgeW = Math.max(48, cfg.label.length * 6.5 + 10);
            const gTypeBadge = gCard.append('g')
                .attr('class', 'vqd-flow-type-badge')
                .attr('transform', `translate(${width - badgeW - 8}, 6)`);

            gTypeBadge.append('rect')
                .attr('width', badgeW)
                .attr('height', 14)
                .attr('rx', 4)
                .attr('fill', cfg.color)
                .attr('opacity', 0.22);

            gTypeBadge.append('text')
                .attr('x', badgeW / 2)
                .attr('y', 10.5)
                .attr('text-anchor', 'middle')
                .attr('font-size', '9px')
                .attr('font-weight', '700')
                .attr('fill', cfg.color)
                .text(cfg.label);

            // Subtitle / Subtext row (y = 44)
            let subText = '';
            if (isTableLike) {
                subText = node.schema ? `${node.schema}.${node.tableName || node.label}` : (node.tableName || node.alias || '');
                if (node.alias && node.alias !== node.tableName) {
                    subText += ` (as ${node.alias})`;
                }
            } else if (node.nodeType === 'Filter') {
                subText = node.metadata?.filterType ? `${node.metadata.filterType} condition` : (node.sqlFragment ? node.sqlFragment.slice(0, 26) : 'Filter');
            } else if (node.nodeType === 'Aggregate') {
                const gb = node.metadata?.groupByCols;
                subText = Array.isArray(gb) && gb.length > 0 ? `GROUP BY ${gb.slice(0, 2).join(', ')}` : 'Aggregations';
            } else if (node.nodeType === 'Join') {
                subText = node.metadata?.joinType ? `${node.metadata.joinType} JOIN` : 'Join condition';
            } else if (node.nodeType === 'FinalResult') {
                subText = 'Final Query Output';
            } else if (node.nodeType === 'Union') {
                subText = 'Combine Result Sets';
            } else {
                subText = node.sqlFragment ? node.sqlFragment.slice(0, 26) : '';
            }

            if (subText) {
                const subEl = gCard.append('text')
                    .attr('class', 'vqd-flow-node-subtitle')
                    .attr('x', 12)
                    .attr('y', 44)
                    .attr('font-size', '11px')
                    .attr('fill', 'var(--ide-text-muted, #858585)')
                    .text(subText.length > 28 ? subText.slice(0, 28) + '...' : subText);

                subEl.append('title').text(subText);
            }

            // Render columns preview if present
            if (hasCols) {
                const gCols = gCard.append('g')
                    .attr('class', 'vqd-flow-node-cols')
                    .attr('transform', `translate(12, 54)`);

                displayCols.forEach((col, idx) => {
                    const rowY = idx * 18 + 12;
                    const gColRow = gCols.append('g').attr('transform', `translate(0, ${rowY})`);
                    
                    if (col.isPk) {
                        gColRow.append('text')
                            .attr('class', 'fa-solid')
                            .attr('x', 0)
                            .attr('y', 0)
                            .attr('font-size', '10px')
                            .attr('fill', '#f59e0b')
                            .text('\uf084');
                    } else {
                        gColRow.append('circle')
                            .attr('cx', 4)
                            .attr('cy', -3)
                            .attr('r', 2)
                            .attr('fill', 'var(--ide-text-muted, #858585)');
                    }

                    gColRow.append('text')
                        .attr('x', 14)
                        .attr('y', 0)
                        .attr('font-size', '10.5px')
                        .attr('fill', 'var(--ide-text-main, #d4d4d4)')
                        .text(col.name.length > 20 ? col.name.slice(0, 20) + '...' : col.name);
                });

                if (allCols.length > displayCols.length) {
                    gCols.append('text')
                        .attr('x', 14)
                        .attr('y', displayCols.length * 18 + 10)
                        .attr('font-size', '9.5px')
                        .attr('font-style', 'italic')
                        .attr('fill', 'var(--ide-text-muted, #858585)')
                        .text(`+${allCols.length - displayCols.length} more columns`);
                }
            }

            // Expand/Collapse toggle button for expandable subqueries
            if (node.isExpandable) {
                const gExpBtn = gCard.append('g')
                    .attr('class', 'vqd-flow-expand-btn')
                    .attr('transform', `translate(${width - 20}, ${height - 18})`)
                    .style('cursor', 'pointer');

                gExpBtn.append('circle')
                    .attr('r', 7)
                    .attr('fill', cfg.color)
                    .attr('opacity', 0.25);

                gExpBtn.append('text')
                    .attr('class', 'fa-solid')
                    .attr('text-anchor', 'middle')
                    .attr('y', 3.5)
                    .attr('font-size', '9px')
                    .attr('fill', cfg.color)
                    .text(node.isExpanded ? '\uf068' : '\uf067'); // minus vs plus

                gExpBtn.on('click', (event) => {
                    event.stopPropagation();
                    node.isExpanded = !node.isExpanded;
                    self.applyFlowTopologicalLayout(true);
                });
            }

            // Step Badge [1], [2], [3] on top-left corner (Section 8.3 & Phase 4)
            const stepNum = node.logicalStep || 1;
            const stepText = `[${stepNum}]`;
            const badgeStepW = Math.max(28, stepText.length * 7 + 8);
            const gStep = gCard.append('g')
                .attr('class', 'vqd-flow-step-badge')
                .attr('transform', `translate(8, -9)`);

            gStep.append('rect')
                .attr('class', 'vqd-flow-step-badge-rect')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', badgeStepW)
                .attr('height', 18)
                .attr('rx', 9)
                .attr('fill', 'var(--ide-bg-sidebar, #252526)')
                .attr('stroke', cfg.color)
                .attr('stroke-width', 1.8);

            gStep.append('text')
                .attr('class', 'vqd-flow-step-badge-text')
                .attr('x', badgeStepW / 2)
                .attr('y', 12.5)
                .attr('text-anchor', 'middle')
                .attr('font-size', '10px')
                .attr('font-weight', '700')
                .attr('fill', '#ffffff')
                .text(stepText);

            // Input port on left-center
            if (node.nodeType !== 'Table' && node.nodeType !== 'View') {
                gCard.append('circle')
                    .attr('class', 'vqd-flow-port vqd-flow-port-in')
                    .attr('cx', 0)
                    .attr('cy', height / 2)
                    .attr('r', 4.5)
                    .attr('fill', 'var(--ide-bg-sidebar, #252526)')
                    .attr('stroke', cfg.color)
                    .attr('stroke-width', 1.5);
            }

            // Output port on right-center
            if (node.nodeType !== 'FinalResult') {
                gCard.append('circle')
                    .attr('class', 'vqd-flow-port vqd-flow-port-out')
                    .attr('cx', width)
                    .attr('cy', height / 2)
                    .attr('r', 4.5)
                    .attr('fill', 'var(--ide-bg-sidebar, #252526)')
                    .attr('stroke', cfg.color)
                    .attr('stroke-width', 1.5);
            }
        }

        _renderFlowEdges() {
            const self = this;
            const edges = this._getFlowEdgesArray();

            const edgeSel = this.gFlowEdges.selectAll('.vqd-flow-edge-group')
                .data(edges, d => d.id);

            edgeSel.exit().remove();

            const enterSel = edgeSel.enter()
                .append('g')
                .attr('class', 'vqd-flow-edge-group')
                .attr('data-edge-id', d => d.id);

            enterSel.append('path')
                .attr('class', 'vqd-flow-edge-path');

            // Edge label badge
            const gLabel = enterSel.append('g')
                .attr('class', 'vqd-flow-edge-label-group')
                .style('display', d => (d.label || d.edgeType === 'recursive_cycle') ? null : 'none');

            gLabel.append('rect')
                .attr('class', 'vqd-flow-edge-label-rect')
                .attr('rx', 4)
                .attr('ry', 4);

            gLabel.append('text')
                .attr('class', 'vqd-flow-edge-label-text')
                .attr('text-anchor', 'middle')
                .attr('y', 3.5);

            const mergedSel = enterSel.merge(edgeSel);

            mergedSel.each(function (edge) {
                const grp = d3.select(this);
                const pathEl = grp.select('.vqd-flow-edge-path');
                const edgeType = edge.edgeType || 'data_flow';

                // Choose marker
                let markerId = 'vqd-flow-arrow-data-flow';
                if (edgeType === 'union_branch') markerId = 'vqd-flow-arrow-union';
                else if (edgeType === 'cte_reference') markerId = 'vqd-flow-arrow-cte';
                else if (edgeType === 'subquery_input') markerId = 'vqd-flow-arrow-subquery';
                else if (edgeType === 'join_input') markerId = 'vqd-flow-arrow-join';
                else if (edgeType === 'dependency') markerId = 'vqd-flow-arrow-dependency';
                else if (edgeType === 'recursive_cycle' || edge.metadata?.isCycle) markerId = 'vqd-flow-arrow-recursive';

                pathEl.attr('marker-end', `url(#${markerId})`)
                      .attr('class', `vqd-flow-edge-path vqd-edge-type-${edgeType}`);

                if (edge.label || edgeType === 'recursive_cycle') {
                    const lbl = edge.label || (edgeType === 'recursive_cycle' ? 'Recursive' : '');
                    grp.select('.vqd-flow-edge-label-text').text(lbl);
                    const textWidth = Math.max(34, lbl.length * 6.8 + 12);
                    grp.select('.vqd-flow-edge-label-rect')
                        .attr('x', -textWidth / 2)
                        .attr('y', -8)
                        .attr('width', textWidth)
                        .attr('height', 16);
                    grp.select('.vqd-flow-edge-label-group').style('display', null);
                } else {
                    grp.select('.vqd-flow-edge-label-group').style('display', 'none');
                }

                self._updateFlowEdgePath(grp, edge);
            });
        }

        _updateFlowEdgesRealtime() {
            const self = this;
            this.gFlowEdges.selectAll('.vqd-flow-edge-group').each(function (edge) {
                self._updateFlowEdgePath(d3.select(this), edge);
            });
        }

        _updateFlowEdgePath(edgeGroup, edge) {
            const srcNode = this._getFlowNode(edge.sourceNodeId);
            const tgtNode = this._getFlowNode(edge.targetNodeId);
            if (!srcNode || !tgtNode) return;

            const srcW = srcNode._width || 210;
            const srcH = srcNode._height || 60;
            const tgtW = tgtNode._width || 210;
            const tgtH = tgtNode._height || 60;

            const x1 = (srcNode.x || 0) + srcW;
            const y1 = (srcNode.y || 0) + (srcH / 2);
            const x2 = (tgtNode.x || 0);
            const y2 = (tgtNode.y || 0) + (tgtH / 2);

            let dStr = '';
            let labelX = (x1 + x2) / 2;
            let labelY = (y1 + y2) / 2;

            const isSelfLoop = srcNode.id === tgtNode.id;
            const isBackEdge = x2 <= x1 && !isSelfLoop;

            if (isSelfLoop) {
                // Loop out right, loop back over top, enter left
                const loopW = 45;
                const loopH = 35;
                dStr = `M ${x1} ${y1} C ${x1 + loopW} ${y1 - 10}, ${x1 + loopW} ${srcNode.y - loopH}, ${srcNode.x + srcW / 2} ${srcNode.y - loopH} C ${tgtNode.x - loopW} ${srcNode.y - loopH}, ${tgtNode.x - 20} ${y2 - 10}, ${x2} ${y2}`;
                labelX = srcNode.x + srcW / 2;
                labelY = srcNode.y - loopH - 4;
            } else if (isBackEdge) {
                // Arc underneath or over
                const offset = 55;
                dStr = `M ${x1} ${y1} C ${x1 + offset} ${y1 + offset}, ${x2 - offset} ${y2 + offset}, ${x2} ${y2}`;
                labelX = (x1 + x2) / 2;
                labelY = Math.max(y1, y2) + offset / 2;
            } else {
                // Standard forward cubic bezier
                const dx = Math.max(45, (x2 - x1) * 0.45);
                dStr = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                labelX = (x1 + x2) / 2;
                labelY = (y1 + y2) / 2;
            }

            edgeGroup.select('.vqd-flow-edge-path').attr('d', dStr);
            edgeGroup.select('.vqd-flow-edge-label-group').attr('transform', `translate(${labelX}, ${labelY})`);
        }

        _focusFlowNode(node) {
            if (!node) {
                this._clearFlowFocus();
                this.onNodeSelect(null);
                return;
            }

            this.focusedNodeId = node.id;

            // Traverse upstream (predecessors)
            const upstreamNodeIds = new Set();
            const qUp = [node.id];
            while (qUp.length > 0) {
                const currId = qUp.shift();
                const inEdges = typeof this.queryModel.flowGraph.getIncomingEdges === 'function'
                    ? this.queryModel.flowGraph.getIncomingEdges(currId)
                    : this._getFlowEdgesArray().filter(e => e.targetNodeId === currId);

                inEdges.forEach(e => {
                    if (!upstreamNodeIds.has(e.sourceNodeId)) {
                        upstreamNodeIds.add(e.sourceNodeId);
                        qUp.push(e.sourceNodeId);
                    }
                });
            }

            // Traverse downstream (successors)
            const downstreamNodeIds = new Set();
            const qDown = [node.id];
            while (qDown.length > 0) {
                const currId = qDown.shift();
                const outEdges = typeof this.queryModel.flowGraph.getOutgoingEdges === 'function'
                    ? this.queryModel.flowGraph.getOutgoingEdges(currId)
                    : this._getFlowEdgesArray().filter(e => e.sourceNodeId === currId);

                outEdges.forEach(e => {
                    if (!downstreamNodeIds.has(e.targetNodeId)) {
                        downstreamNodeIds.add(e.targetNodeId);
                        qDown.push(e.targetNodeId);
                    }
                });
            }

            const connectedNodeIds = new Set([node.id, ...upstreamNodeIds, ...downstreamNodeIds]);
            const connectedEdgeIds = new Set();
            this._getFlowEdgesArray().forEach(e => {
                if (connectedNodeIds.has(e.sourceNodeId) && connectedNodeIds.has(e.targetNodeId)) {
                    connectedEdgeIds.add(e.id);
                }
            });

            // Update nodes styling
            this.gFlowNodes.selectAll('.vqd-flow-node').each(function (d) {
                const sel = d3.select(this);
                const isSelf = d.id === node.id;
                const isConnected = connectedNodeIds.has(d.id);
                sel.classed('vqd-flow-focused', isSelf)
                   .classed('vqd-flow-connected', !isSelf && isConnected)
                   .classed('vqd-flow-dimmed', !isConnected);
            });

            // Update edges styling
            this.gFlowEdges.selectAll('.vqd-flow-edge-group').each(function (e) {
                const sel = d3.select(this);
                const isHighlighted = connectedEdgeIds.has(e.id);
                sel.classed('vqd-edge-highlighted', isHighlighted)
                   .classed('vqd-flow-dimmed', !isHighlighted);
            });

            this.onNodeSelect(node);
        }

        _clearFlowFocus() {
            this.focusedNodeId = null;
            this.gFlowNodes.selectAll('.vqd-flow-node')
                .classed('vqd-flow-focused', false)
                .classed('vqd-flow-connected', false)
                .classed('vqd-flow-dimmed', false);

            this.gFlowEdges.selectAll('.vqd-flow-edge-group')
                .classed('vqd-edge-highlighted', false)
                .classed('vqd-flow-dimmed', false);
        }

        focusNode(nodeId, panTo = true) {
            if (!nodeId) {
                if (this.activeViewTab === 'physical') {
                    this._clearPlanFocus();
                    this.onOperatorSelect(null);
                } else {
                    this._clearFlowFocus();
                    this.onNodeSelect(null);
                }
                return;
            }

            if (this.activeViewTab === 'physical') {
                const opNode = this.physicalPlan?.nodes?.find(n => n.id === nodeId || String(n.node_id) === String(nodeId));
                if (opNode) {
                    this._focusPlanOperator(opNode);
                    if (panTo && typeof opNode.x === 'number' && typeof opNode.y === 'number') {
                        this._panToCoords(opNode.x + (opNode._width || 220) / 2, opNode.y + (opNode._height || 80) / 2);
                    }
                }
                return;
            }

            const node = this._getFlowNode(nodeId);
            if (!node) return;

            this._focusFlowNode(node);

            if (panTo && typeof node.x === 'number' && typeof node.y === 'number') {
                const nw = node._width || 210;
                const nh = node._height || 60;
                this._panToCoords(node.x + nw / 2, node.y + nh / 2);
            }
        }

        _panToCoords(cx, cy) {
            const clientRect = this.container.getBoundingClientRect();
            const cw = clientRect.width || 800;
            const ch = clientRect.height || 600;
            const currentScale = this.currentTransform?.k || 1.0;
            const transX = (cw / 2) - (cx * currentScale);
            const transY = (ch / 2) - (cy * currentScale);
            const transform = d3.zoomIdentity.translate(transX, transY).scale(currentScale);
            this.svg.transition().duration(350).call(this.zoomBehavior.transform, transform);
        }

        applyFlowTopologicalLayout(force = true) {
            if (!this.queryModel || !this.queryModel.flowGraph) return;
            const nodes = this._getFlowNodesArray();
            if (nodes.length === 0) return;
            const edges = this._getFlowEdgesArray();

            if (!force) {
                const hasExisting = nodes.some(n => typeof n.x === 'number' && typeof n.y === 'number' && (n.x !== 0 || n.y !== 0));
                if (hasExisting) return;
            }

            // Precalculate dimensions
            nodes.forEach(n => {
                const isTableLike = n.nodeType === 'Table' || n.nodeType === 'View' || n.nodeType === 'CTE' || n.nodeType === 'DerivedTable';
                const colCount = (n.columns || []).length;
                const h = isTableLike ? (colCount > 0 ? Math.min(130, 48 + Math.min(colCount, 4) * 18 + 14) : 68) : 58;
                n._width = isTableLike ? 220 : 200;
                n._height = h;
            });

            // Topological Rank computation (Sugiyama layer assignment)
            const inDegree = new Map();
            const adj = new Map();

            nodes.forEach(n => {
                inDegree.set(n.id, 0);
                adj.set(n.id, []);
            });

            edges.forEach(e => {
                if (e.edgeType === 'recursive_cycle' || e.metadata?.isCycle) return;
                if (inDegree.has(e.targetNodeId) && inDegree.has(e.sourceNodeId)) {
                    inDegree.set(e.targetNodeId, inDegree.get(e.targetNodeId) + 1);
                    adj.get(e.sourceNodeId).push(e.targetNodeId);
                }
            });

            // Root nodes
            let roots = nodes.filter(n => inDegree.get(n.id) === 0);
            if (roots.length === 0) roots = [nodes[0]];

            const ranks = new Map();
            roots.forEach(r => ranks.set(r.id, 0));

            const queue = [...roots];
            const visited = new Set(roots.map(r => r.id));

            while (queue.length > 0) {
                const curr = queue.shift();
                const currRank = ranks.get(curr.id) || 0;
                const targets = adj.get(curr.id) || [];

                for (const tgtId of targets) {
                    const nextRank = currRank + 1;
                    if (!ranks.has(tgtId) || nextRank > ranks.get(tgtId)) {
                        ranks.set(tgtId, nextRank);
                    }
                    if (!visited.has(tgtId)) {
                        visited.add(tgtId);
                        const tgtNode = this._getFlowNode(tgtId);
                        if (tgtNode) queue.push(tgtNode);
                    }
                }
            }

            // Fallback for any disconnected nodes
            nodes.forEach(n => {
                if (!ranks.has(n.id)) ranks.set(n.id, 0);
            });

            // Ensure FinalResult is always at the last rank
            let maxRank = 0;
            nodes.forEach(n => {
                if (n.nodeType !== 'FinalResult') {
                    maxRank = Math.max(maxRank, ranks.get(n.id) || 0);
                }
            });
            nodes.forEach(n => {
                if (n.nodeType === 'FinalResult') {
                    ranks.set(n.id, maxRank + 1);
                }
            });

            // Group into rank buckets
            const rankBuckets = new Map();
            nodes.forEach(n => {
                const r = ranks.get(n.id) || 0;
                if (!rankBuckets.has(r)) rankBuckets.set(r, []);
                rankBuckets.get(r).push(n);
            });

            const sortedRanks = Array.from(rankBuckets.keys()).sort((a, b) => a - b);

            const START_X = 60;
            const START_Y = 60;
            const COL_WIDTH = 230;
            const HORIZONTAL_GAP = 95;
            const VERTICAL_GAP = 28;

            // Sort nodes in each rank stably by logicalStep or sourceOrder
            sortedRanks.forEach(r => {
                const colNodes = rankBuckets.get(r);
                colNodes.sort((a, b) => {
                    const stepA = a.logicalStep || 0;
                    const stepB = b.logicalStep || 0;
                    if (stepA !== stepB) return stepA - stepB;
                    return (a.sourceOrder || 0) - (b.sourceOrder || 0);
                });
            });

            // Find max column height for vertical centering
            let maxColH = 0;
            sortedRanks.forEach(r => {
                const colNodes = rankBuckets.get(r);
                let h = 0;
                colNodes.forEach(n => { h += (n._height || 60) + VERTICAL_GAP; });
                maxColH = Math.max(maxColH, h);
            });

            sortedRanks.forEach((r, colIdx) => {
                const colNodes = rankBuckets.get(r);
                const colX = START_X + colIdx * (COL_WIDTH + HORIZONTAL_GAP);

                let colH = 0;
                colNodes.forEach(n => { colH += (n._height || 60) + VERTICAL_GAP; });
                const colStartY = START_Y + Math.max(0, (maxColH - colH) / 2);

                let curY = colStartY;
                colNodes.forEach(n => {
                    n.x = colX;
                    n.y = curY;
                    curY += (n._height || 60) + VERTICAL_GAP;
                });
            });

            this.render(this.queryModel);
            this.zoomFit();
            this.onModelChange('auto-layout', {});
        }

        toggleStepNumbers(show) {
            if (typeof show === 'boolean') {
                this.showStepNumbers = show;
            } else {
                this.showStepNumbers = !this.showStepNumbers;
            }
            this.gFlowNodes.classed('vqd-hide-step-badges', !this.showStepNumbers);
            return this.showStepNumbers;
        }

        toggleLegend(show) {
            if (typeof show === 'boolean') {
                this.showLegend = show;
            } else {
                this.showLegend = !this.showLegend;
            }
            this._renderFlowLegend();
            return this.showLegend;
        }

        _renderFlowLegend() {
            let legendEl = this.container.querySelector('.vqd-flow-legend');
            if (!this.showLegend) {
                if (legendEl) legendEl.remove();
                return;
            }
            if (!legendEl) {
                legendEl = document.createElement('div');
                legendEl.className = 'vqd-flow-legend';
                this.container.appendChild(legendEl);
            }
            legendEl.innerHTML = `
                <div class="vqd-legend-header">
                    <span><i class="fa-solid fa-circle-info me-1 text-primary"></i>Query Flow Legend</span>
                    <button type="button" class="btn-close btn-close-sm vqd-btn-close-legend" aria-label="Close"></button>
                </div>
                <div class="vqd-legend-items">
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#2563eb;"></span><i class="fa-solid fa-table me-1"></i>Table / View</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#8b5cf6;"></span><i class="fa-solid fa-layer-group me-1"></i>CTE (Common Table Expr)</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#0d9488; border:1px dashed #0d9488;"></span><i class="fa-solid fa-table-cells-large me-1"></i>Derived Table (FROM Subquery)</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#6366f1; border:1px dashed #6366f1;"></span><i class="fa-solid fa-code-branch me-1"></i>Subquery (Scalar / Filter)</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#f59e0b;"></span><i class="fa-solid fa-code-merge me-1"></i>UNION / UNION ALL</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#10b981;"></span><i class="fa-solid fa-diagram-project me-1"></i>Join Operation</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#f43f5e;"></span><i class="fa-solid fa-filter me-1"></i>Filter (EXISTS / WHERE)</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#ec4899;"></span><i class="fa-solid fa-calculator me-1"></i>Aggregate (GROUP BY)</div>
                    <div class="vqd-legend-item"><span class="vqd-legend-swatch" style="background:#16a34a;"></span><i class="fa-solid fa-flag-checkered me-1"></i>Final Result</div>
                    <div class="vqd-legend-item pt-1 border-top"><span class="badge bg-secondary text-white me-1">[1]</span>Logical Step Order</div>
                </div>
            `;
            legendEl.querySelector('.vqd-btn-close-legend')?.addEventListener('click', () => {
                this.toggleLegend(false);
            });
        }

        // ==========================================
        // Phase 6: Physical Execution Plan Renderer
        // ==========================================

        renderPhysicalPlan(planData) {
            if (!planData) return;
            this.physicalPlan = planData;
            this.activeViewTab = 'physical';

            // Hide logical and table layers
            this.gJoins.style('display', 'none');
            this.gDragLink.style('display', 'none');
            this.gTables.style('display', 'none');
            this.gFlowEdges.style('display', 'none');
            this.gFlowNodes.style('display', 'none');

            // Show physical plan layers
            this.gPlanEdges.style('display', null);
            this.gPlanNodes.style('display', null);

            // Compute topological rank & coordinates
            this._layoutPhysicalPlan(planData);

            // Render Edges & Nodes
            this._renderPhysicalPlanEdges(planData);
            this._renderPhysicalPlanNodes(planData);

            this.zoomFit();
        }

        switchToGraphView() {
            this.activeViewTab = 'logical';
            this.gPlanEdges.style('display', 'none');
            this.gPlanNodes.style('display', 'none');
            this.render(this.queryModel);
        }

        _layoutPhysicalPlan(planData) {
            if (!planData || !Array.isArray(planData.nodes) || planData.nodes.length === 0) return;
            const nodes = planData.nodes;
            const edges = planData.edges || [];

            nodes.forEach(n => {
                n._width = 220;
                n._height = 80;
            });

            // Build child-to-parent and parent-to-children maps
            // In edges: source_id is child (producer), target_id is parent (consumer)
            const parentsOf = new Map();
            const childrenOf = new Map();

            nodes.forEach(n => {
                parentsOf.set(n.id, []);
                childrenOf.set(n.id, []);
            });

            edges.forEach(e => {
                if (parentsOf.has(e.source_id) && childrenOf.has(e.target_id)) {
                    parentsOf.get(e.source_id).push(e.target_id);
                    childrenOf.get(e.target_id).push(e.source_id);
                }
            });

            // Leaves have no children (scans/seeks) -> rank 0
            const ranks = new Map();
            const leaves = nodes.filter(n => (childrenOf.get(n.id) || []).length === 0);
            leaves.forEach(l => ranks.set(l.id, 0));

            // Iterative rank assignment: rank(parent) >= max(rank(child)) + 1
            let changed = true;
            let iterations = 0;
            while (changed && iterations < nodes.length * 2) {
                changed = false;
                iterations++;
                nodes.forEach(n => {
                    const children = childrenOf.get(n.id) || [];
                    if (children.length > 0) {
                        let maxChildRank = 0;
                        children.forEach(cId => {
                            if (ranks.has(cId)) {
                                maxChildRank = Math.max(maxChildRank, ranks.get(cId));
                            }
                        });
                        const nextRank = maxChildRank + 1;
                        if (!ranks.has(n.id) || ranks.get(n.id) < nextRank) {
                            ranks.set(n.id, nextRank);
                            changed = true;
                        }
                    }
                });
            }

            nodes.forEach(n => {
                if (!ranks.has(n.id)) ranks.set(n.id, 0);
            });

            // Group into rank buckets
            const rankBuckets = new Map();
            nodes.forEach(n => {
                const r = ranks.get(n.id) || 0;
                if (!rankBuckets.has(r)) rankBuckets.set(r, []);
                rankBuckets.get(r).push(n);
            });

            const sortedRanks = Array.from(rankBuckets.keys()).sort((a, b) => a - b);

            const START_X = 60;
            const START_Y = 60;
            const COL_WIDTH = 220;
            const HORIZONTAL_GAP = 95;
            const VERTICAL_GAP = 28;

            sortedRanks.forEach(r => {
                const colNodes = rankBuckets.get(r);
                colNodes.sort((a, b) => (b.cost_percent || 0) - (a.cost_percent || 0));
            });

            let maxColH = 0;
            sortedRanks.forEach(r => {
                const colNodes = rankBuckets.get(r);
                let h = 0;
                colNodes.forEach(n => { h += (n._height || 80) + VERTICAL_GAP; });
                maxColH = Math.max(maxColH, h);
            });

            sortedRanks.forEach((r, colIdx) => {
                const colNodes = rankBuckets.get(r);
                const colX = START_X + colIdx * (COL_WIDTH + HORIZONTAL_GAP);
                let colH = 0;
                colNodes.forEach(n => { colH += (n._height || 80) + VERTICAL_GAP; });
                const colStartY = START_Y + Math.max(0, (maxColH - colH) / 2);

                let curY = colStartY;
                colNodes.forEach(n => {
                    n.x = colX;
                    n.y = curY;
                    curY += (n._height || 80) + VERTICAL_GAP;
                });
            });
        }

        _renderPhysicalPlanNodes(planData) {
            const self = this;
            const nodes = planData.nodes || [];

            const nodeSel = this.gPlanNodes.selectAll('.vqd-plan-node')
                .data(nodes, d => d.id);

            nodeSel.exit().remove();

            const enterSel = nodeSel.enter()
                .append('g')
                .attr('class', d => `vqd-plan-node vqd-cost-severity-${d.cost_severity || 'low'}`)
                .attr('data-op-id', d => d.id);

            // Node background rect
            enterSel.append('rect')
                .attr('class', 'vqd-plan-node-rect')
                .attr('width', 220)
                .attr('height', 80)
                .attr('rx', 8)
                .attr('ry', 8);

            // Header strip
            const gHeader = enterSel.append('g').attr('class', 'vqd-plan-header');

            gHeader.append('text')
                .attr('class', 'vqd-plan-icon')
                .attr('x', 10)
                .attr('y', 20)
                .text(d => self._getOperatorIconChar(d.operator_type || d.physical_op));

            gHeader.append('text')
                .attr('class', 'vqd-plan-title')
                .attr('x', 28)
                .attr('y', 20)
                .text(d => {
                    const name = d.physical_op || d.operator_type || 'Operator';
                    return name.length > 17 ? name.substring(0, 16) + '…' : name;
                });

            // Cost % Badge
            const gCost = gHeader.append('g').attr('class', 'vqd-plan-cost-badge')
                .attr('transform', 'translate(158, 7)');
            gCost.append('rect')
                .attr('class', 'vqd-plan-cost-rect')
                .attr('width', 52)
                .attr('height', 16)
                .attr('rx', 4);
            gCost.append('text')
                .attr('class', 'vqd-plan-cost-text')
                .attr('x', 26)
                .attr('y', 11)
                .attr('text-anchor', 'middle')
                .text(d => `${d.cost_percent || 0}%`);

            // Divider line
            enterSel.append('line')
                .attr('class', 'vqd-plan-divider')
                .attr('x1', 0).attr('y1', 28)
                .attr('x2', 220).attr('y2', 28);

            // Body: Relation / Logical op
            enterSel.append('text')
                .attr('class', 'vqd-plan-relation')
                .attr('x', 10)
                .attr('y', 44)
                .text(d => {
                    if (d.relation_name) {
                        const rel = d.schema ? `${d.schema}.${d.relation_name}` : d.relation_name;
                        return rel.length > 25 ? rel.substring(0, 24) + '…' : rel;
                    }
                    return d.logical_op || '';
                });

            // Rows count
            enterSel.append('text')
                .attr('class', 'vqd-plan-stats')
                .attr('x', 10)
                .attr('y', 59)
                .text(d => {
                    const est = typeof d.estimated_rows === 'number' ? Math.round(d.estimated_rows).toLocaleString() : '0';
                    if (d.actual_rows !== null && d.actual_rows !== undefined) {
                        const act = Math.round(d.actual_rows).toLocaleString();
                        return `Rows: ${act} (est: ${est})`;
                    }
                    return `Est. Rows: ${est}`;
                });

            // Timing (if actual plan) or Subtree Cost
            enterSel.append('text')
                .attr('class', 'vqd-plan-time-cost')
                .attr('x', 10)
                .attr('y', 73)
                .text(d => {
                    if (d.actual_time_ms !== null && d.actual_time_ms !== undefined) {
                        return `Time: ${d.actual_time_ms} ms | Cost: ${d.operator_cost || 0}`;
                    }
                    return `Cost: ${d.operator_cost || 0} (sub: ${d.subtree_cost || 0})`;
                });

            // Warnings badge
            const gWarn = enterSel.append('g')
                .attr('class', 'vqd-plan-warn-badge')
                .attr('transform', 'translate(198, 54)')
                .style('display', d => (d.warnings && d.warnings.length > 0) ? null : 'none');
            gWarn.append('circle').attr('r', 7).attr('fill', '#f59e0b');
            gWarn.append('text').attr('text-anchor', 'middle').attr('y', 3.5).attr('fill', '#000').attr('font-size', '9px').attr('font-weight', 'bold').text('!');

            // Tooltip
            enterSel.append('title').text(d => {
                let t = `${d.physical_op || d.operator_type}\nCost: ${d.cost_percent}% (Operator Cost: ${d.operator_cost}, Subtree: ${d.subtree_cost})`;
                if (d.relation_name) t += `\nRelation: ${d.relation_name}`;
                if (d.actual_rows !== null && d.actual_rows !== undefined) t += `\nActual Rows: ${d.actual_rows} (Est: ${d.estimated_rows})`;
                else t += `\nEstimated Rows: ${d.estimated_rows}`;
                if (d.actual_time_ms !== null) t += `\nActual Time: ${d.actual_time_ms} ms`;
                if (d.warnings && d.warnings.length > 0) t += `\nWarnings: ${d.warnings.join('; ')}`;
                return t;
            });

            const mergedSel = enterSel.merge(nodeSel);
            mergedSel.attr('transform', d => `translate(${d.x}, ${d.y})`);

            mergedSel.on('click', (event, d) => {
                event.stopPropagation();
                self._focusPlanOperator(d);
            });
        }

        _getOperatorIconChar(opName) {
            const s = String(opName || '').toLowerCase();
            if (s.includes('scan') || s.includes('table') || s.includes('seek')) return '⛁';
            if (s.includes('join') || s.includes('hash') || s.includes('merge') || s.includes('loop')) return '⋈';
            if (s.includes('filter') || s.includes('where')) return '⚚';
            if (s.includes('sort') || s.includes('order')) return '⇅';
            if (s.includes('aggregate') || s.includes('group') || s.includes('count') || s.includes('sum')) return '∑';
            if (s.includes('select') || s.includes('result')) return '⚐';
            return '◈';
        }

        _renderPhysicalPlanEdges(planData) {
            const nodes = planData.nodes || [];
            const nodeMap = new Map(nodes.map(n => [n.id, n]));
            const edges = planData.edges || [];

            const edgeSel = this.gPlanEdges.selectAll('.vqd-plan-edge-group')
                .data(edges, d => d.id);

            edgeSel.exit().remove();

            const enterSel = edgeSel.enter()
                .append('g')
                .attr('class', 'vqd-plan-edge-group')
                .attr('data-edge-id', d => d.id);

            enterSel.append('path')
                .attr('class', 'vqd-plan-edge-path')
                .attr('marker-end', 'url(#vqd-flow-arrow-plan)');

            const gLabel = enterSel.append('g').attr('class', 'vqd-plan-edge-label');
            gLabel.append('rect')
                .attr('class', 'vqd-plan-edge-label-rect')
                .attr('rx', 4).attr('ry', 4);
            gLabel.append('text')
                .attr('class', 'vqd-plan-edge-label-text')
                .attr('text-anchor', 'middle')
                .attr('y', 3.5);

            const mergedSel = enterSel.merge(edgeSel);

            mergedSel.each(function (edge) {
                const grp = d3.select(this);
                const srcNode = nodeMap.get(edge.source_id);
                const tgtNode = nodeMap.get(edge.target_id);
                if (!srcNode || !tgtNode) return;

                const srcW = srcNode._width || 220;
                const srcH = srcNode._height || 80;
                const tgtH = tgtNode._height || 80;

                const x1 = srcNode.x + srcW;
                const y1 = srcNode.y + srcH / 2;
                const x2 = tgtNode.x;
                const y2 = tgtNode.y + tgtH / 2;

                const dx = Math.max(35, (x2 - x1) * 0.45);
                const dStr = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                const rows = edge.actual_rows !== null && edge.actual_rows !== undefined ? edge.actual_rows : (edge.estimated_rows || 0);
                const strokeWidth = Math.max(1.5, Math.min(6, Math.log10(Math.max(1, rows)) * 1.3));

                grp.select('.vqd-plan-edge-path')
                    .attr('d', dStr)
                    .attr('stroke-width', strokeWidth);

                const rowStr = `${Math.round(rows).toLocaleString()} rows`;
                grp.select('.vqd-plan-edge-label-text').text(rowStr);
                const textWidth = Math.max(48, rowStr.length * 6.5 + 12);
                grp.select('.vqd-plan-edge-label-rect')
                    .attr('x', -textWidth / 2)
                    .attr('y', -8)
                    .attr('width', textWidth)
                    .attr('height', 16);

                grp.select('.vqd-plan-edge-label')
                    .attr('transform', `translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2})`);
            });
        }

        _focusPlanOperator(node) {
            if (!node) {
                this._clearPlanFocus();
                this.onOperatorSelect(null);
                return;
            }
            this.focusedOperatorId = node.id;
            this.gPlanNodes.selectAll('.vqd-plan-node')
                .classed('vqd-plan-focused', d => d.id === node.id);
            this.onOperatorSelect(node);
        }

        _clearPlanFocus() {
            this.focusedOperatorId = null;
            this.gPlanNodes.selectAll('.vqd-plan-node').classed('vqd-plan-focused', false);
        }
    }

    SqlVisualization.D3CanvasRenderer = D3CanvasRenderer;
    window.SqlVisualization = SqlVisualization;

})(window);
