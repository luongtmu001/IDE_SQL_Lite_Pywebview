import os

def test_metadata_provider_files_and_tags():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    provider_path = os.path.join(base_dir, "static", "js", "metadata-provider.js")
    index_html_path = os.path.join(base_dir, "templates", "index.html")

    assert os.path.exists(provider_path), "metadata-provider.js must exist"

    with open(provider_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify Base MetadataProvider contract (Section 15) with connectionId
    assert "class MetadataProvider" in code
    assert "async getDatabases(connectionId)" in code
    assert "async getSchemas(connectionId, database)" in code
    assert "async getTables(connectionId, database, schema)" in code
    assert "async getViews(connectionId, database, schema)" in code
    assert "async getColumns(connectionId, database, schema, table)" in code
    assert "async getProcedures(connectionId, database, schema)" in code
    assert "async getFunctions(connectionId, database, schema)" in code
    assert "async getSynonyms(connectionId, database, schema)" in code
    assert "async getParameters(connectionId, database, schema, name)" in code
    assert "async getDefinition(connectionId, database, schema, name, type)" in code
    assert "async getSupportedTypes(connectionId, database)" in code

    # Verify Concrete Adapter & Dialects (Sections 16, 17 & 66)
    assert "class ProjectMetadataAdapter" in code
    assert "class SqlServerMetadataProvider" in code
    assert "class PostgresMetadataProvider" in code
    assert "class MetadataProviderFactory" in code
    assert "static registerConnection(connectionId, dbType)" in code
    assert "static getDbTypeForConnection(connectionId)" in code
    assert "static getProviderForConnection(connectionId)" in code

    # Verify Plan v2 Section 15 includes connectionId parameter
    plan_path = os.path.join(base_dir, ".SKILL", "intellisense_improvement_plan_v2.md")
    with open(plan_path, "r", encoding="utf-8") as f:
        plan_code = f.read()

    assert "async getDatabases(connectionId)" in plan_code
    assert "async getTables(connectionId, database, schema)" in plan_code
    assert "async getColumns(connectionId, database, schema, table)" in plan_code

    # Verify script loading order in templates/index.html
    with open(index_html_path, "r", encoding="utf-8") as f:
        html = f.read()

    tok_idx = html.find("sql-tokenizer.js")
    scope_idx = html.find("scope-resolver.js")
    ctx_idx = html.find("context-analyzer.js")
    meta_idx = html.find("metadata-provider.js")
    is_idx = html.find("intellisense.js")

    assert tok_idx != -1, "index.html must load sql-tokenizer.js"
    assert scope_idx != -1, "index.html must load scope-resolver.js"
    assert ctx_idx != -1, "index.html must load context-analyzer.js"
    assert meta_idx != -1, "index.html must load metadata-provider.js"
    assert is_idx != -1, "index.html must load intellisense.js"

    # Strict order: tokenizer -> scope-resolver -> context-analyzer -> metadata-provider -> intellisense
    assert tok_idx < scope_idx
    assert scope_idx < ctx_idx
    assert ctx_idx < meta_idx
    assert meta_idx < is_idx

    print("[PASS] MetadataProvider files, connectionId signatures, and script loading order verified!")

def test_metadata_provider_integration_with_intellisense():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")

    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    # Verify IntelliSenseDataProvider connects to MetadataProviderFactory
    assert "MetadataProviderFactory" in is_code
    assert "getProvider(connectionId, dbType)" in is_code
    assert "provider.getObjects" in is_code
    assert "provider.getColumns" in is_code
    assert "provider.getParameters" in is_code
    assert "provider.getDefinition" in is_code
    assert "provider.getSupportedTypes" in is_code

    print("[PASS] IntelliSenseDataProvider integration with MetadataProvider verified!")

def test_dialect_identifier_quoting():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    provider_path = os.path.join(base_dir, "static", "js", "metadata-provider.js")

    with open(provider_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify SQL Server brackets
    assert "clean.startsWith('[')" in code or "s.startsWith('[')" in code
    assert "`[${clean}]`" in code

    # Verify PostgreSQL quotes
    assert "clean.startsWith('\"')" in code or "s.startsWith('\"')" in code
    assert "`\"${clean}\"`" in code

    print("[PASS] Dialect identifier quoting rules verified!")

if __name__ == '__main__':
    test_metadata_provider_files_and_tags()
    test_metadata_provider_integration_with_intellisense()
    test_dialect_identifier_quoting()

if __name__ == '__main__':
    test_metadata_provider_files_and_tags()
    test_metadata_provider_integration_with_intellisense()
    test_dialect_identifier_quoting()
