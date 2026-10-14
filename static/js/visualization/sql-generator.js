/**
 * SQL Visualization — Dialect-Aware SQL Generator
 * Implements Section 8 & Section 13 of .SKILL/sql_visualization.md
 */

(function (window) {
    'use strict';

    const SqlVisualization = window.SqlVisualization || {};

    class SqlGenerator {
        constructor() {}

        quoteIdentifier(id, dialect = 'sqlserver') {
            if (!id || id === '*') return id;
            const clean = id.trim();
            // Don't quote expressions or function calls e.g. COUNT(*)
            if (clean.includes('(') || clean.includes(' ') || clean.includes('=')) {
                return clean;
            }

            if (dialect === 'postgresql') {
                if (clean.startsWith('"') && clean.endsWith('"')) return clean;
                return `"${clean}"`;
            } else {
                if (clean.startsWith('[') && clean.endsWith(']')) return clean;
                return `[${clean}]`;
            }
        }

        formatTableRef(tableNode, dialect = 'sqlserver') {
            const schema = tableNode.schema || (dialect === 'postgresql' ? 'public' : 'dbo');
            const tableName = tableNode.tableName;
            const alias = tableNode.alias;

            const qSchema = this.quoteIdentifier(schema, dialect);
            const qTable = this.quoteIdentifier(tableName, dialect);
            const baseRef = `${qSchema}.${qTable}`;

            if (alias && alias !== tableName) {
                const qAlias = this.quoteIdentifier(alias, dialect);
                return `${baseRef} AS ${qAlias}`;
            }
            return baseRef;
        }

        formatColumnRef(item, model) {
            const dialect = model.dialect;
            const col = item.column;

            if (col === '*' || !col) {
                if (item.tableAlias) {
                    const qAlias = this.quoteIdentifier(item.tableAlias, dialect);
                    return `${qAlias}.*`;
                }
                return '*';
            }

            let expr = '';
            if (item.tableAlias) {
                const qAlias = this.quoteIdentifier(item.tableAlias, dialect);
                const qCol = this.quoteIdentifier(col, dialect);
                expr = `${qAlias}.${qCol}`;
            } else {
                expr = this.quoteIdentifier(col, dialect);
            }

            if (item.aggregate) {
                expr = `${item.aggregate}(${expr})`;
            }

            if (item.alias) {
                const qOutAlias = this.quoteIdentifier(item.alias, dialect);
                expr = `${expr} AS ${qOutAlias}`;
            }

            return expr;
        }

        generate(model) {
            if (!model) return '';

            // If query had unsupported constructs (CTEs, subqueries) or was unparseable,
            // preserve original SQL verbatim to avoid data loss.
            if (model.parseStatus === 'unsupported' || (model.unsupportedFragments && model.unsupportedFragments.length > 0 && model.tables.size === 0)) {
                return model.originalSql || '';
            }

            const dialect = model.dialect || 'sqlserver';
            const tablesList = Array.from(model.tables.values());

            if (tablesList.length === 0) {
                return model.originalSql || '-- Empty query\n';
            }

            const lines = [];

            // 1. SELECT clause
            let selectHead = 'SELECT';
            if (model.distinct) {
                selectHead += ' DISTINCT';
            }
            if (dialect === 'sqlserver' && model.topLimit) {
                selectHead += ` TOP ${model.topLimit}`;
            }

            // Output columns
            const outputItems = model.selectItems.filter(s => s.output !== false);
            let selectBody = '';
            if (outputItems.length === 0) {
                selectBody = '    *';
            } else {
                selectBody = outputItems
                    .map(item => '    ' + this.formatColumnRef(item, model))
                    .join(',\n');
            }

            lines.push(selectHead);
            lines.push(selectBody);

            // 2. FROM clause
            // Pick root table (either the first table or one without incoming joins)
            const rootTable = tablesList[0];
            lines.push('FROM ' + this.formatTableRef(rootTable, dialect));

            // Track joined table IDs
            const joinedTableIds = new Set([rootTable.id]);

            // 3. JOIN clauses in model order
            model.joins.forEach(join => {
                const sourceNode = model.getTable(join.sourceTableId);
                const targetNode = model.getTable(join.targetTableId);
                if (!sourceNode || !targetNode) return;

                // Determine which table is newly joined
                let newTableNode = null;
                if (!joinedTableIds.has(targetNode.id)) {
                    newTableNode = targetNode;
                } else if (!joinedTableIds.has(sourceNode.id)) {
                    newTableNode = sourceNode;
                } else {
                    newTableNode = targetNode;
                }
                joinedTableIds.add(newTableNode.id);

                const joinType = (join.joinType || 'INNER').toUpperCase();
                const joinHead = `${joinType} JOIN ${this.formatTableRef(newTableNode, dialect)}`;
                lines.push(joinHead);

                // Conditions
                if (join.conditions && join.conditions.length > 0) {
                    join.conditions.forEach((cond, cIdx) => {
                        const prefix = cIdx === 0 ? '    ON ' : '    AND ';
                        const leftAlias = sourceNode.alias;
                        const rightAlias = targetNode.alias;

                        const qLeftA = this.quoteIdentifier(leftAlias, dialect);
                        const qLeftC = this.quoteIdentifier(cond.leftColumn, dialect);
                        const qRightA = this.quoteIdentifier(rightAlias, dialect);
                        const qRightC = this.quoteIdentifier(cond.rightColumn, dialect);
                        const op = cond.operator || '=';

                        lines.push(`${prefix}${qLeftA}.${qLeftC} ${op} ${qRightA}.${qRightC}`);
                    });
                }
            });

            // If there are tables in model that were NOT joined via JOIN edges, add as CROSS JOIN / FROM commas
            tablesList.forEach(t => {
                if (!joinedTableIds.has(t.id)) {
                    lines.push('CROSS JOIN ' + this.formatTableRef(t, dialect));
                    joinedTableIds.add(t.id);
                }
            });

            // 4. WHERE clause
            const whereList = [];
            // Where conditions from whereConditions
            model.whereConditions.forEach(w => {
                if (w.rawSql) {
                    whereList.push(w.rawSql);
                } else if (w.column) {
                    let colExpr = '';
                    if (w.tableAlias) {
                        const qA = this.quoteIdentifier(w.tableAlias, dialect);
                        const qC = this.quoteIdentifier(w.column, dialect);
                        colExpr = `${qA}.${qC}`;
                    } else {
                        colExpr = this.quoteIdentifier(w.column, dialect);
                    }
                    whereList.push(`${colExpr} ${w.operator || '='} ${w.value}`);
                }
            });

            // Also check selectItems with filter criteria
            model.selectItems.forEach(s => {
                if (s.criteria && s.criteria.trim()) {
                    let colExpr = '';
                    if (s.tableAlias) {
                        const qA = this.quoteIdentifier(s.tableAlias, dialect);
                        const qC = this.quoteIdentifier(s.column, dialect);
                        colExpr = `${qA}.${qC}`;
                    } else {
                        colExpr = this.quoteIdentifier(s.column, dialect);
                    }
                    const crit = s.criteria.trim();
                    if (/^(=|!=|<>|<|>|<=|>=|LIKE|IN)/i.test(crit)) {
                        whereList.push(`${colExpr} ${crit}`);
                    } else {
                        whereList.push(`${colExpr} = ${crit}`);
                    }
                }
            });

            if (whereList.length > 0) {
                lines.push('WHERE ' + whereList.join('\n  AND '));
            }

            // 5. GROUP BY
            if (model.groupByItems && model.groupByItems.length > 0) {
                const gList = model.groupByItems.map(g => this.quoteIdentifier(g, dialect)).join(', ');
                lines.push('GROUP BY ' + gList);
            }

            // 6. HAVING
            if (model.havingConditions && model.havingConditions.length > 0) {
                lines.push('HAVING ' + model.havingConditions.join(' AND '));
            }

            // 7. ORDER BY
            const orderList = [];
            model.orderByItems.forEach(o => {
                orderList.push(`${this.quoteIdentifier(o.column, dialect)} ${o.direction || 'ASC'}`);
            });
            // Also check select items with sort
            model.selectItems.forEach(s => {
                if (s.sort && (s.sort.toUpperCase() === 'ASC' || s.sort.toUpperCase() === 'DESC')) {
                    let colExpr = s.alias ? this.quoteIdentifier(s.alias, dialect) : (s.tableAlias ? `${this.quoteIdentifier(s.tableAlias, dialect)}.${this.quoteIdentifier(s.column, dialect)}` : this.quoteIdentifier(s.column, dialect));
                    if (!orderList.some(ol => ol.startsWith(colExpr))) {
                        orderList.push(`${colExpr} ${s.sort.toUpperCase()}`);
                    }
                }
            });

            if (orderList.length > 0) {
                lines.push('ORDER BY ' + orderList.join(', '));
            }

            // 8. LIMIT (PostgreSQL)
            if (dialect === 'postgresql' && model.topLimit) {
                lines.push(`LIMIT ${model.topLimit}`);
            }

            return lines.join('\n') + ';';
        }
    }

    const defaultGenerator = new SqlGenerator();
    SqlVisualization.SqlGenerator = SqlGenerator;
    SqlVisualization.DefaultSqlGenerator = defaultGenerator;
    window.SqlVisualization = SqlVisualization;

})(window);
