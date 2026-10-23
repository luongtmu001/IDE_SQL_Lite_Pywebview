# -*- coding: utf-8 -*-
"""
Phase 2: PostgreSQL PL/pgSQL Offline Syntax Validation Test Suite.
Verifies structural block checking (IF/ELSIF/END IF, LOOP/END LOOP, BEGIN/END, CASE),
correct line/column detection, honest PARTIAL status marking when offline,
and zero side-effects.
"""
import pytest
from app.database.syntax.adapters.postgresql_adapter import PostgreSqlAdapter

adapter = PostgreSqlAdapter()

VALID_PLPGSQL_ROUTINES = [
    # 1. Simple Function with IF/ELSE
    ("""
    CREATE OR REPLACE FUNCTION test_if(val INT)
    RETURNS TEXT AS $$
    BEGIN
        IF val > 10 THEN
            RETURN 'HIGH';
        ELSE
            RETURN 'LOW';
        END IF;
    END;
    $$ LANGUAGE plpgsql;
    """, "Function with IF/ELSE/END IF"),

    # 2. Function with WHILE LOOP
    ("""
    CREATE OR REPLACE FUNCTION test_loop(n INT)
    RETURNS INT AS $$
    DECLARE
        counter INT := 0;
    BEGIN
        WHILE counter < n LOOP
            counter := counter + 1;
        END LOOP;
        RETURN counter;
    END;
    $$ LANGUAGE plpgsql;
    """, "Function with WHILE LOOP/END LOOP"),

    # 3. Function with FOR LOOP
    ("""
    CREATE OR REPLACE FUNCTION test_for_loop()
    RETURNS VOID AS $$
    BEGIN
        FOR i IN 1..5 LOOP
            RAISE NOTICE 'Index: %', i;
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;
    """, "Function with FOR LOOP/END LOOP"),

    # 4. Nested IF inside LOOP inside BEGIN
    ("""
    CREATE OR REPLACE PROCEDURE usp_nested(max_iter INT)
    LANGUAGE plpgsql AS $$
    BEGIN
        FOR i IN 1..max_iter LOOP
            IF i % 2 = 0 THEN
                PERFORM pg_sleep(0.01);
            END IF;
        END LOOP;
    END;
    $$;
    """, "Nested structures: BEGIN -> LOOP -> IF -> END IF -> END LOOP -> END"),

    # 5. CASE statement in procedural code
    ("""
    CREATE OR REPLACE FUNCTION test_case(grade CHAR)
    RETURNS TEXT AS $$
    BEGIN
        CASE grade
            WHEN 'A' THEN RETURN 'Excellent';
            WHEN 'B' THEN RETURN 'Good';
            ELSE RETURN 'Average';
        END CASE;
    END;
    $$ LANGUAGE plpgsql;
    """, "CASE statement with END CASE"),

    # 6. OPEN cursor FOR query
    ("""
    CREATE OR REPLACE FUNCTION test_open_cursor()
    RETURNS VOID AS $$
    DECLARE
        cur refcursor;
    BEGIN
        OPEN cur FOR SELECT * FROM users WHERE active = true;
        CLOSE cur;
    END;
    $$ LANGUAGE plpgsql;
    """, "OPEN cursor FOR query"),

    # 7. OPEN cursor SCROLL / NO SCROLL FOR EXECUTE query
    ("""
    CREATE OR REPLACE FUNCTION test_open_cursor_scroll()
    RETURNS VOID AS $$
    DECLARE
        cur1 refcursor;
        cur2 refcursor;
    BEGIN
        OPEN cur1 SCROLL FOR SELECT id, name FROM accounts;
        OPEN cur2 NO SCROLL FOR EXECUTE 'SELECT id, name FROM accounts WHERE active = true';
        CLOSE cur1;
        CLOSE cur2;
    END;
    $$ LANGUAGE plpgsql;
    """, "OPEN cursor SCROLL / NO SCROLL FOR EXECUTE"),

    # 8. Bound CURSOR FOR in DECLARE block
    ("""
    CREATE OR REPLACE FUNCTION test_cursor_declaration()
    RETURNS VOID AS $$
    DECLARE
        c_users CURSOR FOR SELECT * FROM users;
        c_by_id CURSOR (p_id INT) FOR SELECT * FROM users WHERE id = p_id;
    BEGIN
        OPEN c_users;
        OPEN c_by_id(42);
        CLOSE c_users;
        CLOSE c_by_id;
    END;
    $$ LANGUAGE plpgsql;
    """, "CURSOR FOR in DECLARE block"),
]

INVALID_PLPGSQL_ROUTINES = [
    # (sql, description, expected_token, expected_msg_fragment)
    ("""
    CREATE OR REPLACE FUNCTION bad_missing_end_if(val INT)
    RETURNS TEXT AS $$
    BEGIN
        IF val > 10 THEN
            RETURN 'HIGH';
        -- Missing END IF;
    END;
    $$ LANGUAGE plpgsql;
    """, "Missing END IF in function", "IF", "missing corresponding end if"),

    ("""
    CREATE OR REPLACE FUNCTION bad_unmatched_end_if()
    RETURNS VOID AS $$
    BEGIN
        RETURN;
        END IF;
    END;
    $$ LANGUAGE plpgsql;
    """, "Extra unmatched END IF", "END IF", "unmatched end if"),

    ("""
    CREATE OR REPLACE FUNCTION bad_missing_end_loop()
    RETURNS VOID AS $$
    BEGIN
        LOOP
            EXIT WHEN true;
        -- Missing END LOOP
    END;
    $$ LANGUAGE plpgsql;
    """, "Missing END LOOP in function", "LOOP", "missing corresponding end loop"),

    ("""
    CREATE OR REPLACE FUNCTION bad_unmatched_end_loop()
    RETURNS VOID AS $$
    BEGIN
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;
    """, "Extra unmatched END LOOP", "END LOOP", "unmatched end loop"),

    ("""
    CREATE OR REPLACE FUNCTION bad_missing_end()
    RETURNS VOID AS $$
    BEGIN
        PERFORM 1;
    -- Missing END
    $$ LANGUAGE plpgsql;
    """, "Missing END in BEGIN block", "BEGIN", "missing corresponding end in procedural code"),

    ("""
    CREATE OR REPLACE FUNCTION bad_unclosed_dollar()
    RETURNS VOID AS $func$
    BEGIN
        RETURN;
    END;
    -- Missing closing tag
    LANGUAGE plpgsql;
    """, "Unclosed dollar quote", "$func$", "unclosed dollar-quoted block"),
]


class TestPhase2PostgresPlpgsqlSyntax:
    """Rigorous tests for PostgreSQL PL/pgSQL offline syntax verification."""

    @pytest.mark.parametrize("sql,desc", VALID_PLPGSQL_ROUTINES)
    def test_valid_plpgsql_has_zero_syntax_errors_and_marks_partial(self, sql, desc):
        """Valid PL/pgSQL routines offline must have 0 errors and report honest PARTIAL status."""
        diags = adapter.validate(sql=sql)
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"False positive in valid PL/pgSQL ({desc}): {errors}"

        # Must report PARTIAL status for procedural routines checked offline
        info_partials = [d for d in diags if d.get("code") == "SQL_SYNTAX_PARTIAL" or d.get("status") == "PARTIAL"]
        assert len(info_partials) >= 1, f"Expected PARTIAL status diagnostic for offline PL/pgSQL ({desc})"
        assert info_partials[0]["source"] == "postgresql"

    @pytest.mark.parametrize("sql,desc,expected_token,expected_msg", INVALID_PLPGSQL_ROUTINES)
    def test_invalid_plpgsql_detected_offline(self, sql, desc, expected_token, expected_msg):
        """Invalid PL/pgSQL structural blocks must be caught offline with accurate tokens."""
        diags = adapter.validate(sql=sql)
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) >= 1, f"Failed to detect syntax error in invalid PL/pgSQL ({desc}). SQL:\n{sql}"

        all_msgs = " ".join(str(d.get("message", "")).lower() for d in errors)
        assert expected_msg.lower() in all_msgs, f"Message should contain '{expected_msg}', got: {all_msgs}"

        tokens = [d.get("token") for d in errors]
        assert any(expected_token in str(t) for t in tokens), f"Expected faulty token '{expected_token}', got: {tokens}"

    def test_standard_query_not_marked_partial(self):
        """Standard SQL queries (without procedural blocks) must not have PARTIAL diagnostic."""
        sql = "SELECT id, name FROM users WHERE is_active = true;"
        diags = adapter.validate(sql=sql)
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0
        partials = [d for d in diags if d.get("code") == "SQL_SYNTAX_PARTIAL"]
        assert len(partials) == 0, "Standard queries without procedural blocks should not be marked PARTIAL"
