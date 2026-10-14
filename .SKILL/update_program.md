# Kế hoạch chỉnh sửa theo phase – IDE-SQL-Lite\_New\_Pyweb_Claude

Dựa trên bản review chỉ-đọc ngày 12/10/2026. Nguyên lý xuyên suốt: **sửa tại chỗ những phần cần sửa, không đập đi xây mới**. Số dòng nêu trong tài liệu là gần đúng (theo bản zip đã review), agent phải tự tìm lại bằng grep trước khi sửa.

## 1. Nguyên tắc chung

- **Giữ nguyên bề mặt công khai**: tên method của `MainApi`/`BravoApi` (JS gọi qua pywebview), các đường `/api/...` mà `api.js` ánh xạ, định dạng file trong `data/`, tên file JS/CSS mà template tham chiếu. Chỉ đổi khi phase ghi rõ.
- **Một phase = một nhánh git, nhiều commit nhỏ.** Một thay đổi hành vi = một commit + một test. Không trộn refactor thuần với sửa lỗi trong cùng commit.
- **Test đặc tả trước, sửa sau.** Với vùng chưa có test hành vi, viết test mô tả hành vi hiện tại rồi mới đổi.
- **Chỉ xóa khi đã chứng minh không dùng** (grep trong `app/`, `static/`, `templates/`, `tests/`, `run.spec`), và xóa trong commit riêng để dễ hoàn tác.
- **Không động vào dữ liệu thật của người dùng** (`data/connections.json`, `programlist.json`, `history.db`). Dùng bản sao hoặc DB thử.
- Chỗ nào cần người dùng chọn hướng, plan ghi **\[QUYẾT ĐỊNH\]**: agent dừng và hỏi, không tự chọn.

## 2. Tổng quan các phase

| Phase | Mục tiêu | Phạm vi chính | Đổi hành vi? | Ưu tiên | Ước lượng |
| --- | --- | --- | --- | --- | --- |
| 0 | Baseline, điểm quay lại | git, tests/, ghi chú | Không | Bắt buộc | 0,5 ngày |
| 1 | Dọn repo và phụ thuộc | Thư mục/file không phải mã, requirements, README | Không | Cao | 1 ngày |
| 2 | Bảo mật dữ liệu và đóng gói | crypto, run.spec, đường dẫn dữ liệu, run\_program | Có (migration) | Cao nhất | 2–3 ngày |
| 3 | Sửa lỗi chắc chắn | adapters, editor service, main.py cục bộ | Có (bugfix) | Cao | 2–3 ngày |
| 4 | Quote định danh chung và Table Designer | sql\_utils mới, designer, editor | Có | Trung bình–cao | 3–4 ngày |
| 5 | Khóa kết nối, vòng đời, profiler | connection\_manager, editor service, profiler | Có | Trung bình | 2 ngày |
| 6 | Tách main.py (cơ học) | main.py → app/desktop, app/api | Không | Trung bình | 3–4 ngày |
| 7 | Đường chạy kép và pipeline cú pháp | routes, syntax, api.js | Có | Trung bình | 2–3 ngày |
| 8 | Frontend hardening | escape HTML, CSP, SQL Protection | Một phần | Cao (có thể song song sau Phase 2) | 2–3 ngày |
| Xuyên suốt | Test, CI, tài liệu | tests/, docs/ | Không | Liên tục | – |

**Thứ tự phụ thuộc**: 0 → 1 → 2 → 3. Sau đó 4, 5, 6 làm được độc lập nhưng nên 6 sau 3 và 5 (đã có test bảo vệ). 7 sau 6. 8 chạy song song từ sau Phase 2.

## 3. Quy tắc làm việc cho agent

**Trước mỗi phase**

1. Đọc kỹ phase, tạo nhánh `phaseN-<tên>`.
2. Chạy `pytest -q`, ghi kết quả để so sánh về sau.
3. Liệt kê file dự định sửa. Nếu cần sửa file ngoài danh sách phạm vi → dừng và hỏi.

**Trong phase**

- Làm theo thứ tự các việc đã đánh số. Commit message dạng `phaseN: mô tả ngắn`.
- Sau mỗi commit chạy test liên quan. Test đỏ không được để sang commit sau.
- Không dọn dẹp code bên cạnh, không đổi định dạng hàng loạt, không thêm thư viện ngoài danh sách phase.
- Không sửa `dist/`, `build/`. Không đổi tên method công khai.
- Gặp điều không chắc: ghi rõ giả định trong báo cáo thay vì đoán.

**Kết thúc phase – báo cáo gồm**: file đã sửa, test đã thêm, kết quả test trước/sau, điều chưa làm, rủi ro còn lại, các \[QUYẾT ĐỊNH\] đang chờ.

**Mẫu prompt giao việc**

```
Bạn đang làm Phase N của docs/refactor/PLAN.md trong project IDE-SQL-Lite_New_Pyweb_Claude.
Chỉ sửa các file thuộc phạm vi Phase N. Không viết lại module, không đổi tên method công khai.
Làm lần lượt từng việc, mỗi việc một commit kèm test. Gặp mục [QUYẾT ĐỊNH] thì dừng và hỏi.
Cuối phase gửi báo cáo theo mẫu ở mục 3.
```

## Phase 0 – Baseline (không sửa code sản phẩm)

**Mục tiêu**: có điểm quay lại và số liệu ban đầu. **Được sửa**: chỉ git, `docs/refactor/`, `tests/snapshots/`. **Không sửa**: `app/`, `static/`, `templates/`, `main.py`.

1. Kiểm tra `git status`. Nếu chưa có repo thì `git init` sau khi xong `.gitignore` ở Phase 1; tạo tag `baseline-<ngày>`.
2. Sao lưu thư mục `data/` ra ngoài repo.
3. Chạy `pytest -q` và lưu danh sách pass/fail vào `docs/refactor/baseline_tests.md` (đã biết có test đỏ: `tests/test_clipboard_and_grid_copy.py`, cùng các test trong `scratch/`).
4. Viết script sinh `tests/snapshots/api_surface.txt`: danh sách method công khai của `MainApi`, `BravoApi` và các subwindow API, cùng danh sách route Flask. Thêm test so sánh với snapshot (dùng làm lưới an toàn cho Phase 6).
5. Ghi phiên bản Python dùng để build (bản dist hiện là cp314) vào README.
6. **Việc của người dùng, không phải agent**: đổi các mật khẩu DB/chương trình đã nằm trong file zip và `dist/` (chúng đã đi cùng khóa giải mã).

**Hoàn thành khi**: có tag, file baseline, test snapshot xanh.

## Phase 1 – Dọn repo và phụ thuộc (không đổi hành vi)

**Được sửa**: các file ở gốc, thư mục không phải mã nguồn, `requirements*.txt`, `README.md`, `.gitignore`, `vercel.json`. **Không sửa**: `app/`, `static/`, `templates/`, `main.py`.

1. Với từng mục sau, grep xác nhận không còn tham chiếu rồi xử lý: `OUTPUT/`, `.backup_fixes/`, `.example/`, `run - Copy.spec`, `scratch_*.txt`, `dump.json`, `project-tree.txt`, `bugs/*.png`, `_concept_/`, `build/`, `dist/`. Mục còn giá trị tham khảo (`_concept_`, `bugs/*.md`) chuyển vào `docs/archive/`; mục còn lại gỡ khỏi git. Mỗi nhóm một commit.
2. Giữ nguyên `.SKILL/` (agent đang dùng); thêm `.SKILL/INDEX.md` liệt kê file nào còn hiệu lực, file nào là kế hoạch cũ.
3. Cập nhật `.gitignore` (`build/`, `dist/`, `OUTPUT/`, `project-tree.txt`, `data/*.db`, `data/connections.json`, `data/.secret.key`, `data/programlist.json`).
4. Tách `requirements.txt` (chạy) và `requirements-dev.txt` (pytest, lint). Xác minh bằng grep import thực tế rồi bổ sung: `cryptography` (đang thiếu), `psycopg[binary]` v3 (code dùng `import psycopg`), `flask` (đánh dấu tùy chọn), `redis` nếu profiler cần. Chỉ giữ `psycopg2-binary` nếu còn `import psycopg2`. Ghim phiên bản theo bản đang build (đọc `*.dist-info` trong `dist/`: cryptography 50.0.1, psycopg 3.3.5).
5. Viết lại README theo kiến trúc thật: pywebview → `MainApi` → services → adapters; cách chạy, build (`pyinstaller run.spec`), test. Ghi rõ Flask routes là kênh phụ.
6. Xóa `vercel.json` (trỏ tới `app.py` không tồn tại).

**Hoàn thành khi**: trong venv sạch `pip install -r requirements.txt` rồi `python run.py` mở được app và kết nối PostgreSQL thử; pytest không tệ hơn baseline; diff không chạm file mã nguồn. **Rủi ro**: xóa nhầm file đang dùng → luôn grep và build thử trước khi merge.

## Phase 2 – Bảo mật dữ liệu và đóng gói

**Mục tiêu**: khóa mã hóa không còn đi kèm dữ liệu; dữ liệu người dùng tách khỏi thư mục cài đặt; JS không chạy được file tùy ý. **Được sửa**: `app/utils/crypto.py`, `app/utils/paths.py` (mới), `run.spec`, `config.py`, trong `main.py` chỉ các hằng đường dẫn, `run_program`, `get_connection_password`, `REDGATE_SNIPPETS_DIR`; đường dẫn DB trong `app/services/history/storage.py`. **Không sửa**: logic truy vấn, UI.

1. `paths.py`: `get_user_data_dir()` trả về `%APPDATA%\\LLTool` (cho phép ghi đè bằng biến môi trường `LLTOOL_DATA_DIR`). Mọi nơi đang dùng `DATA_DIR` gọi hàm này; giữ nguyên tên file.
2. Migration lần chạy đầu: nếu thư mục mới trống mà `APP_DIR/data` có file thì **sao chép** (không xóa bản gốc), ghi cờ `migrated`.
3. `crypto.py`: giữ nguyên chữ ký `encrypt_password` / `decrypt_password`. Thêm backend lưu khóa theo thứ tự: DPAPI (Windows) → fallback file khóa kèm log cảnh báo. Định dạng mới `ENC2:`; vẫn đọc được `ENC:` cũ và tự ghi lại thành `ENC2:` sau khi đọc thành công. Khi giải mã lỗi thì **raise** `CredentialDecryptError` thay vì trả lại chuỗi `ENC:...`; nơi gọi (`create_connection`, `run_program`) báo người dùng nhập lại mật khẩu. **\[QUYẾT ĐỊNH\]** DPAPI qua ctypes (không thêm thư viện) hay `keyring`.
4. `run.spec`: bỏ đoạn đóng gói mọi `*.json` và `.secret.key` (khoảng dòng 28). Chỉ đóng gói bản mặc định không chứa bí mật (settings mặc định, snippets, code\_styles). `connections.json`, `programlist.json`, `history.db`, `.secret.key` **không** vào `dist/`.
5. `run_program`: JS chỉ gửi `id`; Python tra `programlist.json` để lấy path, user, password; id không có → từ chối. Không nhận `path` từ JS. **\[QUYẾT ĐỊNH\]** nếu chương trình đích hỗ trợ nhận mật khẩu qua biến môi trường/stdin thì chuyển khỏi tham số `-p:`.
6. `get_connection_password`: giữ vì modal kết nối cần, nhưng chỉ phục vụ cửa sổ chính và ghi log. Nếu UI chỉ cần cờ `has_password` thì **\[QUYẾT ĐỊNH\]** có thể bỏ.
7. `REDGATE_SNIPPETS_DIR` đọc từ settings (mặc định rỗng) thay vì đường dẫn cứng của một máy.
8. `config.py`: `SECRET_KEY` thiếu thì sinh ngẫu nhiên, không dùng mặc định `change-me-in-production` (chỉ ảnh hưởng nhánh Flask).

**Test bắt buộc**: round-trip crypto; đọc được `ENC:` cũ; lỗi giải mã ném đúng exception; `run_program` từ chối id lạ; test quét `datas` của `run.spec` không chứa file bí mật. **Hoàn thành khi**: máy sạch chạy exe tạo dữ liệu ở `%APPDATA%`; máy cũ migrate đúng và kết nối đã lưu vẫn mở được. **Rollback**: bản gốc `data/` còn nguyên và bản sao lưu ở Phase 0.

## Phase 3 – Sửa lỗi chắc chắn (mỗi lỗi = 1 commit + 1 test)

**Phạm vi**: đúng các file nêu dưới đây, không refactor. Test phải **đỏ trước khi sửa, xanh sau khi sửa**.

| # | Lỗi | Vị trí | Cách sửa |
| --- | --- | --- | --- |
| 1 | `USE [db]` lỗi bị nuốt, truy vấn chạy sai database | `sqlserver.py` execute (\~280) và `execute_migration_transaction` (\~1622); `table_data_editor_service.py` (3 chỗ) | Bắt lỗi và raise thông báo rõ |
| 2 | `explain_query` SQL Server luôn lỗi do `adapter._lock` không tồn tại; `SHOWPLAN` không tắt khi lỗi | `main.py` (\~3523) | Dùng `conn.lock`; đưa `SET SHOWPLAN_TEXT OFF` vào `finally` |
| 3 | Chuỗi kết nối ghép bằng f-string, mật khẩu chứa `;` hoặc `}` làm hỏng | `sqlserver.py` (\~146, \~210) | Hàm escape giá trị theo quy tắc ODBC `{...}` |
| 4 | Mặc định `Encrypt=no`, `TrustServerCertificate=yes` | `sqlserver.py` | Giữ mặc định để không phá kết nối cũ, chỉ ghi log cảnh báo. **\[QUYẾT ĐỊNH\]** có đổi mặc định không |
| 5 | `get_intellisense_*` định nghĩa hai lần | `main.py` (\~2762 và \~2852) | So sánh hai bản, xóa bản trùng |
| 6 | `table_designer_script`, `table_designer_save` gọi hàm không tồn tại | `main.py` (\~3448–3466) | Grep JS không gọi rồi xóa |
| 7 | `create_or_get` dùng lại nhầm kết nối (bỏ qua port/xác thực) | `connection_manager.py` | So thêm port và `trusted_connection` |
| 8 | PostgreSQL: `_build_conn_params` bỏ qua `server`; `search_path` không escape `"`; `_ensure_database` làm lệch `session.config`; thiếu `sslmode` | `postgresql.py` | Sửa từng điểm; thêm tùy chọn `sslmode` (mặc định không đổi) |
| 9 | `setval` lỗi làm hỏng cả transaction PG; tăng sequence vô cớ | `table_data_editor_service.py` (\~612) | Dùng SAVEPOINT hoặc định danh có schema; chỉ chạy khi có insert định danh tường minh |
| 10 | Chế độ không optimistic bỏ qua `rowcount`; `update_row` mặc định báo 1 dòng | cùng file | Kiểm tra `rowcount` mọi chế độ |
| 11 | Bộ lọc `like` viết thường lỗi; `sort_order` không phải số làm văng lỗi | `_parse_filter_expr`, `build_select_sql` | So khớp không phân biệt hoa thường; ép kiểu an toàn |
| 12 | `custom_sql` không giới hạn dòng | `fetch_data` | Áp `MAX_QUERY_ROWS` mặc định, cấu hình được |

**Hoàn thành khi**: 12 lỗi có test, không đổi chữ ký method công khai (snapshot Phase 0 vẫn xanh, trừ mục 5, 6 có chủ đích).

## Phase 4 – Quote định danh dùng chung và Table Designer

**Được sửa**: `app/database/sql_utils.py` (mới), `table_designer_service.py`, `table_data_editor_service.py`, `sqlserver.py`, `postgresql.py`, `profiler/mssql_profiler.py`, `tests/test_table_designer.py`.

1. `sql_utils.py`: `quote_ident(name, engine)` (nhân đôi `]` hoặc `"`, không tin tên đã bọc sẵn), `quote_qualified(...)`, `escape_literal(...)`. Test ca biên: khoảng trắng, `]`, `"`, Unicode, từ khóa, tên có dạng giả bọc `[a]]; DROP ...]`.
2. Thay `_quote_ident` rải rác bằng hàm chung, **mỗi file một commit**, giữ tên hàm cũ làm wrapper một phiên bản để dễ hoàn tác. Thay `[{database}]` trần trong `sqlserver.py` (\~754, 822, 918, 956).
3. `generate_diff` trong Table Designer, mỗi mục một commit + test:
   - Mọi lệnh ALTER dùng định danh đã quote (thay `alt_tbl_name`, `clean_col` thô); thêm test PostgreSQL với cột chữ hoa/thường và tên có khoảng trắng.
   - Lấy tên PK và default constraint thật từ metadata (`get_table_design_metadata` bổ sung `pk_name`, `default_constraint_name`) thay vì đoán `PK_{table}`.
   - Sắp xếp lại: drop FK/index/unique/check/default → drop column → add/alter column → add constraint/index → trigger.
   - So sánh **định nghĩa**, không chỉ tên, cho index/FK/unique/check; khác thì drop + add.
   - SQL Server: sinh lệnh xóa default khi bỏ default; drop default cũ trước khi thêm mới.
   - Cảnh báo/`destructive` cho thu hẹp kiểu và thêm cột NOT NULL không default.
   - Thống nhất mặc định `nullable` giữa phần so sánh và `generate_column_def`.
   - (Tùy chọn, làm cuối) đánh dấu `renamed_from` để đổi tên cột bằng `sp_rename` / `RENAME COLUMN` thay vì drop + add.
4. Test cũ khẳng định đầu ra không quote phải được cập nhật **có chủ đích** và nêu trong báo cáo.

**Hoàn thành khi**: snapshot SQL sinh ra trước/sau được so sánh, mọi khác biệt đều giải thích được.

## Phase 5 – Khóa kết nối, vòng đời, profiler

**Được sửa**: `table_data_editor_service.py`, `connection_manager.py`, `models/connection_session.py`, các wrapper bảng-dữ-liệu trong `main.py` (chỉ truyền lock), `profiler/mssql_profiler.py`.

1. Mọi truy cập `adapter.connection` ngoài `QueryService` phải giữ `conn.lock`. Thêm context manager `session.exclusive()`; các wrapper `fetch/update/submit/validate_*` trong `MainApi` dùng nó. Service nhận `lock` tùy chọn để dễ test.
2. `validate_insert_rows` hiện **chèn thật rồi rollback** (tiêu thụ identity/sequence, chạy trigger). Mặc định chỉ dùng kiểm tra không ghi (`validate_row`: NOT NULL, unique, FK); chế độ chèn thử chỉ khi người dùng bật, kèm cảnh báo. **\[QUYẾT ĐỊNH\]**
3. `ConnectionManager`: dọn kết nối idle theo setting (đã có `touch()`); đóng khi cửa sổ đóng.
4. Cache metadata của editor: khóa theo `connection_id` thay `id(adapter)`, thêm khóa luồng, dọn mục hết hạn.
5. Profiler MSSQL: khi mở profiler, liệt kê và (có xác nhận) xóa session Extended Events mồ côi tiền tố `luoBTool_XE_`; ghi tài liệu quyền cần.
6. Trong các file thuộc phase này, thay `except Exception: pass` bằng logging có ngữ cảnh (không quét toàn repo).

**Hoàn thành khi**: test hai luồng (lưu dữ liệu + chạy truy vấn đồng thời) không làm lẫn trạng thái autocommit; kết nối idle bị đóng đúng hạn.

## Phase 6 – Tách main.py bằng refactor cơ học

**Nguyên tắc**: chỉ di chuyển code, **không sửa logic**. `main.py` vẫn là điểm vào; `MainApi` giữ nguyên tên và toàn bộ method công khai. Sau **mỗi bước** chạy test snapshot bề mặt API (Phase 0) và pytest.

Thứ tự từ ít rủi ro đến nhiều:

1. Hàm thuần, không trạng thái: theme/VSIX (\~171–580) → `app/desktop/themes.py`; clipboard native (\~620–807) → `app/desktop/clipboard.py`; mã hóa XML Bravo (\~807–957) → `app/bravo/xml_codec.py`; đọc/ghi settings, snippets (\~63–171, \~580–620) → `app/services/settings_store.py`.
2. Xuất file (`grid_open_in_excel`, `grid_save_results_as`) → `app/desktop/exports.py`.
3. Quản lý cửa sổ (settings/profiler/event listener/history, timer titlebar) → `app/desktop/windows.py`.
4. Chia `MainApi` thành mixin theo miền trong `app/api/`: connections, query, metadata, table\_editor, designer, settings, profiler, history, bravo; `class MainApi(ConnectionsApi, QueryApi, ...)`.
5. Subwindow API: thay `__getattr__` chuyển tiếp mọi thứ bằng **whitelist tường minh** cho từng cửa sổ (đây là thay đổi hành vi có chủ đích, tách commit riêng).
6. Đích: `main.py` dưới \~600 dòng (khởi động và tạo cửa sổ).

**Rủi ro**: import vòng, thuộc tính `self._window`; pywebview chỉ expose method công khai của đối tượng `js_api` nên phải kiểm tra bằng snapshot. Mỗi bước một commit để hoàn tác.

## Phase 7 – Đường chạy kép và pipeline cú pháp

1. **\[QUYẾT ĐỊNH\]** Số phận Flask routes: (A) giữ làm kênh phụ nhưng gọi chung service, không nhân đôi logic; (B) đánh dấu deprecated, bỏ khỏi `create_app`. Khuyến nghị B vì app chạy bằng pywebview; trước hết grep JS xem còn nơi nào cần HTTP.
2. Nối `validate_sql_pipeline` vào `MainApi.syntax_check` (hiện đang gọi bản legacy `validator.validate_sql`) **sau cờ setting** `syntax.pipeline`, mặc định tắt. Chạy cả hai bản trên bộ SQL mẫu `tests/fixtures/sql_corpus/`, so diagnostics, chỉ bật mặc định khi tương đương hoặc tốt hơn.
3. ScriptDom DLL: **\[QUYẾT ĐỊNH\]** bundle (kiểm tra giấy phép phân phối) hay tiếp tục tìm trong SSMS/Azure Data Studio. Thêm ô cấu hình đường dẫn trong settings; báo rõ cho người dùng khi thiếu DLL thay vì fallback im lặng.
4. `api.js`: thêm bảng ánh xạ route → method tường minh (giữ nguyên cơ chế chặn `fetch`), để thiếu method thì báo lỗi rõ.
5. Hàm `transform_pg_temp_tables`: xử lý thêm dollar-quote `$$...$$`, định danh `"..."`, chuỗi `E'...'`; có test.

## Phase 8 – Frontend hardening (song song sau Phase 2)

**Không viết lại frontend.** Chỉ làm các việc sau:

1. Một hàm `escapeHtml` duy nhất trong `utils.js` (kiểm tra bản đang có) và dùng chung.
2. Quét `innerHTML` theo ưu tiên: trước hết nơi chèn lỗi/tên object từ DB: `explorer.js` (\~313, 347, 397), `query.js`, `table-data-editor.js`, `grid-result.js`. Dùng `textContent` khi chỉ là chữ. Thêm test với chuỗi `<img src=x onerror=...>`. Phần còn lại sửa khi chạm tới file.
3. Thêm CSP (`default-src 'self'`) cho `templates/index.html` và các cửa sổ phụ; kiểm tra Monaco và AG Grid vẫn chạy (đã dùng vendor offline).
4. ESLint với `eslint-plugin-no-unsanitized` ở mức cảnh báo, siết dần.
5. SQL Protection (DELETE/UPDATE không WHERE, TRUNCATE): thêm kiểm tra phía Python trong `execute_query` theo cùng cờ setting hiện có; giữ nguyên bản JS.
6. File JS trên 3000 dòng: **không tách hàng loạt**. Khi sửa chức năng trong file đó, trích cụm hàm thuần liên quan sang module cùng thư mục.

## Track xuyên suốt – Test, CI, tài liệu

- Mỗi bugfix có test hành vi. Khi đụng tới test kiểu đọc chuỗi nguồn (đang chiếm đa số trong 102 file test) thì chuyển dần sang kiểm tra hành vi.
- Test tích hợp PostgreSQL qua Docker, đánh dấu `@pytest.mark.integration`; thư mục `scratch` không chạy mặc định.
- CI trên Windows chạy `pytest -m "not integration"` và lint.
- Tài liệu: `ARCHITECTURE.md` (pywebview → MainApi → services → adapters), `CHANGELOG.md`, cập nhật `.SKILL/AGENTS.md` trỏ tới kế hoạch này.
- Sau các phase trên: tùy chọn lưu giữ/ẩn giá trị literal cho `history.db`.

## Tổng hợp các điểm cần bạn quyết định

1. Phase 2: DPAPI hay `keyring`; có bỏ `get_connection_password` không; có chuyển mật khẩu chương trình sang biến môi trường không.
2. Phase 3: có đổi mặc định `Encrypt`/`TrustServerCertificate` không.
3. Phase 5: có giữ chế độ chèn thử khi validate không.
4. Phase 7: Flask (A) hay (B); bundle ScriptDom hay không.

## Giả định cần agent xác minh trước khi làm

- Project đã có git hay chưa (zip review không có đủ lịch sử).
- Phiên bản Python build thật, và `psycopg2` có còn được import ở đâu không.
- Số dòng nêu trong tài liệu chỉ để định vị; luôn tìm lại bằng grep.
- Nhiều phần chưa đọc kỹ ở lần review (Bravo, `history/storage.py`, `semantic_analyzer.py`, `object_search_service.py`, `query_plan_service.py`); khi đụng tới chúng hãy đọc trước và bổ sung vào kế hoạch.
