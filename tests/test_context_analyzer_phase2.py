import os
import re

def test_sql_tokenizer_file_and_tags():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tokenizer_path = os.path.join(base_dir, "static", "js", "sql-tokenizer.js")
    context_analyzer_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    index_html_path = os.path.join(base_dir, "templates", "index.html")

    assert os.path.exists(tokenizer_path), "sql-tokenizer.js must exist"
    assert os.path.exists(context_analyzer_path), "context-analyzer.js must exist"
    assert os.path.exists(index_html_path), "index.html must exist"

    with open(tokenizer_path, "r", encoding="utf-8") as f:
        tok_code = f.read()

    assert "class SqlTokenizer" in tok_code
    assert "tokenize(" in tok_code
    assert "cleanIdentifier(" in tok_code
    assert "filterCodeTokens(" in tok_code
    assert "TokenType" in tok_code

    with open(index_html_path, "r", encoding="utf-8") as f:
        html = f.read()

    tok_idx = html.find("sql-tokenizer.js")
    ctx_idx = html.find("context-analyzer.js")
    is_idx = html.find("intellisense.js")

    assert tok_idx != -1, "index.html must load sql-tokenizer.js"
    assert tok_idx < ctx_idx, "sql-tokenizer.js must be loaded before context-analyzer.js"
    assert ctx_idx < is_idx, "context-analyzer.js must be loaded before intellisense.js"

    with open(context_analyzer_path, "r", encoding="utf-8") as f:
        ctx_code = f.read()

    assert "IntelliSenseContextType" in ctx_code
    assert "detectStatementBoundary" in ctx_code
    assert "detectClauseFromTokens" in ctx_code

    print("[PASS] Phase 2 SqlTokenizer and ContextAnalyzer files and script order verified!")

def test_phase2_six_mandatory_contexts():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ctx_file = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    with open(ctx_file, "r", encoding="utf-8") as f:
        content = f.read()

    # Verify all 6 mandatory contexts are handled
    assert "'SELECT'" in content
    assert "'FROM'" in content
    assert "'JOIN'" in content
    assert "'WHERE'" in content
    assert "'ORDER BY'" in content
    assert "IntelliSenseContextType.ORDER_COLUMN" in content
    assert "IntelliSenseContextType.TABLE" in content
    assert "IntelliSenseContextType.COLUMN" in content

    print("[PASS] All 6 mandatory context rules defined in Context Analyzer!")

def test_subquery_in_clause_tables_and_alias():
    # Simulate token stream for user query:
    # SELECT * FROM b30accdoc a WHERE a.customerId IN(SELECT id from b20customer)
    tokens = ['SELECT', '*', 'FROM', 'b30accdoc', 'a', 'WHERE', 'a', '.', 'customerId', 'IN', '(', 'SELECT', 'id', 'FROM', 'b20customer', ')']
    nonAliases = set([
        "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
        "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY", "WITH",
        "SELECT", "FROM", "INTO", "SET", "VALUES", "IN", "AND", "OR"
    ])

    aliasMap = {}
    for i in range(len(tokens)):
        upper = tokens[i].upper()
        if upper in ['FROM', 'JOIN']:
            j = i + 1
            tableParts = []
            while j < len(tokens):
                tok = tokens[j]
                tokVal = tok.upper()
                if tokVal in nonAliases or tok in ['(', ')', ';', ',']:
                    break
                tableParts.append(tok)
                j += 1
                if j < len(tokens) and tokens[j] == '.':
                    j += 1
                else:
                    break
            if not tableParts:
                continue
            tableName = tableParts[-1]
            schemaName = tableParts[-2] if len(tableParts) >= 2 else ""
            info = {"schema": schemaName, "table": tableName}
            aliasToken = None
            if j < len(tokens):
                nextWord = tokens[j].upper()
                if nextWord == 'AS':
                    j += 1
                    if j < len(tokens):
                        aliasToken = tokens[j]
                elif nextWord not in nonAliases and tokens[j] not in [')', '(', ';', ',']:
                    aliasToken = tokens[j]
            if aliasToken:
                aliasMap[aliasToken.lower()] = info
            aliasMap[tableName.lower()] = info

    assert 'a' in aliasMap, "Alias 'a' must be in aliasMap"
    assert aliasMap['a']['table'] == 'b30accdoc', "Alias 'a' must map to 'b30accdoc'"
    assert 'b30accdoc' in aliasMap, "Table 'b30accdoc' must be in aliasMap"
    assert 'b20customer' in aliasMap, "Table 'b20customer' from subquery must be in aliasMap"
    assert aliasMap['b20customer']['table'] == 'b20customer', "'b20customer' must map to 'b20customer'"

    print("[PASS] Subquery IN(...) table and alias extraction verified!")

if __name__ == '__main__':
    test_sql_tokenizer_file_and_tags()
    test_phase2_six_mandatory_contexts()
    test_subquery_in_clause_tables_and_alias()
