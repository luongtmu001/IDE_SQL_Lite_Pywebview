import os

def test_scope_resolver_file_and_script_tags():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scope_path = os.path.join(base_dir, "static", "js", "scope-resolver.js")
    index_html_path = os.path.join(base_dir, "templates", "index.html")

    assert os.path.exists(scope_path), "scope-resolver.js must exist"

    with open(scope_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "class SqlSymbol" in code
    assert "class SymbolTable" in code
    assert "class AliasResolver" in code
    assert "class QualifiedIdentifierResolver" in code
    assert "class ScopeResolver" in code
    assert "window.Symbol =" not in code, "Must NEVER overwrite native window.Symbol!"

    with open(index_html_path, "r", encoding="utf-8") as f:
        html = f.read()

    tok_idx = html.find("sql-tokenizer.js")
    scope_idx = html.find("scope-resolver.js")
    ctx_idx = html.find("context-analyzer.js")
    is_idx = html.find("intellisense.js")

    assert tok_idx != -1, "index.html must load sql-tokenizer.js"
    assert scope_idx != -1, "index.html must load scope-resolver.js"
    assert ctx_idx != -1, "index.html must load context-analyzer.js"
    assert is_idx != -1, "index.html must load intellisense.js"

    # Verify script loading order: tokenizer -> scope-resolver -> context-analyzer -> intellisense
    assert tok_idx < scope_idx, "sql-tokenizer.js must be loaded before scope-resolver.js"
    assert scope_idx < ctx_idx, "scope-resolver.js must be loaded before context-analyzer.js"
    assert ctx_idx < is_idx, "context-analyzer.js must be loaded before intellisense.js"

    print("[PASS] Phase 3 ScopeResolver files and script loading order verified!")

def test_scope_resolver_multi_table_join():
    # Simulation of ScopeResolver algorithm on:
    # FROM Customer c JOIN Orders o ON o.CustomerId = c.Id
    class MockSymbol:
        def __init__(self, name, alias='', schema=''):
            self.name = name
            self.alias = alias
            self.schema = schema

    class MockSymbolTable:
        def __init__(self):
            self.symbols = {}
            self.aliases = {}
        def add(self, sym):
            self.symbols[sym.name.lower()] = sym
            if sym.alias:
                self.aliases[sym.alias.lower()] = sym
        def resolve(self, ident):
            k = ident.lower()
            if k in self.aliases:
                return self.aliases[k]
            if k in self.symbols:
                return self.symbols[k]
            return None

    table = MockSymbolTable()
    table.add(MockSymbol("Customer", alias="c", schema="dbo"))
    table.add(MockSymbol("Orders", alias="o", schema="dbo"))

    # Test Section 65 requirements:
    # WHERE c. -> Customer
    # WHERE o. -> Orders
    res_c = table.resolve("c")
    assert res_c is not None, "Alias 'c' must resolve"
    assert res_c.name == "Customer", "Alias 'c' must resolve to Customer"
    assert res_c.schema == "dbo", "Schema must be dbo"

    res_o = table.resolve("o")
    assert res_o is not None, "Alias 'o' must resolve"
    assert res_o.name == "Orders", "Alias 'o' must resolve to Orders"

    # Direct table name resolution: Customer. -> Customer
    res_cust = table.resolve("Customer")
    assert res_cust is not None
    assert res_cust.name == "Customer"

    print("[PASS] Multi-table JOIN (Customer c JOIN Orders o) resolution verified!")

def test_subquery_scope_hierarchy():
    # Simulation of Scope Tree:
    # Outer Query: SELECT * FROM b30accdoc a WHERE a.customerId IN (SELECT id FROM b20customer c WHERE c.)
    class MockScope:
        def __init__(self, parent=None):
            self.parent = parent
            self.symbols = {}
            self.aliases = {}
        def add(self, name, alias=''):
            self.symbols[name.lower()] = name
            if alias:
                self.aliases[alias.lower()] = name
        def resolve(self, ident):
            k = ident.lower()
            if k in self.aliases:
                return self.aliases[k]
            if k in self.symbols:
                return self.symbols[k]
            if self.parent:
                return self.parent.resolve(ident)
            return None

    root_scope = MockScope(parent=None)
    root_scope.add("b30accdoc", alias="a")

    sub_scope = MockScope(parent=root_scope)
    sub_scope.add("b20customer", alias="c")

    # In subquery scope: both 'c' and 'a' should resolve (lexical scoping)
    assert sub_scope.resolve("c") == "b20customer", "c in subquery must resolve to b20customer"
    assert sub_scope.resolve("a") == "b30accdoc", "a from parent query must be visible in subquery"

    # In outer/root scope: 'a' resolves, but subquery alias 'c' is NOT visible (isolated scope)
    assert root_scope.resolve("a") == "b30accdoc", "a must resolve in root scope"
    assert root_scope.resolve("c") is None, "Subquery alias 'c' must NOT leak into root scope"

    print("[PASS] Subquery Scope hierarchy and isolation verified!")

def test_scope_resolver_referenced_columns_and_synonym_resolution():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scope_path = os.path.join(base_dir, "static", "js", "scope-resolver.js")
    with open(scope_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify that scope-resolver.js scans for referenced columns on aliases (e.g. c.Id)
    assert "Scan for referenced columns on aliases" in code
    assert "codeTokens[k + 1].value === '.'" in code
    assert "sym.columns.push" in code
    assert "columns: resolved.columns || []" in code

    # Verify synonym resolution in SQL Server adapter
    sqlserver_path = os.path.join(base_dir, "app", "database", "sqlserver.py")
    with open(sqlserver_path, "r", encoding="utf-8") as f:
        sqlserver_code = f.read()
    assert "sys.synonyms" in sqlserver_code
    assert "PARSENAME(sn.base_object_name, 3)" in sqlserver_code

    print("[PASS] Referenced columns and synonym resolution verified!")

if __name__ == '__main__':
    test_scope_resolver_file_and_script_tags()
    test_scope_resolver_multi_table_join()
    test_subquery_scope_hierarchy()
    test_scope_resolver_referenced_columns_and_synonym_resolution()

