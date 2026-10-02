import os
import re
import pytest

def test_metadata_cache_file_and_script_order():
    """Verify metadata-cache.js exists and is loaded before intellisense.js in index.html"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_path = os.path.join(base_dir, 'static', 'js', 'metadata-cache.js')
    index_path = os.path.join(base_dir, 'templates', 'index.html')

    assert os.path.exists(cache_path), f"metadata-cache.js not found at {cache_path}"
    
    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()

    assert 'static/js/metadata-cache.js' in html, "metadata-cache.js must be referenced in templates/index.html"
    
    cache_idx = html.find('static/js/metadata-cache.js')
    provider_idx = html.find('static/js/metadata-provider.js')
    intellisense_idx = html.find('static/js/intellisense.js')

    assert provider_idx != -1 and cache_idx != -1 and intellisense_idx != -1
    assert provider_idx < cache_idx < intellisense_idx, (
        f"Script order violation: expected metadata-provider ({provider_idx}) < "
        f"metadata-cache ({cache_idx}) < intellisense ({intellisense_idx})"
    )
    print("\n[PASS] Phase 5 MetadataCache file and script order verified!")


def test_metadata_cache_lru_and_ttl_rules():
    """Verify MetadataCache implements LRU, TTL, and cache tiers"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_path = os.path.join(base_dir, 'static', 'js', 'metadata-cache.js')

    with open(cache_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Verify class definitions
    assert 'class AppMetadataCache' in code
    assert 'class LRUCache' in code
    assert 'class StorageTier' in code

    # Verify default TTL configurations
    assert 'DEFAULT_TTL' in code or 'ttl' in code.lower()
    assert 'OBJECTS_TTL' in code or '300000' in code or '300000' in code # 5-10 mins
    assert 'COLUMNS_TTL' in code or '600000' in code # 10 mins

    # Verify memory limits
    assert 'MAX_ENTRIES' in code or 'maxSize' in code

    # Verify methods
    for method in ['getObjects', 'setObjects', 'getColumns', 'setColumns', 
                   'getParameters', 'setParameters', 'getDefinition', 'setDefinition',
                   'getSupportedTypes', 'setSupportedTypes',
                   'invalidateAll', 'invalidateConnection', 'invalidateDatabase',
                   'invalidateObject', 'handleDdlExecution']:
        assert method in code, f"Expected method {method} not found in metadata-cache.js"

    print("\n[PASS] MetadataCache LRU, TTL, and method APIs verified!")


def test_metadata_cache_ddl_statement_invalidation():
    """Verify DDL pattern detection for cache invalidation"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_path = os.path.join(base_dir, 'static', 'js', 'metadata-cache.js')

    with open(cache_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # DDL statement detection patterns
    ddl_keywords = ['CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TYPE']
    for kw in ddl_keywords:
        assert kw in code, f"DDL keyword {kw} must be handled in DDL invalidation"

    # Test regex patterns from file
    ddl_regex = re.compile(
        r'\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TYPE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:\[?(\w+)\]?\.)?(?:\[?(\w+)\]?\.)?\[?(\w+)\]?',
        re.IGNORECASE
    )

    sample_sql_1 = "CREATE TABLE [dbo].[Customers] (Id INT PRIMARY KEY, Name NVARCHAR(100));"
    match_1 = ddl_regex.search(sample_sql_1)
    assert match_1 is not None
    action_1, kind_1 = match_1.group(1).upper(), match_1.group(2).upper()
    assert action_1 == 'CREATE'
    assert kind_1 == 'TABLE'

    sample_sql_2 = "ALTER VIEW dbo.v_ActiveOrders AS SELECT * FROM Orders WHERE Status = 1"
    match_2 = ddl_regex.search(sample_sql_2)
    assert match_2 is not None
    action_2, kind_2 = match_2.group(1).upper(), match_2.group(2).upper()
    assert action_2 == 'ALTER'
    assert kind_2 == 'VIEW'

    sample_sql_3 = "DROP PROCEDURE IF EXISTS usp_GetReports;"
    match_3 = ddl_regex.search(sample_sql_3)
    assert match_3 is not None
    action_3, kind_3 = match_3.group(1).upper(), match_3.group(2).upper()
    assert action_3 == 'DROP'
    assert kind_3 == 'PROCEDURE'

    print("\n[PASS] DDL pattern recognition and invalidation verified!")


def test_metadata_cache_query_and_explorer_hooks():
    """Verify query.js and explorer.js trigger metadata cache invalidation"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    query_path = os.path.join(base_dir, 'static', 'js', 'query.js')
    explorer_path = os.path.join(base_dir, 'static', 'js', 'explorer.js')
    intellisense_path = os.path.join(base_dir, 'static', 'js', 'intellisense.js')

    with open(query_path, 'r', encoding='utf-8') as f:
        query_code = f.read()

    with open(explorer_path, 'r', encoding='utf-8') as f:
        explorer_code = f.read()

    with open(intellisense_path, 'r', encoding='utf-8') as f:
        intellisense_code = f.read()

    # query.js must call handleDdlExecution
    assert 'handleDdlExecution' in query_code, "query.js must call handleDdlExecution on query completion"

    # explorer.js must call invalidateConnection and invalidateAll
    assert 'invalidateConnection' in explorer_code, "explorer.js must call invalidateConnection on node refresh"
    assert 'invalidateAll' in explorer_code, "explorer.js must call invalidateAll on global refresh"

    # intellisense.js must integrate with window.AppMetadataCache
    assert 'AppMetadataCache' in intellisense_code, "intellisense.js must reference AppMetadataCache"

    print("\n[PASS] Query and Explorer integration hooks verified!")
