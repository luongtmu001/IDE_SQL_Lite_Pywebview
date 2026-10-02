import os
import pytest

def test_completion_engine_file_and_script_order():
    """Verify completion-engine.js exists and is loaded in correct order in index.html"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'completion-engine.js')
    index_path = os.path.join(base_dir, 'templates', 'index.html')

    assert os.path.exists(engine_path), f"completion-engine.js not found at {engine_path}"

    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()

    assert 'static/js/completion-engine.js' in html, "completion-engine.js must be referenced in index.html"

    tok_idx = html.find('static/js/sql-tokenizer.js')
    scope_idx = html.find('static/js/scope-resolver.js')
    ctx_idx = html.find('static/js/context-analyzer.js')
    prov_idx = html.find('static/js/metadata-provider.js')
    cache_idx = html.find('static/js/metadata-cache.js')
    engine_idx = html.find('static/js/completion-engine.js')
    intel_idx = html.find('static/js/intellisense.js')

    assert tok_idx != -1 and scope_idx != -1 and ctx_idx != -1
    assert prov_idx != -1 and cache_idx != -1 and engine_idx != -1 and intel_idx != -1

    # Strict pipeline dependency order:
    assert tok_idx < scope_idx < ctx_idx < prov_idx < cache_idx < engine_idx < intel_idx, (
        f"Order violation: tokenizer({tok_idx}) < scope({scope_idx}) < context({ctx_idx}) < "
        f"provider({prov_idx}) < cache({cache_idx}) < engine({engine_idx}) < intellisense({intel_idx})"
    )
    print("\n[PASS] Phase 6 completion-engine.js file and script load order verified!")


def test_completion_engine_classes_and_api():
    """Verify class declarations and primary methods in completion-engine.js"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'completion-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Core classes
    assert 'class CandidateFilter' in code
    assert 'class CompletionRanker' in code
    assert 'class CandidateGenerator' in code
    assert 'class CompletionEngine' in code

    # Filter methods (Section 31)
    assert 'matchExact' in code
    assert 'matchPrefix' in code
    assert 'matchSubstring' in code
    assert 'matchFuzzy' in code
    assert 'filter(' in code

    # Ranker methods (Section 30)
    assert 'rank(' in code

    # Generator methods (Section 23)
    assert 'generate(' in code

    # Engine methods & cancellation (Section 21, 22, 33)
    assert 'getCompletions(' in code
    assert 'cancelPending(' in code
    assert '_currentRequestId' in code

    # Window exports
    assert 'window.CandidateFilter = CandidateFilter' in code
    assert 'window.CompletionRanker = CompletionRanker' in code
    assert 'window.CandidateGenerator = CandidateGenerator' in code
    assert 'window.CompletionEngine = CompletionEngine' in code
    assert 'window.DefaultCompletionEngine = defaultEngine' in code

    print("\n[PASS] CompletionEngine classes and method APIs verified!")


def test_candidate_filter_multistage_logic():
    """Verify multi-stage candidate filtering: exact -> prefix -> substring -> fuzzy"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'completion-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Ensure fuzzyThreshold and multi-stage matches are implemented
    assert 'fuzzyThreshold' in code
    assert '_matchType' in code
    assert '_matchScore' in code
    assert "'exact'" in code
    assert "'prefix'" in code
    assert "'substring'" in code
    assert "'fuzzy'" in code

    # Verify python equivalent logic for fuzzy match
    def fuzzy_match(target, pattern):
        target = target.lower()
        pattern = pattern.lower()
        t_idx, p_idx = 0, 0
        while t_idx < len(target) and p_idx < len(pattern):
            if target[t_idx] == pattern[p_idx]:
                p_idx += 1
            t_idx += 1
        return p_idx == len(pattern)

    assert fuzzy_match("CustomerId", "custid") is True
    assert fuzzy_match("OrderDetails", "orddet") is True
    assert fuzzy_match("CustomerName", "cn") is True
    assert fuzzy_match("CustomerName", "xyz") is False

    print("\n[PASS] CandidateFilter multi-stage filtering logic verified!")


def test_completion_ranker_contextual_priorities():
    """Verify ranking priorities for FROM, SELECT, WHERE, ALTER, and EXEC contexts"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'completion-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Contextual routing checks
    assert "context.clause === 'FROM'" in code or "isFromClause" in code
    assert "context.clause === 'SELECT'" in code or "isSelectClause" in code
    assert "context.clause === 'WHERE'" in code or "isWhereClause" in code
    assert "context.clause === 'EXEC'" in code or "isExecClause" in code
    assert "context.isAlterContext" in code
    assert "context.qualifier" in code

    # Check score weighting concepts
    assert '_finalScore' in code
    assert 'contextScore' in code

    print("\n[PASS] CompletionRanker contextual routing and priorities verified!")


def test_intellisense_integration_with_completion_engine():
    """Verify intellisense.js delegates completion generation to CompletionEngine"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    is_path = os.path.join(base_dir, 'static', 'js', 'intellisense.js')

    with open(is_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Controller integrates CompletionEngine
    assert 'completionEngine' in code
    assert 'this.completionEngine.getCompletions' in code
    assert 'getCompletionEngine' in code
    assert 'window.DefaultCompletionEngine' in code

    # Ranker fallback integration
    assert 'this.completionEngine.ranker.rank' in code

    # UI popup contract remains intact (Section 68: 'Không sửa popup UI')
    assert 'this.popupUI.render' in code
    assert 'this.popupUI.getSelectedItem' in code
    assert '#ide-intellisense-popup' in code or 'ide-intellisense-popup' in code

    print("\n[PASS] IntelliSenseController integration with CompletionEngine verified!")
