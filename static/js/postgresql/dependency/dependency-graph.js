/**
 * PostgreSQL Dependency Graph - D3 Visualization Renderer
 * Implements both D3 Tree Projection and D3 Force Graph Simulation.
 * Features Zoom, Pan, Fit Screen, Node Selection, Expand/Collapse, and Search Highlights.
 */
(function (global) {
    'use strict';

    class PostgresDependencyGraphRenderer {
        constructor(svgElement, options = {}) {
            this.svg = d3.select(svgElement);
            this.options = options;
            this.width = 800;
            this.height = 600;
            this.layout = options.layout || 'tree'; // 'tree' | 'force'

            this.graphData = null;
            this.treeData = null;
            this.selectedNodeId = null;
            this.searchQuery = '';
            this.filterFn = options.filterFn || (() => true);

            this.zoomBehavior = null;
            this.gRoot = null;
            this.simulation = null;

            this.initSvg();
        }

        initSvg() {
            this.svg.selectAll('*').remove();

            // Setup defs (arrow markers, shadows)
            const defs = this.svg.append('defs');

            // Marker for directed edges
            defs.append('marker')
                .attr('id', 'dep-arrow')
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 22)
                .attr('refY', 0)
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .attr('orient', 'auto')
                .append('path')
                .attr('class', 'dep-marker-arrow')
                .attr('d', 'M0,-5L10,0L0,5')
                .attr('fill', 'var(--ide-text-muted, #848c94)');

            defs.append('marker')
                .attr('id', 'dep-arrow-active')
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 22)
                .attr('refY', 0)
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .attr('orient', 'auto')
                .append('path')
                .attr('class', 'dep-marker-arrow-active')
                .attr('d', 'M0,-5L10,0L0,5')
                .attr('fill', 'var(--ide-accent, #CC7832)');

            // Root transform group for Zoom/Pan
            this.gRoot = this.svg.append('g').attr('class', 'dep-zoom-root');

            // Subgroups for links and nodes (Tree)
            this.gLinksTree = this.gRoot.append('g').attr('class', 'dep-links-layer tree-layer');
            this.gNodesTree = this.gRoot.append('g').attr('class', 'dep-nodes-layer tree-layer');

            // Subgroups for links and nodes (Force)
            this.gLinksForce = this.gRoot.append('g').attr('class', 'dep-links-layer force-layer');
            this.gNodesForce = this.gRoot.append('g').attr('class', 'dep-nodes-layer force-layer');

            // Setup D3 Zoom
            this.zoomBehavior = d3.zoom()
                .scaleExtent([0.15, 3.0])
                .on('zoom', (event) => {
                    this.gRoot.attr('transform', event.transform);
                });

            this.svg.call(this.zoomBehavior);

            // Initialize with safe default centering transform
            this.svg.call(
                this.zoomBehavior.transform,
                d3.zoomIdentity.translate(80, (this.height || 600) / 2).scale(1.0)
            );

            // Click canvas to deselect
            this.svg.on('click', (event) => {
                if (event.target === this.svg.node() || event.target.tagName === 'svg') {
                    this.clearSelection();
                }
            });
        }

        setData(graphData, treeData) {
            this.graphData = graphData;
            this.treeData = treeData;
            this.render();
        }

        setLayout(layout) {
            this.layout = layout;
            this.render();
        }

        setFilter(filterFn) {
            this.filterFn = filterFn;
            this.render();
        }

        setSearchQuery(query) {
            this.searchQuery = (query || '').trim().toLowerCase();
            this.applySearchHighlights();
        }

        resize(width, height) {
            if (!width || !height || width <= 50 || height <= 50) {
                const node = this.svg.node();
                if (node && node.parentElement) {
                    const rect = node.parentElement.getBoundingClientRect();
                    if (rect.width > 50 && rect.height > 50) {
                        width = rect.width;
                        height = rect.height;
                    }
                }
            }
            if (width > 50 && height > 50) {
                this.width = width;
                this.height = height;
                this.svg.attr('width', width).attr('height', height);
            }
        }

        render() {
            if (!this.graphData || !this.graphData.root) {
                this.gLinksTree.selectAll('*').remove();
                this.gNodesTree.selectAll('*').remove();
                this.gLinksForce.selectAll('*').remove();
                this.gNodesForce.selectAll('*').remove();
                return;
            }

            if (this.simulation) {
                this.simulation.stop();
                this.simulation = null;
            }

            // Hide unused layers to avoid clashes/stale data
            this.gLinksTree.attr('display', (this.layout === 'tree' || this.layout === 'both') && this.treeData ? null : 'none');
            this.gNodesTree.attr('display', (this.layout === 'tree' || this.layout === 'both') && this.treeData ? null : 'none');
            this.gLinksForce.attr('display', (this.layout === 'force' || this.layout === 'both') ? null : 'none');
            this.gNodesForce.attr('display', (this.layout === 'force' || this.layout === 'both') ? null : 'none');

            // Reset transforms
            this.gLinksTree.attr('transform', null);
            this.gNodesTree.attr('transform', null);
            this.gLinksForce.attr('transform', null);
            this.gNodesForce.attr('transform', null);

            if (this.layout === 'tree' && this.treeData) {
                this.renderTree();
            } else if (this.layout === 'force') {
                this.renderForce();
            } else if (this.layout === 'both' && this.treeData) {
                this.renderTree();
                this.renderForce();
                // Offset groups for split view
                this.gLinksTree.attr('transform', `translate(-${this.width / 4}, 0)`);
                this.gNodesTree.attr('transform', `translate(-${this.width / 4}, 0)`);
                this.gLinksForce.attr('transform', `translate(${this.width / 4}, 0)`);
                this.gNodesForce.attr('transform', `translate(${this.width / 4}, 0)`);
            }
        }

        // ---------------------------------------------------------------------
        // D3 Tree Projection Renderer
        // ---------------------------------------------------------------------

        renderTree() {
            const rawTree = JSON.parse(JSON.stringify(this.treeData));

            // Filter tree hierarchy nodes based on current active filter
            const filterNode = (node) => {
                if (!node) return null;
                if (!this.filterFn(node) && node.level > 0) return null;
                if (node.children && node.children.length > 0) {
                    node.children = node.children.map(filterNode).filter(Boolean);
                }
                return node;
            };

            const filteredTree = filterNode(rawTree);
            if (!filteredTree) return;

            const root = d3.hierarchy(filteredTree);

            // Assign unique ID to every node instance in the tree hierarchy
            let counter = 0;
            root.each(d => {
                d._treeUid = `tn_${++counter}_${d.data?.id || 'node'}`;
            });

            const nodeWidth = 200;
            const nodeHeight = 55;
            const dx = 75; // vertical gap
            const dy = 260; // horizontal gap

            const treeLayout = d3.tree().nodeSize([dx, dy]);
            treeLayout(root);

            // Compute bounds for fitting
            let x0 = Infinity, x1 = -x0;
            root.each(d => {
                if (d.x > x1) x1 = d.x;
                if (d.x < x0) x0 = d.x;
            });

            // 1. Draw Links
            const linkGenerator = d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x);

            const links = this.gLinksTree.selectAll('.dep-tree-link')
                .data(root.links(), d => `${d.source._treeUid}->${d.target._treeUid}`);

            links.exit().remove();

            links.enter()
                .append('path')
                .attr('class', d => `dep-tree-link dep-link ${d.target.data.is_cyclic_ref ? 'indirect possible' : ''}`)
                .merge(links)
                .attr('d', linkGenerator);

            // 2. Draw Nodes
            const nodes = this.gNodesTree.selectAll('.dep-tree-node-group')
                .data(root.descendants(), d => d._treeUid);

            nodes.exit().remove();

            const nodeEnter = nodes.enter()
                .append('g')
                .attr('class', d => `dep-tree-node-group dep-node-group ${d.depth === 0 ? 'root' : ''}`)
                .attr('transform', d => `translate(${d.y},${d.x})`)
                .on('click', (event, d) => {
                    event.stopPropagation();
                    this.selectNode(d.data);
                })
                .on('dblclick', (event, d) => {
                    event.stopPropagation();
                    if (typeof this.options.onNodeDblClick === 'function') {
                        this.options.onNodeDblClick(d.data);
                    }
                });

            // Card background rect
            nodeEnter.append('rect')
                .attr('class', 'dep-node-rect')
                .attr('x', -nodeWidth / 2)
                .attr('y', -nodeHeight / 2)
                .attr('width', nodeWidth)
                .attr('height', nodeHeight);

            // Node Title (Object Name)
            nodeEnter.append('text')
                .attr('class', 'dep-node-title')
                .attr('x', -nodeWidth / 2 + 12)
                .attr('y', -4)
                .text(d => this.truncate(d.data.name, 22));

            // Node Subtitle (Schema + Type)
            nodeEnter.append('text')
                .attr('class', 'dep-node-subtitle')
                .attr('x', -nodeWidth / 2 + 12)
                .attr('y', 14)
                .text(d => `${d.data.schema || 'public'} • ${d.data.object_type}`);

            // Confidence / Level Indicator Badge
            nodeEnter.append('text')
                .attr('class', 'dep-node-badge')
                .attr('x', nodeWidth / 2 - 12)
                .attr('y', -4)
                .attr('text-anchor', 'end')
                .attr('fill', d => this.getConfidenceColor(d.data.confidence))
                .text(d => d.depth === 0 ? 'ROOT' : (d.data.confidence === 'CONFIRMED' ? '✓' : '⚠'));

            // Merge update
            nodes.merge(nodeEnter)
                .attr('transform', d => `translate(${d.y},${d.x})`);

            this.applySearchHighlights();
            setTimeout(() => this.fitScreen(), 60);
        }

        // ---------------------------------------------------------------------
        // D3 Force Graph Simulation Renderer
        // ---------------------------------------------------------------------

        renderForce() {
            const nodesMap = new Map();
            const rawNodes = this.graphData.nodes || [];

            rawNodes.forEach(n => {
                if (this.filterFn(n) || n.id === this.graphData.root?.id) {
                    nodesMap.set(n.id, { ...n });
                }
            });

            const nodesList = Array.from(nodesMap.values());
            const rawEdges = this.graphData.edges || [];

            const linksList = rawEdges.filter(e => {
                return nodesMap.has(e.source) && nodesMap.has(e.target);
            }).map(e => ({
                source: e.source,
                target: e.target,
                relation: e.relation,
                confidence: e.confidence
            }));

            const nodeWidth = 180;
            const nodeHeight = 50;

            this.simulation = d3.forceSimulation(nodesList)
                .force('link', d3.forceLink(linksList).id(d => d.id).distance(180))
                .force('charge', d3.forceManyBody().strength(-400))
                .force('center', d3.forceCenter(this.width / 2, this.height / 2))
                .force('collide', d3.forceCollide().radius(70));

            // Draw Links
            const links = this.gLinksForce.selectAll('.dep-force-link')
                .data(linksList, d => `${typeof d.source === 'object' ? d.source.id : d.source}->${typeof d.target === 'object' ? d.target.id : d.target}`);

            links.exit().remove();

            const linksEnter = links.enter()
                .append('line')
                .attr('class', 'dep-force-link dep-link')
                .attr('marker-end', 'url(#dep-arrow)');

            const linksMerged = links.merge(linksEnter);

            // Draw Nodes
            const nodes = this.gNodesForce.selectAll('.dep-force-node-group')
                .data(nodesList, d => d.id);

            nodes.exit().remove();

            const nodeEnter = nodes.enter()
                .append('g')
                .attr('class', d => `dep-force-node-group dep-node-group ${d.id === this.graphData.root?.id ? 'root' : ''}`)
                .call(d3.drag()
                    .on('start', (event, d) => {
                        if (!event.active) this.simulation.alphaTarget(0.3).restart();
                        d.fx = d.x;
                        d.fy = d.y;
                    })
                    .on('drag', (event, d) => {
                        d.fx = event.x;
                        d.fy = event.y;
                    })
                    .on('end', (event, d) => {
                        if (!event.active) this.simulation.alphaTarget(0);
                        d.fx = null;
                        d.fy = null;
                    })
                )
                .on('click', (event, d) => {
                    event.stopPropagation();
                    this.selectNode(d);
                })
                .on('dblclick', (event, d) => {
                    event.stopPropagation();
                    if (typeof this.options.onNodeDblClick === 'function') {
                        this.options.onNodeDblClick(d);
                    }
                });

            nodeEnter.append('rect')
                .attr('class', 'dep-node-rect')
                .attr('x', -nodeWidth / 2)
                .attr('y', -nodeHeight / 2)
                .attr('width', nodeWidth)
                .attr('height', nodeHeight);

            nodeEnter.append('text')
                .attr('class', 'dep-node-title')
                .attr('x', -nodeWidth / 2 + 10)
                .attr('y', -4)
                .text(d => this.truncate(d.name, 20));

            nodeEnter.append('text')
                .attr('class', 'dep-node-subtitle')
                .attr('x', -nodeWidth / 2 + 10)
                .attr('y', 14)
                .text(d => `${d.schema || 'public'} • ${d.object_type}`);

            const nodesMerged = nodes.merge(nodeEnter);

            this.simulation.on('tick', () => {
                linksMerged
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);

                nodesMerged
                    .attr('transform', d => `translate(${d.x},${d.y})`);
            });

            this.applySearchHighlights();
            setTimeout(() => this.fitScreen(), 200);
        }

        // ---------------------------------------------------------------------
        // Interactivity & Navigation
        // ---------------------------------------------------------------------

        selectNode(nodeData) {
            this.selectedNodeId = nodeData.id;
            this.gRoot.selectAll('.dep-node-group')
                .classed('selected', d => (d.data ? d.data.id : d.id) === this.selectedNodeId);

            if (typeof this.options.onNodeSelect === 'function') {
                this.options.onNodeSelect(nodeData);
            }
        }

        clearSelection() {
            this.selectedNodeId = null;
            this.gRoot.selectAll('.dep-node-group').classed('selected', false);
            if (typeof this.options.onNodeSelect === 'function') {
                this.options.onNodeSelect(null);
            }
        }

        applySearchHighlights() {
            if (!this.searchQuery) {
                this.gRoot.selectAll('.dep-node-group')
                    .classed('search-match', false)
                    .classed('search-dimmed', false);
                return;
            }

            const q = this.searchQuery;
            this.gRoot.selectAll('.dep-node-group').each(function (d) {
                const node = d.data || d;
                const name = (node.name || '').toLowerCase();
                const disp = (node.display_name || '').toLowerCase();
                const match = name.includes(q) || disp.includes(q);
                d3.select(this)
                    .classed('search-match', match)
                    .classed('search-dimmed', !match);
            });
        }

        zoomIn() {
            this.svg.transition().duration(250).call(this.zoomBehavior.scaleBy, 1.25);
        }

        zoomOut() {
            this.svg.transition().duration(250).call(this.zoomBehavior.scaleBy, 0.8);
        }

        resetZoom() {
            try {
                const h = (this.height && isFinite(this.height) && this.height > 100) ? this.height : 600;
                if (this.zoomBehavior && this.svg) {
                    this.svg.transition().duration(250).call(
                        this.zoomBehavior.transform,
                        d3.zoomIdentity.translate(80, h / 2).scale(1.0)
                    );
                }
            } catch (e) {
                console.warn('[PostgresDep] resetZoom error:', e);
            }
        }

        fitScreen() {
            try {
                const rootEl = this.gRoot?.node();
                if (!rootEl) {
                    this.resetZoom();
                    return;
                }
                const bounds = rootEl.getBBox();
                if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !isFinite(bounds.width) || !isFinite(bounds.height) || !isFinite(bounds.x) || !isFinite(bounds.y)) {
                    this.resetZoom();
                    return;
                }

                const fullWidth = (this.width && this.width > 100) ? this.width : 800;
                const fullHeight = (this.height && this.height > 100) ? this.height : 600;
                const padding = 40;

                const availWidth = Math.max(fullWidth - padding * 2, 100);
                const availHeight = Math.max(fullHeight - padding * 2, 100);

                let scale = Math.min(
                    availWidth / Math.max(bounds.width, 1),
                    availHeight / Math.max(bounds.height, 1),
                    1.2
                );

                if (!isFinite(scale) || scale <= 0) {
                    scale = 1.0;
                }
                scale = Math.max(0.15, Math.min(scale, 2.0));

                let tx = (fullWidth - bounds.width * scale) / 2 - bounds.x * scale;
                let ty = (fullHeight - bounds.height * scale) / 2 - bounds.y * scale;

                if (!isFinite(tx) || !isFinite(ty)) {
                    this.resetZoom();
                    return;
                }

                this.svg.transition().duration(350).call(
                    this.zoomBehavior.transform,
                    d3.zoomIdentity.translate(tx, ty).scale(scale)
                );
            } catch (err) {
                console.warn('[PostgresDep] fitScreen caught error, falling back to resetZoom:', err);
                this.resetZoom();
            }
        }

        getConfidenceColor(confidence) {
            switch ((confidence || '').toUpperCase()) {
                case 'CONFIRMED': return 'var(--ide-success, #6A8759)';
                case 'LIKELY': return 'var(--ide-info, #6897BB)';
                case 'POSSIBLE': return 'var(--ide-warning, #E8C859)';
                default: return 'var(--ide-danger, #ff5c5c)';
            }
        }

        truncate(str, maxLen = 20) {
            if (!str) return '';
            return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
        }
    }

    global.PostgresDependencyGraphRenderer = PostgresDependencyGraphRenderer;
})(window);
