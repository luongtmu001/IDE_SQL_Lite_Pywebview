# Baseline Test Report (Phase 0)

- **Thời điểm đo**: 2026-10-14 17:26:45
- **Môi trường Python**: Python 3.14.3 (`cp314-win_amd64`)
- **Phiên bản Pytest**: 9.1.1
- **Phạm vi kiểm thử**: `tests/` (bỏ qua `scratch/`)
- **Lệnh thực thi**: `pytest tests/ --ignore=scratch --tb=short`
- **Kết quả tổng quan**: **718 passed**, **19 failed** (tổng số 737 tests trong 64.79s)

---

## 1. Danh sách 19 Test FAILED (Đỏ ban đầu)

Dưới đây là 19 bài kiểm thử đỏ ghi nhận tại thời điểm baseline. Nhiều bài trong số này là các lỗi logic đã được nhận diện trong tài liệu kế hoạch (Phase 3, Phase 4, Phase 5):

| STT | File test | Tên test | Ghi chú / Lỗi chính |
|---|---|---|---|
| 1 | `tests/test_advanced_sql_phase8.py` | `test_advanced_sql_derived_table_subquery_projection` | Cú pháp / Subquery projection parser |
| 2 | `tests/test_diff_view_close_behavior.py` | `test_dist_sync` | Kiểm tra đồng bộ file trong `dist/` |
| 3 | `tests/test_explorer_sequences_and_types.py` | `test_metadata_api_sequences_and_types` | Sequences / Types metadata response |
| 4 | `tests/test_file_history_sidebar.py` | `test_distribution_sync` | Kiểm tra đồng bộ distribution files |
| 5 | `tests/test_history_restore_undo.py` | `test_dist_sync` | Kiểm tra đồng bộ `dist/` |
| 6 | `tests/test_history_titlebar_sync.py` | `test_strict_constraints_and_distribution_sync` | Titlebar sync & dist distribution |
| 7 | `tests/test_intellisense_fixes_plan.py` | `test_issue2_newline_guard_and_clean_context_triggers` | Trigger controller newline guard |
| 8 | `tests/test_postgresql_debug_mode.py` | `TestDebugQueryExecutionAPI.test_main_execute_query_passes_debug_mode` | Debug query execution parameter forwarding |
| 9 | `tests/test_postgresql_debug_mode.py` | `TestDebugQueryExecutionAPI.test_normal_mode_bs_check_priority_and_modal_chaining` | Chaining modal & debug mode |
| 10 | `tests/test_sql_context_engine.py` | `test_postgresql_multi_trace_execution` | Postgres multi trace execution engine |
| 11 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_all_9_table_editor_enhancements` | Table Data Editor composite enhancements |
| 12 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_identity_and_computed_columns_ssms_behavior` | Identity / computed columns SSMS matching |
| 13 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_manual_pk_and_sequence_enhancements` | Manual PK / Sequence handling (Phase 3 #9) |
| 14 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_revert_cell_to_original_clears_error_and_highlight` | Revert cell in table data editor |
| 15 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_submit_changes_identity_insert_sqlserver` | SQL Server IDENTITY_INSERT handling |
| 16 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_validate_insert_rows_skips_identity_and_computed` | Validation skipping identity & computed (Phase 5) |
| 17 | `tests/test_table_data_editor.py` | `TestTableDataEditor.test_validate_row_composite_unique_and_not_null` | Composite unique & NOT NULL row validation |
| 18 | `tests/test_table_designer.py` | `TestTableDesigner.test_sqlserver_adapter_get_table_design_metadata_mock` | `get_table_design_metadata` signature/limit argument |
| 19 | `tests/test_table_designer.py` | `TestTableDesigner.test_user_defined_types_support` | UDT support metadata parsing (Phase 4) |

---

## 2. Danh sách các nhóm Test PASSED (718 tests xanh)

- `test_actionbar_connections_dropdown.py` (Passed)
- `test_ag_grid_migration.py` (Passed)
- `test_bugs_011026_001.py` (Passed)
- `test_bugs_021026_001.py` (Passed)
- `test_bugs_071026_001.py` (Passed)
- `test_cancel_and_streaming.py` (Passed)
- `test_completion_engine_phase6.py` (Passed)
- `test_connection_zindex_hover_and_cursor.py` (Passed)
- `test_context_analyzer_phase2.py` (Passed)
- `test_context_menu_new_query.py` (Passed)
- `test_credential_cache.py` (Passed)
- `test_dialects_phase7.py` (Passed)
- `test_dml_context_phase4.py` (Passed)
- `test_early_contextual_trigger.py` (Passed)
- `test_editor_adapter_phase1.py` (Passed)
- `test_editor_settings_and_tabs.py` (Passed)
- `test_editor_settings_inheritance.py` (Passed)
- `test_environment_safety.py` (Passed)
- `test_explorer_collapse_and_reconnect.py` (Passed)
- `test_explorer_hover_and_actions.py` (Passed)
- `test_explorer_multiple_filter_phase3.py` (Passed)
- `test_features.py` (Passed)
- `test_format_and_goto_block.py` (Passed)
- `test_forward_from_and_alias_phase3.py` (Passed)
- `test_grid_multitable_and_freeze.py` (Passed)
- `test_grid_result_filter.py` (Passed)
- `test_grid_transparency_and_settings_limit.py` (Passed)
- `test_history_favorites_and_tags.py` (Passed)
- `test_history_monaco_zoom.py` (Passed)
- `test_history_phase2.py`, `phase3.py`, `phase4_fixes.py`, `phase4_retention.py`, `phase5_advanced.py` (Passed)
- `test_history_store_phase1.py` (Passed)
- `test_hover_phase7.py` (Passed)
- `test_improve_grid_result_all_phases.py` (Passed)
- `test_intellisense_api.py` (Passed)
- `test_join_fk_phase5.py` (Passed)
- `test_keyboard_trigger_plan.py` (Passed)
- `test_linked_server_bridge.py`, `test_linked_server_intellisense.py` (Passed)
- `test_logging_setup.py` (Passed)
- `test_metadata_cache_phase5.py`, `test_metadata_limit_fix.py`, `test_metadata_provider_phase4.py` (Passed)
- `test_navbar_subnav_z_index.py` (Passed)
- `test_object_search_all_phases.py` (Passed)
- `test_postgres_catalog_analyzer.py`, `test_postgres_dependency_*.py` (Passed)
- `test_postgres_event_listener.py`, `test_postgres_source_analyzer.py` (Passed)
- `test_postgresql_adapter_fixes.py` (Passed)
- `test_query_flow_visualization.py` (Passed)
- `test_quoting_and_replacement_phase2.py` (Passed)
- `test_resizer_and_credentials.py` (Passed)
- `test_routine_context_phase4b.py` (Passed)
- `test_schema_isolation_and_pg_overload.py` (Passed)
- `test_scope_resolver_phase3.py` (Passed)
- `test_script_parameters.py` (Passed)
- `test_semantic_syntax_check.py` (Passed)
- `test_session_save_restore.py` (Passed)
- `test_signature_help_phase6.py` (Passed)
- `test_single_tab_snippet_expansion.py` (Passed)
- `test_sql_context_engine.py` (Passed - ngoại trừ 1 test multi trace)
- `test_sql_formatter_and_styles.py` (Passed)
- `test_sql_protection.py` (Passed)
- `test_sql_safety.py` (Passed)
- `test_sql_splitter.py` (Passed)
- `test_sql_visualization.py` (Passed)
- `test_sqlserver_synonyms.py` (Passed)
- `test_star_expansion_phase9.py` (Passed)
- `test_statement_isolation_phase1.py` (Passed)
- `test_structured_data_viewer.py` (Passed)
- `test_subword_matching_phase8.py` (Passed)
- `test_syntax_adapters.py`, `test_syntax_check.py`, `test_syntax_check_regression_fix.py`, `test_syntax_coordinator.py` (Passed)
- `test_system_fonts.py` (Passed)
- `test_tab_close_and_empty_state.py`, `test_tab_manager.py` (Passed)
- `test_trigger_phase1_audit.py` đến `test_trigger_phase7_regression_dod.py` (Passed)
- `test_ui_actionbar_and_debug_headless.py` (Passed)
- `test_virtual_grid_performance.py` (Passed)

---

## 3. Quy tắc so sánh cho các Phase kế tiếp

- Bất kỳ phase nào triển khai: số lượng test passed **không được nhỏ hơn 718**.
- 19 test failed trên sẽ được xử lý và chuyển sang xanh trong đúng Phase quy định (Phase 2, Phase 3, Phase 4, Phase 5).
