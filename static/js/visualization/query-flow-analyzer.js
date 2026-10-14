/**
 * SQL Visualization — Query Flow Analyzer
 * Implements Phase 2 & Phase 3 of .SKILL/query_plan_visualization.md
 * 
 * Analyzes complex SQL syntax (CTEs, recursive CTEs, UNION/UNION ALL,
 * Derived Tables/Subqueries, Joins, Aggregates) into a QueryFlowGraph.
 * Provides both client-side analysis and asynchronous backend integration.
 */

(function (window) {
    'use strict';

    const SqlVisualization = window.SqlVisualization || {};
    const {
        SourceRange,
        QueryNodeType,
        QueryEdgeType,
        QueryNode,
        QueryEdge,
        QueryFlowGraph
    } = SqlVisualization;

    /**
     * Splits string at top-level delimiter ignoring parentheses, quotes, and brackets
     */
    function splitTopLevel(str, delimiter, caseInsensitive = false) {
        const results = [];
        let current = '';
        let parenDepth = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let inBracket = false;

        const target = caseInsensitive ? delimiter.toUpperCase() : delimiter;
        const targetLen = delimiter.length;

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            const nextCh = i + 1 < str.length ? str[i + 1] : '';

            // Handle string literal
            if (ch === "'" && !inDoubleQuote && !inBracket) {
                if (inSingleQuote && nextCh === "'") {
                    current += "''";
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                current += ch;
                continue;
            }

            // Handle quoted identifier
            if (ch === '"' && !inSingleQuote && !inBracket) {
                if (inDoubleQuote && nextCh === '"') {
                    current += '""';
                    i++;
                    continue;
                }
                inDoubleQuote = !inDoubleQuote;
                current += ch;
                continue;
            }

            // Handle bracket identifier
            if (ch === '[' && !inSingleQuote && !inDoubleQuote) {
                inBracket = true;
                current += ch;
                continue;
            }
            if (ch === ']' && inBracket) {
                inBracket = false;
                current += ch;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote && !inBracket) {
                if (ch === '(') parenDepth++;
                else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);

                if (parenDepth === 0) {
                    const slice = str.substr(i, targetLen);
                    const match = caseInsensitive ? (slice.toUpperCase() === target) : (slice === target);
                    if (match) {
                        // Word boundary check if target is alphanumeric
                        if (/^[A-Za-z0-9_]+$/.test(delimiter)) {
                            const prevChar = i > 0 ? str[i - 1] : ' ';
                            const afterChar = i + targetLen < str.length ? str[i + targetLen] : ' ';
                            if (/\s/.test(prevChar) && /\s/.test(afterChar)) {
                                results.push(current.trim());
                                current = '';
                                i += targetLen - 1;
                                continue;
                            }
                        } else {
                            results.push(current.trim());
                            current = '';
                            i += targetLen - 1;
                            continue;
                        }
                    }
                }
            }

            current += ch;
        }

        if (current.trim().length > 0) {
            results.push(current.trim());
        }
        return results;
    }

    /**
     * Strips delimiters around identifier e.g. [table], "table", `table`
     */
    function cleanIdent(id) {
        if (!id) return '';
        id = id.trim();
        if ((id.startsWith('[') && id.endsWith(']')) ||
            (id.startsWith('"') && id.endsWith('"')) ||
            (id.startsWith('`') && id.endsWith('`'))) {
            return id.substring(1, id.length - 1).trim();
        }
        return id;
    }

    /**
     * Computes line and column in SQL text from character index
     */
    function indexToLineCol(text, index) {
        let line = 1;
        let col = 1;
        const limit = Math.min(index, text.length);
        for (let i = 0; i < limit; i++) {
            if (text[i] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        return { line, col };
    }

    /**
     * Builds SourceRange from substring match inside fullSql
     */
    function findSourceRange(fullSql, fragment) {
        if (!fullSql || !fragment) return new SourceRange();
        const startIdx = fullSql.indexOf(fragment);
        if (startIdx === -1) return new SourceRange();
        const endIdx = startIdx + fragment.length;

        const startLC = indexToLineCol(fullSql, startIdx);
        const endLC = indexToLineCol(fullSql, endIdx);

        return new SourceRange({
            startOffset: startIdx,
            endOffset: endIdx,
            startLine: startLC.line,
            startColumn: startLC.col,
            endLine: endLC.line,
            endColumn: endLC.col
        });
    }

    class QueryFlowAnalyzer {
        constructor() {}

        /**
         * Client-side synchronous AST & flow analysis
         */
        analyze(sql, options = {}) {
            const dialect = options.dialect || 'sqlserver';
            const cleanSql = (sql || '').trim().replace(/;+$/, '');
            const graph = new QueryFlowGraph({
                dialect,
                originalSql: cleanSql
            });

            if (!cleanSql) return graph;

            let remainingSql = cleanSql;
            const cteMap = new Map(); // cteName -> { node, tables, sql }
            const cteNames = new Set();
            const referencedCtes = new Set();
            let sourceOrderCounter = 1;

            // ── 1. Detect and parse WITH ... AS (...) CTEs ─────────────────────
            const withMatch = remainingSql.match(/^\s*WITH\s+([\s\S]+?)\s+(SELECT|INSERT|UPDATE|DELETE)\b/i);
            if (withMatch) {
                const withBody = withMatch[1];
                const mainQueryKeyword = withMatch[2];
                const mainQueryStartIdx = withMatch[0].lastIndexOf(mainQueryKeyword);
                remainingSql = remainingSql.substring(mainQueryStartIdx).trim();

                // Parse individual CTEs in WITH block
                const cteBlocks = splitTopLevel(withBody, ',');
                cteBlocks.forEach((cteBlock) => {
                    const cteHeaderMatch = cteBlock.match(/^([A-Za-z0-9_\[\]"`]+)(?:\s*\(([\s\S]*?)\))?\s+AS\s*\(\s*([\s\S]+)\s*\)$/i);
                    if (cteHeaderMatch) {
                        const rawCteName = cteHeaderMatch[1];
                        const cteName = cleanIdent(rawCteName);
                        const cteInnerSql = cteHeaderMatch[3].trim();

                        cteNames.add(cteName);

                        // Discover inner table references
                        const innerTables = this._extractTableReferences(cteInnerSql, dialect);
                        const isRecursive = innerTables.some(t => t.tableName.toLowerCase() === cteName.toLowerCase());

                        const cteNode = new QueryNode({
                            id: `cte_${cteName}`,
                            nodeType: QueryNodeType.CTE,
                            label: `CTE: ${cteName}`,
                            alias: cteName,
                            sqlFragment: cteBlock.trim(),
                            sourceRange: findSourceRange(cleanSql, cteBlock),
                            sourceOrder: sourceOrderCounter++,
                            status: isRecursive ? 'recursive' : 'valid',
                            metadata: { cteName, isRecursive }
                        });

                        graph.addNode(cteNode);
                        cteMap.set(cteName.toLowerCase(), {
                            node: cteNode,
                            innerTables,
                            innerSql: cteInnerSql,
                            isRecursive
                        });

                        // Create nodes and edges for inner components
                        innerTables.forEach(t => {
                            const isSelfRef = t.tableName.toLowerCase() === cteName.toLowerCase();
                            if (isSelfRef) {
                                // Recursive self cycle
                                graph.addEdge(new QueryEdge({
                                    id: `edge_rec_${cteName}`,
                                    sourceNodeId: cteNode.id,
                                    targetNodeId: cteNode.id,
                                    edgeType: QueryEdgeType.RECURSIVE_CYCLE,
                                    label: 'Recursive Member',
                                    metadata: { isCycle: true }
                                }));
                            } else if (cteMap.has(t.tableName.toLowerCase())) {
                                // CTE dependency on another prior CTE
                                const depCte = cteMap.get(t.tableName.toLowerCase());
                                graph.addEdge(new QueryEdge({
                                    id: `edge_cte_dep_${depCte.node.id}_${cteNode.id}`,
                                    sourceNodeId: depCte.node.id,
                                    targetNodeId: cteNode.id,
                                    edgeType: QueryEdgeType.CTE_REFERENCE,
                                    label: `References ${depCte.node.alias}`
                                }));
                            } else {
                                // Physical table feed
                                const tblId = `table_${t.schema}_${t.tableName}_${cteName}`.replace(/[^A-Za-z0-9_]/g, '_');
                                let tblNode = graph.getNode(tblId);
                                if (!tblNode) {
                                    tblNode = new QueryNode({
                                        id: tblId,
                                        nodeType: QueryNodeType.TABLE,
                                        label: `Table: ${t.tableName}`,
                                        schema: t.schema,
                                        tableName: t.tableName,
                                        sourceOrder: sourceOrderCounter++
                                    });
                                    graph.addNode(tblNode);
                                }
                                if (!cteNode.children.includes(tblId)) cteNode.children.push(tblId);

                                // Check if Aggregate inside CTE
                                if (/\b(GROUP\s+BY|SUM|COUNT|AVG|MIN|MAX)\b/i.test(cteInnerSql)) {
                                    const aggId = `agg_${cteName}`;
                                    let aggNode = graph.getNode(aggId);
                                    if (!aggNode) {
                                        aggNode = new QueryNode({
                                            id: aggId,
                                            nodeType: QueryNodeType.AGGREGATE,
                                            label: 'GROUP BY / Aggregate',
                                            sourceOrder: sourceOrderCounter++
                                        });
                                        graph.addNode(aggNode);
                                        graph.addEdge(new QueryEdge({
                                            id: `edge_tbl_agg_${tblId}`,
                                            sourceNodeId: tblId,
                                            targetNodeId: aggId,
                                            edgeType: QueryEdgeType.DATA_FLOW
                                        }));
                                        graph.addEdge(new QueryEdge({
                                            id: `edge_agg_cte_${aggId}_${cteNode.id}`,
                                            sourceNodeId: aggId,
                                            targetNodeId: cteNode.id,
                                            edgeType: QueryEdgeType.DATA_FLOW
                                        }));
                                    }
                                    if (!cteNode.children.includes(aggId)) cteNode.children.push(aggId);
                                } else {
                                    graph.addEdge(new QueryEdge({
                                        id: `edge_src_cte_${tblId}_${cteNode.id}`,
                                        sourceNodeId: tblId,
                                        targetNodeId: cteNode.id,
                                        edgeType: QueryEdgeType.DATA_FLOW,
                                        label: 'Source Feed'
                                    }));
                                }
                            }
                        });
                        cteNode.isExpandable = cteNode.children.length > 0;
                    }
                });
            }

            // ── 2. Detect UNION / UNION ALL in main body ─────────────────────────
            const unionChunks = this._splitUnionBranches(remainingSql);
            if (unionChunks.branches.length > 1) {
                const unionType = unionChunks.isAll ? 'UNION ALL' : 'UNION';
                const unionNode = new QueryNode({
                    id: 'union_combiner',
                    nodeType: QueryNodeType.UNION,
                    label: unionType,
                    metadata: { unionType, isDistinct: !unionChunks.isAll },
                    sourceOrder: sourceOrderCounter++
                });
                graph.addNode(unionNode);

                const finalNode = new QueryNode({
                    id: 'final_result',
                    nodeType: QueryNodeType.FINAL_RESULT,
                    label: 'Final Result',
                    sourceOrder: 100
                });
                graph.addNode(finalNode);

                graph.addEdge(new QueryEdge({
                    id: 'edge_union_final',
                    sourceNodeId: unionNode.id,
                    targetNodeId: finalNode.id,
                    edgeType: QueryEdgeType.DATA_FLOW
                }));

                unionChunks.branches.forEach((branchSql, bIdx) => {
                    const branchIndex = bIdx + 1;
                    const branchId = `select_branch_${branchIndex}`;
                    const branchNode = new QueryNode({
                        id: branchId,
                        nodeType: QueryNodeType.SELECT,
                        label: `Branch ${branchIndex}`,
                        sqlFragment: branchSql.trim(),
                        sourceRange: findSourceRange(cleanSql, branchSql.trim()),
                        sourceOrder: sourceOrderCounter++
                    });
                    graph.addNode(branchNode);

                    graph.addEdge(new QueryEdge({
                        id: `edge_branch_union_${branchIndex}`,
                        sourceNodeId: branchId,
                        targetNodeId: unionNode.id,
                        edgeType: QueryEdgeType.UNION_BRANCH,
                        label: `Branch ${branchIndex}`
                    }));

                    // Connect sources to this branch
                    const branchTables = this._extractTableReferences(branchSql, dialect);
                    branchTables.forEach(t => {
                        const cteKey = t.tableName.toLowerCase();
                        if (cteMap.has(cteKey)) {
                            const cNode = cteMap.get(cteKey).node;
                            referencedCtes.add(cteKey);
                            graph.addEdge(new QueryEdge({
                                id: `edge_cte_branch_${cNode.id}_${branchId}`,
                                sourceNodeId: cNode.id,
                                targetNodeId: branchId,
                                edgeType: QueryEdgeType.CTE_REFERENCE,
                                label: `From ${cNode.alias}`
                            }));
                        } else {
                            const tblId = `tbl_b${branchIndex}_${t.schema}_${t.tableName}`.replace(/[^A-Za-z0-9_]/g, '_');
                            let tblNode = graph.getNode(tblId);
                            if (!tblNode) {
                                tblNode = new QueryNode({
                                    id: tblId,
                                    nodeType: QueryNodeType.TABLE,
                                    label: `Table: ${t.tableName}`,
                                    schema: t.schema,
                                    tableName: t.tableName,
                                    sourceOrder: sourceOrderCounter++
                                });
                                graph.addNode(tblNode);
                            }
                            graph.addEdge(new QueryEdge({
                                id: `edge_tbl_branch_${tblId}_${branchId}`,
                                sourceNodeId: tblId,
                                targetNodeId: branchId,
                                edgeType: QueryEdgeType.DATA_FLOW
                            }));
                        }
                    });
                });

                // Transitive closure for referenced CTEs in UNION
                const allReferenced = new Set(referencedCtes);
                let changed = true;
                while (changed) {
                    changed = false;
                    allReferenced.forEach(cKey => {
                        const cVal = cteMap.get(cKey);
                        if (cVal && cVal.innerTables) {
                            cVal.innerTables.forEach(t => {
                                const subKey = t.tableName.toLowerCase();
                                if (cteMap.has(subKey) && !allReferenced.has(subKey)) {
                                    allReferenced.add(subKey);
                                    changed = true;
                                }
                            });
                        }
                    });
                }
                cteMap.forEach((val, key) => {
                    if (!allReferenced.has(key)) {
                        val.node.status = 'warning';
                        val.node.metadata.isReferenced = false;
                    }
                });

                graph.computeLogicalSteps();
                return graph;
            }

            // ── 3. Detect Derived Tables / Subqueries in FROM and JOIN ─────────
            const activeFeedIds = [];
            const derivedTables = [];

            // Match all subqueries in FROM and JOIN: (FROM|JOIN) (SELECT ...) [AS] alias
            const derivedRegex = /\b(?:FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN)\s*\(\s*(SELECT\s+[\s\S]+?)\s*\)\s*(?:AS\s+)?([A-Za-z0-9_\[\]"`]+)/gi;
            let dMatch;
            while ((dMatch = derivedRegex.exec(remainingSql)) !== null) {
                const subSql = dMatch[1].trim();
                const rawAlias = dMatch[2];
                const alias = cleanIdent(rawAlias);

                const derivedNode = new QueryNode({
                    id: `derived_${alias}`,
                    nodeType: QueryNodeType.DERIVED_TABLE,
                    label: `Derived Table: ${alias}`,
                    alias: alias,
                    sqlFragment: subSql,
                    sourceRange: findSourceRange(cleanSql, dMatch[0]),
                    sourceOrder: sourceOrderCounter++
                });
                graph.addNode(derivedNode);
                derivedTables.push({ node: derivedNode, sql: subSql, alias });
                activeFeedIds.push(derivedNode.id);

                // Discover inner tables inside this derived table
                const subTables = this._extractTableReferences(subSql, dialect);
                subTables.forEach(t => {
                    const tblId = `tbl_sub_${t.schema}_${t.tableName}_${alias}`.replace(/[^A-Za-z0-9_]/g, '_');
                    let tblNode = graph.getNode(tblId);
                    if (!tblNode) {
                        tblNode = new QueryNode({
                            id: tblId,
                            nodeType: QueryNodeType.TABLE,
                            label: `Table: ${t.tableName}`,
                            schema: t.schema,
                            tableName: t.tableName,
                            sourceRange: findSourceRange(cleanSql, t.tableName),
                            sourceOrder: sourceOrderCounter++
                        });
                        graph.addNode(tblNode);
                    }
                    if (!derivedNode.children.includes(tblId)) derivedNode.children.push(tblId);

                    if (/\b(GROUP\s+BY|SUM|COUNT|AVG|MIN|MAX)\b/i.test(subSql)) {
                        const aggId = `agg_sub_${alias}`;
                        let aggNode = graph.getNode(aggId);
                        if (!aggNode) {
                            aggNode = new QueryNode({
                                id: aggId,
                                nodeType: QueryNodeType.AGGREGATE,
                                label: 'Aggregate',
                                sourceOrder: sourceOrderCounter++
                            });
                            graph.addNode(aggNode);
                            graph.addEdge(new QueryEdge({
                                id: `edge_tbl_agg_${tblId}`,
                                sourceNodeId: tblId,
                                targetNodeId: aggId,
                                edgeType: QueryEdgeType.DATA_FLOW
                            }));
                            graph.addEdge(new QueryEdge({
                                id: `edge_agg_derived_${aggId}`,
                                sourceNodeId: aggId,
                                targetNodeId: derivedNode.id,
                                edgeType: QueryEdgeType.DATA_FLOW
                            }));
                        }
                        if (!derivedNode.children.includes(aggId)) derivedNode.children.push(aggId);
                    } else {
                        graph.addEdge(new QueryEdge({
                            id: `edge_tbl_derived_${tblId}_${derivedNode.id}`,
                            sourceNodeId: tblId,
                            targetNodeId: derivedNode.id,
                            edgeType: QueryEdgeType.SUBQUERY_INPUT
                        }));
                    }
                });
                derivedNode.isExpandable = derivedNode.children.length > 0;
            }

            // ── 4. Detect Physical Tables + CTE references in Main Query ─────────
            // Remove derived table subquery bodies temporarily to avoid duplicate table extraction
            const sqlWithoutDerived = remainingSql.replace(/\(\s*SELECT\s+[\s\S]+?\s*\)\s*(?:AS\s+)?[A-Za-z0-9_\[\]"`]+/gi, 'derived_placeholder');
            const mainTables = this._extractTableReferences(sqlWithoutDerived, dialect);


            mainTables.forEach(t => {
                const cteKey = t.tableName.toLowerCase();
                if (cteMap.has(cteKey)) {
                    const cNode = cteMap.get(cteKey).node;
                    referencedCtes.add(cteKey);
                    activeFeedIds.push(cNode.id);
                } else {
                    const tblId = `table_${t.schema}_${t.tableName}`.replace(/[^A-Za-z0-9_]/g, '_');
                    let tblNode = graph.getNode(tblId);
                    if (!tblNode) {
                        tblNode = new QueryNode({
                            id: tblId,
                            nodeType: QueryNodeType.TABLE,
                            label: `Table: ${t.tableName}`,
                            schema: t.schema,
                            tableName: t.tableName,
                            alias: t.alias || '',
                            sourceRange: findSourceRange(cleanSql, t.tableName),
                            sourceOrder: sourceOrderCounter++
                        });
                        graph.addNode(tblNode);
                    }
                    activeFeedIds.push(tblNode.id);
                }
            });

            // ── 5. Detect WHERE Subqueries (EXISTS / NOT EXISTS) ─────────────────
            const existsRegex = /\b(NOT\s+EXISTS|EXISTS)\s*\(\s*(SELECT\s+[\s\S]+?)\s*\)/gi;
            let exMatch;
            let exIndex = 1;
            while ((exMatch = existsRegex.exec(remainingSql)) !== null) {
                const op = exMatch[1].toUpperCase().replace(/\s+/g, ' ');
                const exSql = exMatch[2].trim();
                const subNode = new QueryNode({
                    id: `sub_exists_${exIndex}`,
                    nodeType: QueryNodeType.SUBQUERY,
                    label: `Subquery (${op})`,
                    sqlFragment: exSql,
                    sourceRange: findSourceRange(cleanSql, exMatch[0]),
                    sourceOrder: sourceOrderCounter++
                });
                graph.addNode(subNode);

                const exTables = this._extractTableReferences(exSql, dialect);
                exTables.forEach(t => {
                    const tblId = `tbl_ex_${exIndex}_${t.schema}_${t.tableName}`.replace(/[^A-Za-z0-9_]/g, '_');
                    let tblNode = graph.getNode(tblId);
                    if (!tblNode) {
                        tblNode = new QueryNode({
                            id: tblId,
                            nodeType: QueryNodeType.TABLE,
                            label: `Table: ${t.tableName}`,
                            schema: t.schema,
                            tableName: t.tableName,
                            sourceOrder: sourceOrderCounter++
                        });
                        graph.addNode(tblNode);
                    }
                    graph.addEdge(new QueryEdge({
                        id: `edge_tbl_ex_${tblId}_${subNode.id}`,
                        sourceNodeId: tblId,
                        targetNodeId: subNode.id,
                        edgeType: QueryEdgeType.DATA_FLOW
                    }));
                });

                const filterNode = new QueryNode({
                    id: `filter_exists_${exIndex}`,
                    nodeType: QueryNodeType.FILTER,
                    label: `${op} Filter`,
                    sourceOrder: sourceOrderCounter++
                });
                graph.addNode(filterNode);

                graph.addEdge(new QueryEdge({
                    id: `edge_sub_filter_${subNode.id}`,
                    sourceNodeId: subNode.id,
                    targetNodeId: filterNode.id,
                    edgeType: QueryEdgeType.DEPENDENCY,
                    label: op
                }));

                Array.from(new Set(activeFeedIds)).forEach(feedId => {
                    graph.addEdge(new QueryEdge({
                        id: `edge_feed_filter_${feedId}_${filterNode.id}`,
                        sourceNodeId: feedId,
                        targetNodeId: filterNode.id,
                        edgeType: QueryEdgeType.DATA_FLOW
                    }));
                });
                activeFeedIds.length = 0;
                activeFeedIds.push(filterNode.id);
                exIndex++;
            }

            // ── 6. Detect Scalar Subqueries in SELECT list ───────────────────────
            const selectMatch = remainingSql.match(/^\s*SELECT\s+([\s\S]+?)\s+\bFROM\b/i);
            if (selectMatch) {
                const selectList = selectMatch[1];
                const scalarRegex = /\(\s*(SELECT\s+[\s\S]+?)\s*\)\s*(?:AS\s+)?([A-Za-z0-9_\[\]"`]+)?/gi;
                let scMatch;
                let scIdx = 1;
                while ((scMatch = scalarRegex.exec(selectList)) !== null) {
                    const scSql = scMatch[1].trim();
                    const scAlias = cleanIdent(scMatch[2] || `Scalar_${scIdx}`);
                    const scalarNode = new QueryNode({
                        id: `scalar_${scAlias}`,
                        nodeType: QueryNodeType.SUBQUERY,
                        label: `Scalar Subquery: ${scAlias}`,
                        alias: scAlias,
                        sqlFragment: scSql,
                        sourceRange: findSourceRange(cleanSql, scMatch[0]),
                        sourceOrder: sourceOrderCounter++
                    });
                    graph.addNode(scalarNode);

                    const scTables = this._extractTableReferences(scSql, dialect);
                    scTables.forEach(t => {
                        const tblId = `tbl_sc_${t.schema}_${t.tableName}_${scAlias}`.replace(/[^A-Za-z0-9_]/g, '_');
                        let tblNode = graph.getNode(tblId);
                        if (!tblNode) {
                            tblNode = new QueryNode({
                                id: tblId,
                                nodeType: QueryNodeType.TABLE,
                                label: `Table: ${t.tableName}`,
                                schema: t.schema,
                                tableName: t.tableName,
                                sourceOrder: sourceOrderCounter++
                            });
                            graph.addNode(tblNode);
                        }
                        graph.addEdge(new QueryEdge({
                            id: `edge_tbl_sc_${tblId}_${scalarNode.id}`,
                            sourceNodeId: tblId,
                            targetNodeId: scalarNode.id,
                            edgeType: QueryEdgeType.DATA_FLOW
                        }));
                    });

                    // Store on graph metadata to link with final select later
                    if (!graph.scalarNodes) graph.scalarNodes = [];
                    graph.scalarNodes.push(scalarNode);
                    scIdx++;
                }
            }

            // ── 7. Main JOINs & Aggregates ───────────────────────────────────────
            const hasJoins = /\b(JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN)\b/i.test(sqlWithoutDerived);
            const uniqueFeeds = Array.from(new Set(activeFeedIds));
            if (hasJoins && uniqueFeeds.length >= 2) {
                const joinNode = new QueryNode({
                    id: 'join_main',
                    nodeType: QueryNodeType.JOIN,
                    label: 'JOIN',
                    sourceOrder: sourceOrderCounter++
                });
                graph.addNode(joinNode);

                uniqueFeeds.forEach(feedId => {
                    graph.addEdge(new QueryEdge({
                        id: `edge_feed_join_${feedId}`,
                        sourceNodeId: feedId,
                        targetNodeId: joinNode.id,
                        edgeType: QueryEdgeType.JOIN_INPUT
                    }));
                });
                activeFeedIds.length = 0;
                activeFeedIds.push(joinNode.id);
            }

            // Aggregates in main query
            if (/\b(GROUP\s+BY)\b/i.test(sqlWithoutDerived)) {
                const aggNode = new QueryNode({
                    id: 'agg_main',
                    nodeType: QueryNodeType.AGGREGATE,
                    label: 'GROUP BY / Aggregate',
                    sourceOrder: sourceOrderCounter++
                });
                graph.addNode(aggNode);

                Array.from(new Set(activeFeedIds)).forEach(feedId => {
                    graph.addEdge(new QueryEdge({
                        id: `edge_feed_agg_${feedId}`,
                        sourceNodeId: feedId,
                        targetNodeId: aggNode.id,
                        edgeType: QueryEdgeType.DATA_FLOW
                    }));
                });
                activeFeedIds.length = 0;
                activeFeedIds.push(aggNode.id);
            }

            // ── 8. Final SELECT Result Node ──────────────────────────────────────
            const finalNode = new QueryNode({
                id: 'final_select',
                nodeType: QueryNodeType.FINAL_RESULT,
                label: 'Final SELECT',
                sourceOrder: 100
            });
            graph.addNode(finalNode);

            Array.from(new Set(activeFeedIds)).forEach(feedId => {
                graph.addEdge(new QueryEdge({
                    id: `edge_feed_final_${feedId}`,
                    sourceNodeId: feedId,
                    targetNodeId: finalNode.id,
                    edgeType: QueryEdgeType.DATA_FLOW
                }));
            });

            // Connect scalar subqueries to Final SELECT
            if (graph.scalarNodes) {
                graph.scalarNodes.forEach(scNode => {
                    graph.addEdge(new QueryEdge({
                        id: `edge_sc_final_${scNode.id}`,
                        sourceNodeId: scNode.id,
                        targetNodeId: finalNode.id,
                        edgeType: QueryEdgeType.SUBQUERY_INPUT,
                        label: scNode.alias
                    }));
                });
                delete graph.scalarNodes;
            }

            // Mark unreferenced CTEs (Test G) with full transitive closure
            const allReferenced = new Set(referencedCtes);
            let changed = true;
            while (changed) {
                changed = false;
                allReferenced.forEach(cKey => {
                    const cVal = cteMap.get(cKey);
                    if (cVal && cVal.innerTables) {
                        cVal.innerTables.forEach(t => {
                            const subKey = t.tableName.toLowerCase();
                            if (cteMap.has(subKey) && !allReferenced.has(subKey)) {
                                allReferenced.add(subKey);
                                changed = true;
                            }
                        });
                    }
                });
            }

            cteMap.forEach((val, key) => {
                if (!allReferenced.has(key)) {
                    val.node.status = 'warning';
                    val.node.metadata.isReferenced = false;
                }
            });

            graph.computeLogicalSteps();
            return graph;
        }

        /**
         * Asynchronous analysis connecting to backend Python sqlglot service
         */
        async analyzeAsync(sql, options = {}) {
            const dialect = options.dialect || 'tsql';

            // 1. Try PyWebView native IPC bridge
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.analyze_query_flow === 'function') {
                try {
                    const res = await window.pywebview.api.analyze_query_flow(sql, dialect);
                    if (res && res.success && res.flowGraph) {
                        return QueryFlowGraph.fromJSON(res.flowGraph);
                    }
                } catch (e) {
                    console.warn('[QueryFlowAnalyzer] PyWebView analyze_query_flow error:', e);
                }
            }

            // 2. Try REST API endpoint
            try {
                const resp = await fetch('/api/metadata/query-flow', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql, dialect })
                });
                if (resp && resp.ok) {
                    const data = await resp.json();
                    if (data && data.success && data.flowGraph) {
                        return QueryFlowGraph.fromJSON(data.flowGraph);
                    }
                }
            } catch (_) {}

            // 3. Robust client-side fallback
            return this.analyze(sql, options);
        }

        /**
         * Splits UNION / UNION ALL branches at top level
         */
        _splitUnionBranches(sql) {
            const rawBranches = splitTopLevel(sql, 'UNION', true);
            if (rawBranches.length <= 1) {
                return { branches: [sql], isAll: false };
            }

            const branches = [];
            let isAll = false;

            rawBranches.forEach((b, idx) => {
                let trimmed = b.trim();
                if (idx > 0 && trimmed.toUpperCase().startsWith('ALL')) {
                    isAll = true;
                    trimmed = trimmed.substring(3).trim();
                }
                branches.push(trimmed);
            });

            return { branches, isAll };
        }

        /**
         * Extracts table names, schemas, and aliases from a SELECT query snippet
         */
        _extractTableReferences(sqlSnippet, dialect) {
            const tables = [];
            const fromMatch = sqlSnippet.match(/\bFROM\s+([\s\S]+?)(?:\bWHERE\b|\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b|$)/i);
            if (!fromMatch) return tables;

            const fromClause = fromMatch[1].trim();
            // Split by JOIN keywords and commas
            const chunks = fromClause.split(/\b(?:LEFT\s+OUTER\s+JOIN|RIGHT\s+OUTER\s+JOIN|FULL\s+OUTER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|JOIN|,)\b/i);

            chunks.forEach(chunk => {
                let spec = chunk.trim();
                // Strip ON condition
                const onIdx = spec.toUpperCase().indexOf(' ON ');
                if (onIdx !== -1) {
                    spec = spec.substring(0, onIdx).trim();
                }

                // Match table [AS] alias
                const parts = spec.split(/\s+(?:AS\s+)?/i).filter(p => p.length > 0);
                if (parts.length > 0) {
                    const rawTable = parts[0];
                    const rawAlias = parts.length > 1 ? parts[parts.length - 1] : '';

                    let schema = dialect === 'postgresql' ? 'public' : 'dbo';
                    let tableName = rawTable;

                    if (rawTable.includes('.')) {
                        const segments = rawTable.split('.');
                        if (segments.length === 2) {
                            schema = cleanIdent(segments[0]);
                            tableName = cleanIdent(segments[1]);
                        } else if (segments.length === 3) {
                            schema = cleanIdent(segments[1]);
                            tableName = cleanIdent(segments[2]);
                        }
                    } else {
                        tableName = cleanIdent(rawTable);
                    }

                    if (tableName && !tableName.startsWith('(')) {
                        tables.push({
                            schema,
                            tableName,
                            alias: rawAlias ? cleanIdent(rawAlias) : tableName
                        });
                    }
                }
            });

            return tables;
        }
    }

    const defaultAnalyzer = new QueryFlowAnalyzer();
    SqlVisualization.QueryFlowAnalyzer = QueryFlowAnalyzer;
    SqlVisualization.DefaultQueryFlowAnalyzer = defaultAnalyzer;
    window.SqlVisualization = SqlVisualization;

})(typeof window !== 'undefined' ? window : globalThis);
