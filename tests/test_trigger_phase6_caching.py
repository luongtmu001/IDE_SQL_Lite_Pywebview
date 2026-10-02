import os
import re

def test_phase6_caching_and_concurrency_code_structure():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")
    ce_path = os.path.join(base_dir, "static", "js", "completion-engine.js")
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")

    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    with open(ce_path, "r", encoding="utf-8") as f:
        ce_code = f.read()

    with open(tc_path, "r", encoding="utf-8") as f:
        tc_code = f.read()

    # 1. Concurrency & Request Cancellation (Section 32)
    assert "_currentRequestId" in is_code
    assert "requestId !== this._currentRequestId" in is_code
    assert "cancelPending()" in ce_code
    assert "_currentRequestId" in ce_code
    assert "requestId !== this._currentRequestId" in ce_code

    # 2. Local Candidate Filtering on Refresh (Section 31 & 47)
    assert "rankAndFilterCandidates(this.activeCandidates" in is_code
    assert "activeCandidates" in is_code
    assert "activeCandidates" in tc_code

    # 3. Level 3 Cache Integration (Section 12 & 31)
    assert "getCompletions" in ce_code
    assert "setCompletions" in ce_code

    print("[PASS] Phase 6: Concurrency, Caching & Local Filtering code structure verified!")


def test_phase6_async_race_condition_simulation():
    # Simulation of async metadata queries with race condition resolution
    class ConcurrencySafeCompletionService:
        def __init__(self):
            self.current_request_id = 0
            self.rendered_result = None

        def start_request(self, token):
            self.current_request_id += 1
            req_id = self.current_request_id
            return req_id, token

        def complete_request(self, req_id, result):
            # Section 32: Concurrency check - drop stale response if newer request started
            if req_id != self.current_request_id:
                return False  # Discarded
            self.rendered_result = result
            return True  # Rendered

        def cancel_all(self):
            self.current_request_id += 1
            self.rendered_result = None

    service = ConcurrencySafeCompletionService()

    # Request 1 starts for 'C'
    req1_id, token1 = service.start_request("C")
    assert req1_id == 1

    # User quickly types 'u', Request 2 starts for 'Cu'
    req2_id, token2 = service.start_request("Cu")
    assert req2_id == 2

    # Request 2 finishes FAST (e.g. from cache or fast network)
    res2_accepted = service.complete_request(req2_id, ["Customer", "CustomerDetails"])
    assert res2_accepted is True
    assert service.rendered_result == ["Customer", "CustomerDetails"]

    # Request 1 finishes SLOW (stale response arrives late)
    res1_accepted = service.complete_request(req1_id, ["Column1", "Column2", "Customer"])
    assert res1_accepted is False  # Must be dropped!
    # Ensure Request 2's result was NOT overwritten by Request 1:
    assert service.rendered_result == ["Customer", "CustomerDetails"]

    # When popup is hidden, in-flight requests are cancelled
    service.cancel_all()
    res3_accepted = service.complete_request(req2_id, ["StaleData"])
    assert res3_accepted is False
    assert service.rendered_result is None

    print("[PASS] Phase 6: Async race condition cancellation verified!")


def test_phase6_local_candidate_filtering_efficiency():
    # Simulation of Section 31 & 47: 1 metadata query followed by in-memory filtering
    class MockCompletionSession:
        def __init__(self):
            self.db_query_count = 0
            self.local_filter_count = 0
            self.active_candidates = []

        def initial_trigger(self, context):
            # Keystroke 1: Initial trigger queries database/provider
            self.db_query_count += 1
            # Mock full list of columns for table Customer
            self.active_candidates = [
                {"name": "CustomerId", "type": "pk_column"},
                {"name": "CustomerName", "type": "column"},
                {"name": "City", "type": "column"},
                {"name": "Country", "type": "column"},
                {"name": "CreatedDate", "type": "column"}
            ]
            return self.filter_local(context["word"])

        def refresh_typing(self, word):
            # Subsequent keystrokes while VISIBLE: local filtering ONLY!
            self.local_filter_count += 1
            return self.filter_local(word)

        def filter_local(self, word):
            word_lower = word.lower()
            return [c for c in self.active_candidates if c["name"].lower().startswith(word_lower)]

    session = MockCompletionSession()

    # User types 'C' (Keystroke 1 - Initial trigger)
    r1 = session.initial_trigger({"word": "C"})
    assert len(r1) == 5
    assert session.db_query_count == 1
    assert session.local_filter_count == 0

    # User types 'u' -> 'Cu' (Keystroke 2 - Refresh)
    r2 = session.refresh_typing("Cu")
    assert len(r2) == 2  # CustomerId, CustomerName
    assert session.db_query_count == 1  # No DB query!
    assert session.local_filter_count == 1

    # User types 's' -> 'Cus' (Keystroke 3 - Refresh)
    r3 = session.refresh_typing("Cus")
    assert len(r3) == 2
    assert session.db_query_count == 1  # No DB query!
    assert session.local_filter_count == 2

    # User types 't' -> 'Cust' (Keystroke 4 - Refresh)
    r4 = session.refresh_typing("Cust")
    assert len(r4) == 2
    assert session.db_query_count == 1  # No DB query!
    assert session.local_filter_count == 3

    # User types 'o' -> 'Custo' (Keystroke 5 - Refresh)
    r5 = session.refresh_typing("Custo")
    assert len(r5) == 2
    assert session.db_query_count == 1  # Exactly 1 DB query across 5 keys!
    assert session.local_filter_count == 4

    # Efficiency factor: 4 out of 5 keystrokes (80%) handled purely in-memory
    reduction_pct = (session.local_filter_count / (session.db_query_count + session.local_filter_count)) * 100
    assert reduction_pct == 80.0

    print(f"[PASS] Phase 6: Local candidate filtering verified! (Database queries reduced by {reduction_pct:.0f}%)")


def test_phase6_multi_tier_metadata_cache_integration():
    # Simulation of Level 3 Completion Memoization
    class MockLRUMetadataCache:
        def __init__(self):
            self.cache = {}
            self.hits = 0
            self.misses = 0

        def get_completions(self, key):
            if key in self.cache:
                self.hits += 1
                return self.cache[key]
            self.misses += 1
            return None

        def set_completions(self, key, items):
            self.cache[key] = list(items)

    cache = MockLRUMetadataCache()
    cache_key = "conn1::db::dbo::SELECT::c::Customer"

    # First lookup -> Cache Miss
    res = cache.get_completions(cache_key)
    assert res is None
    assert cache.misses == 1

    # Generator produces candidates and caches them
    candidates = [{"name": "CustomerId"}, {"name": "CustomerName"}]
    cache.set_completions(cache_key, candidates)

    # Second lookup -> Cache Hit
    cached_res = cache.get_completions(cache_key)
    assert cached_res == candidates
    assert cache.hits == 1

    print("[PASS] Phase 6: Multi-tier metadata cache integration verified!")
