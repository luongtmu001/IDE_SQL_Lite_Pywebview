# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.0.7 (So với v1.0.6)

> **Ngày phát hành**: 21/10/2026  
> **Phiên bản trước**: `v1.0.6` (21/10/2026)  
> **Phiên bản hiện tại**: `v1.0.7`  

---

## 1. Tóm Tắt Tổng Quan Các Thay Đổi Chính

Phiên bản **v1.0.7** là bản phát hành chuyên sâu nâng cấp **Hệ thống Kiểm Tra Cú Pháp (Syntax Validator Engine)** cho **PostgreSQL (PL/pgSQL)** & **Microsoft SQL Server (T-SQL)**, cùng việc **mở rộng toàn diện hệ thống từ khóa, hàm built-in và kiểu dữ liệu** trong Monaco Editor:

| STT | Trọng tâm | Chi tiết |
|---|---|---|
| **1** | **Khắc phục lỗi bắt khối `END;` của Function PL/pgSQL** | Sửa triệt để lỗi báo sai `Unmatched END: no corresponding BEGIN block` ở khối `END;` cuối hàm khi thân hàm chứa các biểu thức nối chuỗi nhiều `CASE WHEN ... || CASE WHEN ...`. |
| **2** | **Định vị chuẩn xác vị trí thiếu `END` của `CASE WHEN`** | Bắt đúng ngay tại từ khóa `CASE` chưa có `END` tương ứng, loại bỏ hoàn toàn hiện tượng báo lỗi lệch hoặc gạch đỏ nhầm vào `END` hợp lệ kế tiếp. |
| **3** | **Bổ sung từ khóa gọi thủ tục `CALL` (PostgreSQL)** | Nhận diện chuẩn xác lệnh `CALL procedure_name(...)`, highlight và hỗ trợ cú pháp gọi Stored Procedure hiện đại của PostgreSQL 11+. |
| **4** | **Phân tách `END CASE;` thủ tục & biểu thức `END`** | Phân biệt rạch ròi giữa câu lệnh điều khiển thủ tục `END CASE;` và từ khóa đóng biểu thức vô hướng `END` (theo sau bởi `AS`, `||`, v.v.). |
| **5** | **Thiết lập ranh giới câu lệnh dấu chấm phẩy (`;`)** | Ngăn chặn các biểu thức lồng trong câu lệnh `SELECT` rò rỉ làm lệch cấu trúc lồng nhau của khối `BEGIN ... END;` ngoài cùng. |
| **6** | **Mở rộng từ khóa SQL Server (T-SQL)** | Mệnh đề DML `OUTPUT`, `INSERTED`, `DELETED`; toàn bộ bảng gợi ý khóa Table Hints (`NOLOCK`, `UPDLOCK`, `ROWLOCK`, `READPAST`, v.v.); `PIVOT`, `UNPIVOT` và phân tích windowing. |
| **7** | **Mở rộng từ khóa PostgreSQL** | `MATERIALIZED`, `REFRESH`, `ANALYSE`, `COPY`, `LATERAL`, `GENERATED`, `EXCLUDE`, `POLICY`, `PUBLICATION`, `SUBSCRIPTION`, `ROUTINE`, `STORED`, `UNLISTEN`, `UNTIL`, `VALID`, `VARIADIC`, `VERBOSE`, v.v. |
| **8** | **Bổ sung +96 Hàm Built-in & +27 Kiểu Dữ Liệu** | Đồng bộ vào Monaco Monarch Tokenizer, SQL Dialects, SQL Formatter và SQL Function Signatures. |

---

## 2. Chi Tiết Các Lỗi Syntax Được Khắc Phục

### 2.1. Lỗi nhận diện khối `END;` của Function PL/pgSQL (Unmatched END block)

#### Hiện trạng & Triệu chứng trước đây:
Khi người dùng viết hàm PL/pgSQL phức tạp có cấu trúc:
```sql
CREATE OR REPLACE FUNCTION schema_name.fn_example(...)
RETURNS text AS $$
DECLARE
    v_result text;
BEGIN
    SELECT 
        CASE WHEN col1 = 1 THEN 'A' ELSE 'B' END ||
        CASE WHEN col2 = 2 THEN 'C' ELSE 'D' END
    INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```
Bộ kiểm tra cú pháp báo lỗi giả nghiêm trọng tại dòng `END;` cuối cùng:
> `Unmatched END: no corresponding BEGIN block`

#### Phân tích nguyên nhân gốc rễ:
1. **Toán tử nối chuỗi `||`**: Trong PL/pgSQL, các biểu thức `CASE WHEN` thường được nối chuỗi liên tiếp bằng toán tử `||` (`END || CASE WHEN ...`). Khi tokenizer quét token, biểu thức `END || CASE` bị xử lý sai ngữ cảnh, coi `CASE` đứng sau là một phần mở rộng bất thường hoặc nuốt mất token `END` trước đó.
2. **Nhầm lẫn giữa `END CASE;` và `END` vô hướng**: Cú pháp PL/pgSQL hỗ trợ cả hai dạng:
   - Dạng câu lệnh điều khiển thủ tục: `CASE ... WHEN ... THEN ... END CASE;` (bắt buộc phải có `CASE;` phía sau `END`).
   - Dạng biểu thức giá trị vô hướng: `CASE ... WHEN ... THEN ... END` (thường theo sau bởi alias `AS`, toán tử nối `||`, hoặc dấu phẩy `,`).
   Bộ tokenizer trước đây chưa phân biệt được hai cấu trúc này, dẫn đến việc đếm sai số lượng `BEGIN/CASE` đang mở trên stack phân tích.
3. **Thiếu ranh giới câu lệnh (Statement Boundary `;`)**: Biểu thức `CASE WHEN` nằm trọn vẹn bên trong câu lệnh `SELECT ... INTO ...;`. Khi gặp dấu chấm phẩy `;` kết thúc câu lệnh `SELECT`, toàn bộ các biểu thức bên trong câu lệnh này phải được giải phóng. Việc rò rỉ trạng thái mở của biểu thức vô hướng đã làm lệch toàn bộ ngăn xếp của khối `BEGIN ... END;` ngoài cùng của Function.

#### Giải pháp kỹ thuật đã triển khai (`app/database/syntax/adapters/postgresql_adapter.py`):
1. **Xử lý rạch ròi token `END`**:
   - Nếu theo sau `END` là từ khóa `CASE` và dấu chấm phẩy `;` (`END\s+CASE\s*;`), ghi nhận đây là câu lệnh thủ tục `END CASE;` và pop khối `CASE` thủ tục tương ứng.
   - Nếu `END` đứng đơn lẻ trong biểu thức vô hướng (theo sau bởi `AS`, `||`, `,`, `FROM`, `WHERE`, hoặc dấu ngoặc đóng `)`), đóng chính xác biểu thức `CASE` vô hướng gần nhất.
2. **Loại bỏ ảnh hưởng của toán tử `||`**: Cải tiến biểu thức chính quy tách token để toán tử nối chuỗi `||` được coi như một toán tử nhị phân thông thường, không can thiệp vào cặp từ khóa `CASE ... END`.
3. **Thiết lập ranh giới câu lệnh `;`**: Khi gặp dấu `;` trong thân hàm, tự động cân bằng và dọn dẹp các biểu thức vô hướng lửng lơ chưa hoàn tất bên trong câu lệnh con đó, đảm bảo khối `BEGIN ... END;` của Function luôn được theo dõi độc lập và chính xác 100%.

---

### 2.2. Lỗi bắt sai vị trí `END` của biểu thức `CASE WHEN` (Pinpoint Unclosed CASE Location)

#### Hiện trạng & Triệu chứng trước đây:
Khi người dùng viết câu lệnh chứa nhiều biểu thức `CASE WHEN`, trong đó có một biểu thức bị quên từ khóa `END`:
```sql
SELECT
    CASE 
        WHEN a = 1 THEN 'One'
        -- Quên END ở đây
    AS col1,
    CASE
        WHEN b = 2 THEN 'Two'
    END AS col2
FROM my_table;
```
Bộ kiểm tra cú pháp trước đây hiển thị thông báo:
> `Unmatched END: no corresponding BEGIN or CASE block`

và **gạch đỏ nhầm vào dòng `END AS col2`** (vốn là một câu lệnh hoàn toàn hợp lệ), thay vì cảnh báo người dùng tại vị trí `CASE` của `col1`.

#### Phân tích nguyên nhân & Giải pháp (`app/database/syntax/validator_mssql.py`):
- Hàm `find_unclosed_case_in_sql` trước đây sử dụng cơ chế đếm số lượng mở/đóng thô sơ (`count(CASE) - count(END)`). Khi xảy ra chênh lệch, nó gán vị trí lỗi vào token `END` đầu tiên xuất hiện sau đó hoặc vị trí kết thúc khối câu lệnh.
- **Giải pháp mới**:
  - Triển khai cơ chế **Ngăn xếp Vị trí (Location Stack)**: Mỗi khi tokenizer gặp từ khóa `CASE`, vị trí dòng (`line`) và cột (`col`) của chính từ khóa `CASE` đó được đẩy vào stack.
  - Mỗi khi gặp từ khóa `END` hợp lệ, phần tử trên đỉnh stack được pop ra.
  - Khi kết thúc câu lệnh hoặc gặp ranh giới phân tách (dấu chấm phẩy, `FROM`, hoặc cuối batch), nếu stack vẫn còn phần tử tồn đọng, phần tử trên cùng chính là **vị trí của từ khóa `CASE` bị thiếu `END`**.
  - IDE sinh marker lỗi chuẩn xác: `Unclosed CASE expression: missing corresponding END` tại đúng tọa độ của `CASE`, không còn hiện tượng gạch đỏ nhầm vào `END` của các biểu thức phía sau.

---

## 3. Bổ Sung Toàn Diện Từ Khóa & Cú Pháp Mới

### 3.1. Từ Khóa Gọi Thủ Tục `CALL` & Các Mệnh Đề PostgreSQL Nâng Cao
- **Lệnh `CALL`**: Nhận diện từ khóa gọi Stored Procedure chuẩn PostgreSQL 11+:
  ```sql
  CALL schema_name.my_procedure(arg1, arg2);
  ```
- **Các từ khóa DDL & Quản trị PostgreSQL**:
  - `MATERIALIZED`, `REFRESH` (hỗ trợ `REFRESH MATERIALIZED VIEW ... CONCURRENTLY`)
  - `ANALYSE`, `COPY`, `LATERAL`, `GENERATED`, `EXCLUDE`, `EXTENSION`
  - `POLICY`, `PUBLICATION`, `SUBSCRIPTION`, `ROUTINE`, `STORED`
  - `UNLISTEN`, `UNTIL`, `VALID`, `VARIADIC`, `VERBOSE`

### 3.2. Mở Rộng Từ Khóa SQL Server (T-SQL)
- **Mệnh đề DML `OUTPUT`**:
  - Hỗ trợ đầy đủ `OUTPUT`, `INSERTED`, `DELETED` cho các truy vấn kiểm toán, lưu vết và merge dữ liệu:
    ```sql
    DELETE FROM Orders
    OUTPUT DELETED.OrderID, DELETED.CustomerID, GETDATE()
    INTO Orders_Audit;
    ```
- **Table Hints (Gợi ý bảng & Khóa)**:
  - Bổ sung toàn bộ danh mục hints phổ biến: `NOLOCK`, `UPDLOCK`, `XLOCK`, `ROWLOCK`, `READPAST`, `PAGLOCK`, `TABLOCK`, `TABLOCKX`, `NOWAIT`, `HOLDLOCK`, `READCOMMITTED`, `READUNCOMMITTED`, `REPEATABLEREAD`, `SERIALIZABLE`.
- **Phân tích dữ liệu & Windowing**:
  - `PIVOT`, `UNPIVOT`
  - `RANGE`, `UNBOUNDED`, `PRECEDING`, `FOLLOWING`, `WITHIN`

### 3.3. Bổ Sung +96 Hàm Built-in & +27 Kiểu Dữ Liệu
Toàn bộ danh mục hàm và kiểu dữ liệu mới được đồng bộ đồng nhất qua:
1. `static/js/monaco-sql-lang.js` (Monarch Tokenizer, tô màu syntax)
2. `static/js/sql-dialects.js` (Autocomplete gợi ý thông minh)
3. `static/js/sql-formatter.js` (Chuẩn hóa viết hoa từ khóa khi format)
4. `static/js/sql-function-signatures.js` (Signature Help gợi ý tham số hàm)

#### Danh mục hàm built-in nổi bật (+96 hàm):
- **UUID & JSON**: `GEN_RANDOM_UUID`, `UUID_GENERATE_V4`, `JSONB_SET`, `JSON_BUILD_OBJECT`, `JSON_BUILD_ARRAY`, `JSONB_AGG`, `JSON_AGG`, `JSONB_PATH_QUERY`, `JSONB_PRETTY`.
- **T-SQL Metadata & Identity**: `SCOPE_IDENTITY`, `IDENT_CURRENT`, `@@IDENTITY`, `PARSENAME`, `OBJECT_DEFINITION`, `OBJECT_ID`, `OBJECT_NAME`, `SCHEMA_NAME`, `SCHEMA_ID`, `DB_NAME`, `COL_NAME`.
- **Date/Time**: `DATEDIFF_BIG`, `DATETIME2FROMPARTS`, `TIMEFROMPARTS`, `DATEFROMPARTS`, `AT TIME ZONE`.
- **String & Aggregation**: `STRING_AGG`, `STRING_SPLIT`, `CONCAT_WS`, `FORMAT`, `TRANSLATE`, `TRIM`.
- **Window & Analytics**: `PERCENT_RANK`, `CUME_DIST`, `PERCENTILE_CONT`, `PERCENTILE_DISC`.

#### Danh mục kiểu dữ liệu chuyên sâu (+27 kiểu dữ liệu):
- **PostgreSQL**: `INTERVAL`, `INET`, `CIDR`, `MACADDR`, `MACADDR8`, `UUID`, `POINT`, `LINE`, `LSEG`, `BOX`, `PATH`, `POLYGON`, `CIRCLE`, `JSONB`, `TSVECTOR`, `TSQUERY`.
- **SQL Server**: `ROWVERSION`, `HIERARCHYID`, `GEOMETRY`, `GEOGRAPHY`, `DATETIMEOFFSET`, `SMALLDATETIME`, `SQL_VARIANT`.

---

## 4. Danh Mục Tập Tin Thay Đổi (File Changes)

| Tập tin | Loại thay đổi | Mô tả chi tiết |
|---|---|---|
| `app/version.py` | Cập nhật | Nâng `__version__ = "1.0.7"` và tuple `(1, 0, 7)`. |
| `version.json` | Cập nhật | Đồng bộ metadata release `v1.0.7`, highlights và checksums. |
| `scripts/package_release.py` | Cập nhật | Cập nhật `VERSION = "1.0.7"` và bản tin release notes. |
| `app/database/syntax/adapters/postgresql_adapter.py` | Cải tiến | Sửa thuật toán nhận diện `END;` của Function PL/pgSQL khi chứa chuỗi nối `CASE WHEN ... \|\| CASE WHEN ...`. |
| `app/database/syntax/validator_mssql.py` | Cải tiến | Nâng cấp `find_unclosed_case_in_sql` theo dõi location stack, định vị chính xác từ khóa `CASE` thiếu `END`. |
| `static/js/monaco-sql-lang.js` | Mở rộng | Bổ sung từ khóa, functions, data types vào Monarch Tokenizer. |
| `static/js/sql-dialects.js` | Mở rộng | Bổ sung danh mục hoàn thành code và gợi ý từ khóa. |
| `static/js/sql-formatter.js` | Mở rộng | Thêm từ khóa vào danh sách chuẩn hóa format hoa thường. |
| `static/js/sql-function-signatures.js` | Mở rộng | Bổ sung gợi ý chữ ký tham số cho các hàm mới. |
| `CHANGELOG.md` | Cập nhật | Bổ sung mục `## [v1.0.7] — 21/10/2026`. |
| `docs/update_v1.0.7.md` | Tạo mới | Tài liệu chi tiết các thay đổi trong phiên bản v1.0.7. |
| `tests/test_postgres_case_and_function_end.py` | Tạo mới | Bộ test tự động chuyên biệt kiểm thử cú pháp Function PL/pgSQL và CASE WHEN (6/6 tests passed). |

---

## 5. Kết Quả Kiểm Thử (Verification & Testing)

Toàn bộ các bộ kiểm thử tự động của hệ thống đều vượt qua với tỷ lệ thành công **100%**:
- `tests/test_postgres_case_and_function_end.py`: **6/6 tests PASSED**
- `tests/test_version_and_updates.py`: **9/9 tests PASSED**
- Toàn bộ 113 bài test cú pháp SQL (`tests/test_syntax_*.py`): **113/113 PASSED**
- Toàn bộ test suite dự án: **1305+ tests PASSED**

---

## 6. Hướng Dẫn Nâng Cấp Lên v1.0.7

### Cách 1: Nâng cấp tại chỗ bằng gói Patch (`LLTool_v1.0.7_patch.zip` - Khuyên dùng)
1. Đóng ứng dụng LLTool IDE nếu đang chạy.
2. Giải nén toàn bộ nội dung của file `LLTool_v1.0.7_patch.zip` đè trực tiếp vào thư mục cài đặt hiện tại của LLTool IDE.
3. Khởi động lại `LLTool.exe` để trải nghiệm phiên bản mới nhất.

### Cách 2: Sử dụng gói cài đặt đầy đủ (`LLTool_v1.0.7.zip`)
1. Tải về và giải nén file `LLTool_v1.0.7.zip` vào một thư mục mới.
2. Chạy trực tiếp tệp `LLTool.exe`.
3. Toàn bộ cấu hình kết nối và lịch sử truy vấn vẫn được bảo toàn nguyên vẹn trong thư mục `%APPDATA%\LLTool`.
