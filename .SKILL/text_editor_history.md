# Kế hoạch xây dựng tính năng "Query History" cho SQL Editor

> Phạm vi: SQL Server / PostgreSQL. Mục tiêu: tự động lưu lịch sử mỗi lần **F5 (Execute)** theo từng file/tab, kể cả file chưa lưu ra ổ đĩa, và **không làm phình bộ nhớ**.

### Nguyên tắc bắt buộc

1. Không tự ý thay đổi code của dự án.
2. Chỉ sửa đổi các phần liên quan đến nội dung sửa đổi trong file này.
3. Không tự ý chỉnh lại giao diện
4. Đối với thiết kế giao diện phải tuân thủ theo quy tắc project (bootstrap 5, responsive, css/js riêng, giao diện theo theme,...)
5. Màn hình history sẽ là một cửa sổ mới khi mở lên (không phải modal)
6. Sử dụng sqllite để ghi và lưu log
7. Lưu log khong làm ảnh hưởng đến chức năng chính của IDE
8. Action bar hiển thị thêm 1 nút để hiển thị history. Khi user ấn vào sẽ hiển thị log của file đang mở (hiển thị layout bên phải của text editor). Nếu không có file nào đnag mở thì mở ra màn hình cửa sổ history. Menu conext của text edior sec thêm tùy chọn hiển thị history
9. Thêm vào nav-bar 1 menu view trước setting. Đưa history vào nhóm view. Khi ấn sẽ mở ra cửa sổ history

---

## 1. Phân tích giao diện hiện tại (theo ảnh)

| Vùng | Nội dung | Ý nghĩa nghiệp vụ |
| --- | --- | --- |
| Trên-trái: **Recent queries** | Nhóm theo thời gian (Last Week, Two Weeks Ago, Last Month), mỗi dòng: tên file, thời điểm chạy gần nhất, server, nút ⭐ | Danh sách **Document** (1 tab/file = 1 document) |
| Dưới-trái: **History for X** | Các mục lịch sử của document đang chọn, icon khác nhau (📄 / ▶), kèm giờ + server | Danh sách **HistoryEntry** của document |
| Phải | Header (tên file + thời gian), nội dung SQL (read-only, highlight), footer: server + database, nút **Open** | Xem trước nội dung của entry đang chọn |
| Thanh công cụ | Refresh, lọc Favorites, mở thư mục, ... | Tiện ích |

**Nhận xét / đề xuất chỉnh:**

- Hai icon trong History nên được định nghĩa rõ: `▶ Execution` (lần chạy F5) và `📄 Snapshot` (ví dụ lúc đóng tab/lưu file). Nếu chỉ yêu cầu log sau F5 thì **bắt đầu chỉ với Execution**, Snapshot để giai đoạn sau.
- Nên hiển thị thêm trong History: **trạng thái (✔ thành công / ✖ lỗi)**, **thời gian chạy (ms)**, **database**. Rất hữu ích khi tìm "lần nào chạy được".
- Footer hiện có 2 dòng (server, database) - giữ nguyên.

---

## 2. Quyết định thiết kế cốt lõi

### 2.1. Định danh document (quan trọng nhất)

- Mỗi tab khi được tạo sinh một **`DocId` (GUID)** và giữ suốt vòng đời tab, **không phụ thuộc đường dẫn file**.
- File đã lưu: gắn thêm `FilePath`. Khi *Save As* / đổi tên → vẫn cùng `DocId`, chỉ cập nhật `FilePath`.
- File chưa lưu (SQLQuery1.sql, SQLQuery2.sql...): chỉ có `DisplayName`; vẫn có log bình thường.
- Mở lại file từ ổ đĩa: tìm theo `FilePath` → nếu đã có document thì dùng lại `DocId` (gộp lịch sử), nếu chưa thì tạo mới.
- `DisplayName` mặc định tự tăng (SQLQuery1, 2, 3...) nhưng **không dùng làm khóa** (trong ảnh có nhiều "SQLQuery1.sql" khác nhau).

### 2.2. Nơi lưu trữ

**Khuyến nghị: SQLite (1 file DB cục bộ)**, ví dụ `%LOCALAPPDATA%\<AppName>\history.db`.

| Phương án | Ưu | Nhược |
| --- | --- | --- |
| **SQLite (khuyến nghị)** | Truy vấn/lọc/nhóm theo thời gian dễ, có FTS5 để search, transaction an toàn, dọn dẹp bằng SQL | Cần thêm thư viện |
| Mỗi lần 1 file .sql trong thư mục | Đơn giản | Hàng chục nghìn file nhỏ, chậm, khó search/dọn, tốn dung lượng cluster |
| JSON/XML 1 file | Dễ đọc | Ghi lại toàn bộ file mỗi lần, dễ hỏng, không scale |

Cấu hình SQLite: `journal_mode=WAL`, `synchronous=NORMAL`, `auto_vacuum=INCREMENTAL`.

### 2.3. Nội dung nào được log khi F5?

- Nếu có **vùng chọn (selection)** → log đúng đoạn được thực thi (`IsSelection = 1`).
- Nếu không → log **toàn bộ nội dung editor**.
- Luôn lưu thêm `Server`, `Database`, `Login/User` (không lưu password), thời điểm, thời gian chạy, kết quả (OK/Error + message rút gọn).
- Không log khi nội dung rỗng/chỉ có khoảng trắng và comment.

---

## 3. Mô hình dữ liệu (SQLite)

```sql
-- 1. Document: mỗi tab/file là 1 dòng
CREATE TABLE Document (
    DocId        TEXT PRIMARY KEY,          -- GUID
    DisplayName  TEXT NOT NULL,             -- SQLQuery1.sql
    FilePath     TEXT NULL,                 -- NULL nếu chưa lưu ra đĩa
    IsStarred    INTEGER NOT NULL DEFAULT 0,
    CreatedAt    INTEGER NOT NULL,          -- unix ms (UTC)
    LastRunAt    INTEGER NOT NULL,
    LastServer   TEXT NULL,
    LastDatabase TEXT NULL,
    IsDeleted    INTEGER NOT NULL DEFAULT 0 -- xóa mềm, dọn sau
);
CREATE INDEX IX_Document_LastRunAt ON Document(LastRunAt DESC);
CREATE INDEX IX_Document_FilePath  ON Document(FilePath);

-- 2. Content: lưu nội dung SQL 1 lần duy nhất theo hash (dedup)
CREATE TABLE Content (
    Hash       BLOB PRIMARY KEY,            -- SHA-256 của text đã chuẩn hóa EOL
    Body       BLOB NOT NULL,               -- nén (GZip/Zstd/LZ4)
    RawSize    INTEGER NOT NULL,
    RefCount   INTEGER NOT NULL DEFAULT 0   -- số HistoryEntry tham chiếu
);

-- 3. HistoryEntry: mỗi lần F5 (hoặc snapshot)
CREATE TABLE HistoryEntry (
    EntryId      INTEGER PRIMARY KEY AUTOINCREMENT,
    DocId        TEXT NOT NULL REFERENCES Document(DocId),
    ContentHash  BLOB NOT NULL REFERENCES Content(Hash),
    EntryType    INTEGER NOT NULL,          -- 1=Execution, 2=Snapshot
    ExecutedAt   INTEGER NOT NULL,          -- unix ms (UTC)
    Server       TEXT NOT NULL,
    DatabaseName TEXT NOT NULL,
    LoginName    TEXT NULL,
    IsSelection  INTEGER NOT NULL DEFAULT 0,
    DurationMs   INTEGER NULL,
    Status       INTEGER NULL,              -- 0=OK, 1=Error, 2=Cancelled
    ErrorSummary TEXT NULL,                 -- cắt tối đa ~300 ký tự
    RunCount     INTEGER NOT NULL DEFAULT 1 -- gộp các lần chạy giống hệt liên tiếp
);
CREATE INDEX IX_History_Doc_Time ON HistoryEntry(DocId, ExecutedAt DESC);
```

**Vì sao tách bảng `Content`?** Người dùng thường sửa 1 dòng rồi F5 liên tục, hoặc chạy lại đúng script cũ. Dedup theo hash giúp cùng 1 nội dung chỉ tốn dung lượng 1 lần.

(Tùy chọn Phase 5) Bảng ảo FTS5 để search toàn văn:

```sql
CREATE VIRTUAL TABLE ContentFts USING fts5(Text, content='');
```

> Lưu ý: FTS cần text gốc (không nén) nên làm tăng dung lượng; chỉ bật khi thật sự cần, hoặc chỉ index N ký tự đầu.

---

## 4. Logic ghi log khi nhấn F5

### 4.1. Luồng xử lý

```
User nhấn F5
   │
   ├─► [UI thread] Lấy: text (selection hoặc toàn bộ), DocId, server, database, login
   │
   ├─► Thực thi query như bình thường (KHÔNG chờ việc ghi log)
   │
   └─► Gửi HistoryRequest vào hàng đợi (Channel/BlockingCollection)
            │
            ▼
   [Background writer - 1 thread, batch trong 1 transaction]
     1. Chuẩn hóa text (chuẩn EOL \r\n→\n; KHÔNG trim nội dung bên trong)
     2. Bỏ qua nếu rỗng / chỉ whitespace+comment
     3. Nếu kích thước > MaxEntrySize → áp dụng chính sách "quá lớn" (mục 5.3)
     4. hash = SHA-256(text)
     5. Lấy entry mới nhất của DocId
        ├─ Cùng hash + cùng server + cùng database + cùng IsSelection
        │     → UPDATE entry đó: RunCount+1, ExecutedAt, DurationMs, Status
        │       (KHÔNG tạo dòng mới)
        └─ Khác → INSERT HistoryEntry mới
              ├─ Content đã có hash? → RefCount+1
              └─ Chưa có → nén + INSERT Content (RefCount=1)
     6. UPSERT Document (LastRunAt, LastServer, LastDatabase)
     7. Áp dụng retention theo document (mục 5.2) - nhẹ, chạy ngay trong transaction
```

### 4.2. Cập nhật kết quả sau khi query chạy xong

- Ghi entry **ngay lúc F5** (để không mất log nếu app crash / query treo), với `Status = NULL`.
- Khi query kết thúc, cập nhật `DurationMs`, `Status`, `ErrorSummary` bằng `EntryId`.

### 4.3. Quy tắc bắt buộc

- Ghi log **bất đồng bộ**, mọi lỗi ghi log chỉ ghi vào log kỹ thuật, **không bao giờ làm hỏng hoặc chặn F5**.
- Gộp ghi theo lô (batch) nếu người dùng bấm F5 liên tục.
- Khi tắt app: flush hàng đợi trước khi thoát (timeout ~2s).
- Dùng UTC để lưu, hiển thị theo giờ local.

---

## 5. Chiến lược chống phình dung lượng

### 5.1. Các lớp phòng thủ (theo thứ tự hiệu quả)

| # | Kỹ thuật | Hiệu quả |
| --- | --- | --- |
| 1 | **Dedup theo hash** (bảng Content) | Cùng nội dung chỉ lưu 1 lần |
| 2 | **Gộp lần chạy liên tiếp giống hệt** (RunCount) | Chạy lại 20 lần = 1 dòng |
| 3 | **Nén** Body (Zstd/LZ4 nhanh, GZip phổ biến) | Giảm ~70-90% với SQL text |
| 4 | **Bỏ qua** nội dung rỗng/trivial | Loại rác |
| 5 | **Giới hạn kích thước 1 entry** | Chặn script khổng lồ (INSERT hàng chục MB) |
| 6 | **Retention** theo số lượng / tuổi / tổng dung lượng | Chặn tăng vô hạn |
| 7 | **Dọn nền + VACUUM tăng dần** | Trả lại dung lượng đĩa |

### 5.2. Chính sách retention (mặc định, cho phép chỉnh trong Settings)

| Thông số | Mặc định đề xuất |
| --- | --- |
| Số entry tối đa / document | **200** (xóa cũ nhất) |
| Tuổi tối đa entry | **90 ngày** |
| Tổng dung lượng tối đa DB | **500 MB** (vượt → xóa entry cũ nhất của document không ⭐) |
| Document ⭐ (favorite) | **Không bị xóa tự động** (chỉ áp giới hạn số entry nếu cần) |
| Document rỗng không còn entry | Xóa luôn |

Khi xóa entry: giảm `RefCount` của Content; Content có `RefCount = 0` thì xóa.

### 5.3. Xử lý nội dung quá lớn

Đề xuất `MaxEntrySize = 1 MB` (sau chuẩn hóa, trước nén). Khi vượt:

- **Phương án A (khuyến nghị):** Vẫn ghi entry nhưng lưu **N ký tự đầu (ví dụ 64 KB) + cờ `IsTruncated`**, kèm hash đầy đủ.
- Phương án B: Không lưu nội dung, chỉ lưu metadata (thời gian, server, kích thước).
- Hiển thị rõ trên UI: "Nội dung quá lớn, chỉ lưu một phần".

### 5.4. Lịch dọn dẹp

- Khi khởi động app (sau 30s, chạy nền, mức ưu tiên thấp).
- Sau mỗi N lần ghi (ví dụ 100) kiểm tra dung lượng.
- `PRAGMA incremental_vacuum` sau khi xóa lượng lớn; `VACUUM` đầy đủ chỉ khi người dùng bấm "Compact" hoặc DB phình > 30% so với dữ liệu thật.

### 5.5. Ước lượng dung lượng (để kiểm chứng thiết kế)

Giả sử 1 dev chạy 300 lần F5/ngày, script trung bình 3 KB, sau dedup còn ~40% khác nhau, nén còn 20%:
`300 × 3KB × 0.4 × 0.2 ≈ 72 KB/ngày → ~6.5 MB / 90 ngày` + overhead index. Rất nhỏ; giới hạn 500 MB chủ yếu để phòng trường hợp bất thường.

---

## 6. Thiết kế giao diện

### 6.1. Bố cục (giữ như ảnh)

```
┌─────────────────────────┬──────────────────────────────────────┐
│ [🔍 Search...        ]  │ SQLQuery1.sql              21/09 23:43│
│ Recent queries ⟳ ★ 📂   ├──────────────────────────────────────┤
│ ┌─ Danh sách Document ─┐│  Nội dung SQL (read-only, highlight)  │
│ │ ▾ Last Week          ││                                      │
│ │   SQLQuery1.sql ☆    ││                                      │
│ │ ▾ Two Weeks Ago      ││                                      │
│ └──────────────────────┘│                                      │
│ History for SQLQuery1   │                                      │
│ ┌─ Danh sách Entry ────┐│                                      │
│ │ ▶ 21/09 23:43  ✔     ││                                      │
│ └──────────────────────┘├──────────────────────────────────────┤
│                         │ 🗄 server / db                [Open] │
└─────────────────────────┴──────────────────────────────────────┘
```

### 6.2. Chi tiết từng vùng

**Danh sách Document (trên-trái)**

- Nhóm theo mốc thời gian dựa trên `LastRunAt`: *Today, Yesterday, This Week, Last Week, Two Weeks Ago, Last Month, Older*. Nhóm rỗng thì ẩn; nhóm có thể thu gọn (như ảnh).
- Mỗi dòng: tên file (+ tooltip hiện đường dẫn đầy đủ nếu có), giờ chạy gần nhất, server, ⭐.
- Dấu hiệu phân biệt file **đã lưu ra đĩa** và **chưa lưu** (icon nhỏ) - vì có nhiều "SQLQuery1.sql" trùng tên.
- Sắp xếp: `LastRunAt` giảm dần; ⭐ có thể ghim lên nhóm riêng "Favorites".
- Nút toolbar: **Refresh**, **Chỉ hiện Favorites**, **Mở thư mục chứa file** (khi có FilePath), (thêm) **Xóa lịch sử**.
- Chuột phải: Open, Rename, Star/Unstar, Delete history, Copy path.

**Danh sách Entry (dưới-trái)**

- Cột: icon loại (▶/📄), thời gian, server, (thêm) database, trạng thái ✔/✖, thời gian chạy.
- Hiển thị `×N` nếu `RunCount > 1`.
- Mặc định chọn entry mới nhất khi chọn document.
- Chuột phải: Open, Copy SQL, **Compare with previous / Compare with current editor** (Phase 5), Delete entry.

**Vùng nội dung (phải)**

- Dùng chính control editor hiện có ở chế độ **read-only** để có syntax highlight đồng nhất.
- Header: tên file + thời gian entry. Footer: server + database (+ cờ "selection only" / "truncated" nếu có).
- Nút **Open**: mở nội dung vào **tab mới** (không ghi đè tab đang mở), kèm kết nối server/database của entry nếu người dùng đồng ý (hỏi hoặc có setting).
- Double-click entry = Open.

### 6.3. Hiệu năng UI

- **Lazy load:** chỉ nạp danh sách document (metadata) khi mở panel; nạp entry khi chọn document; nạp `Body` (giải nén) chỉ khi chọn entry.
- **Virtualized list** nếu > vài trăm dòng.
- Debounce search 250-300 ms; search trong tên file/đường dẫn trước, nội dung sau (nếu có FTS).
- Không giữ nội dung đã giải nén trong RAM quá 1-2 entry (cache LRU nhỏ).
- Phím tắt gợi ý: `Ctrl+Alt+H` mở panel, `Enter` = Open, `Del` = xóa entry, `Ctrl+D` = star.

---

## 7. Kế hoạch triển khai theo giai đoạn

### Giai đoạn 0 - Chốt yêu cầu & quyết định (1-2 ngày)

- [ ] Chốt ý nghĩa 2 loại icon (▶ Execution, 📄 Snapshot) - bắt đầu chỉ Execution.
- [ ] Chốt: log selection hay toàn bộ; có log khi lỗi cú pháp không (khuyến nghị **có**, Status=Error).
- [ ] Chốt giá trị retention mặc định (mục 5.2) và giới hạn entry (mục 5.3).
- [ ] Chốt chính sách dữ liệu nhạy cảm (mục 8).
- **Kết quả:** tài liệu quyết định 1 trang.

### Giai đoạn 1 - Tầng lưu trữ (3-4 ngày)

- [x] Tích hợp SQLite, tạo schema + cơ chế migration (`PRAGMA user_version`).
- [x] Viết `IHistoryStore`: `AddEntry`, `UpdateEntryResult`, `GetDocuments`, `GetEntries(docId)`, `GetContent(hash)`, `Delete…`, `ToggleStar`.
- [x] Chuẩn hóa text + hash + nén/giải nén.
- [x] Unit test: dedup, RefCount, gộp RunCount, xóa an toàn.
- **Kết quả:** thư viện store chạy độc lập, test xanh.

### Giai đoạn 2 - Logic ghi log từ F5 (3-4 ngày)

- [x] Cấp `DocId` cho mỗi tab; lưu/khôi phục `DocId` trong session (khi app restart, tab khôi phục vẫn giữ DocId).
- [x] Hook vào lệnh Execute: thu thập context → đẩy hàng đợi → background writer.
- [x] Ghi entry ngay lúc F5, cập nhật kết quả khi query kết thúc.
- [x] Xử lý: Save / Save As / Rename / mở file đã có (gộp theo FilePath).
- [x] Bỏ qua rỗng/trivial, xử lý nội dung quá lớn, flush khi thoát.
- **Kết quả:** mỗi F5 sinh log đúng; F5 không bị chậm (đo được < 5 ms trên UI thread).

### Giai đoạn 3 - Giao diện (4-6 ngày)

- [x] Dựng 3 vùng + toolbar như ảnh, kết nối `IHistoryStore`.
- [x] Nhóm theo thời gian, star, refresh, lọc favorites.
- [x] Preview read-only có syntax highlight, nút **Open** (tab mới).
- [x] Context menu, phím tắt, trạng thái rỗng ("Chưa có lịch sử").
- [x] Hiển thị Status/Duration/database trong danh sách entry.
- **Kết quả:** người dùng xem, mở lại, ghim được lịch sử.

### Giai đoạn 4 - Retention & dọn dẹp (2-3 ngày)

- [x] Retention theo số entry / tuổi / tổng dung lượng.
- [x] Job dọn nền khi khởi động + định kỳ; incremental vacuum.
- [x] Màn hình **Settings → History**: bật/tắt, các giới hạn, hiển thị dung lượng hiện tại, nút *Clear all* / *Compact*.
- [x] Test tải: giả lập 100k entry, đo dung lượng & thời gian mở panel.
- **Kết quả:** dung lượng bị chặn trên, không cần người dùng can thiệp.

### Giai đoạn 5 - Tính năng nâng cao (tùy chọn, 4-6 ngày)

- [x] Search toàn văn trong nội dung SQL (đã hoàn thành & tối ưu hóa giải nén trực tiếp).
- [x] **Diff**: so sánh entry với entry trước / với editor hiện tại / mở Diff ở editor chính.
- [x] Snapshot khi đóng tab hoặc Save (📄, entry_type = 2).
- [x] Export/Import lịch sử (JSON), gắn nhãn (Tag)/ghi chú (Note) entry.
- [x] Lọc nâng cao theo server/database/khoảng ngày/nhãn (Tag)/trạng thái.
- **Kết quả:** Đầy đủ công cụ so sánh Diff, bộ lọc đa chiều, gắn nhãn/ghi chú và xuất/nhập lịch sử.

### Giai đoạn 6 - Kiểm thử, ra mắt, theo dõi (3-4 ngày)

- [ ] Test các tình huống: crash giữa chừng, 2 instance app cùng mở (WAL + busy_timeout), DB bị hỏng (tự backup + tạo mới), ổ đĩa đầy, file DB bị khóa.
- [ ] Test đa kết nối: đổi server/database giữa các lần F5 trong cùng 1 tab.
- [ ] Bật mặc định cho nhóm thử nghiệm nội bộ 1-2 tuần; theo dõi dung lượng DB & lỗi ghi log.
- [ ] Hoàn thiện tài liệu người dùng.

**Tổng ước lượng:** ~3-4 tuần cho 1 dev (Phase 0-4 + 6 ≈ 2.5-3 tuần, Phase 5 tùy chọn).

---

## 8. Rủi ro & lưu ý

| Rủi ro | Giải pháp |
| --- | --- |
| **Dữ liệu nhạy cảm** trong script (mật khẩu, `CREATE LOGIN ... PASSWORD`, token, dữ liệu khách hàng) | Setting bật/tắt log; tùy chọn *không log* các câu chứa từ khóa nhạy cảm; DB lưu trong profile người dùng (quyền hạn chế); cân nhắc mã hóa DB (SQLCipher/DPAPI) |
| Hai instance app ghi cùng lúc | WAL + `busy_timeout`; ghi qua 1 writer/instance, retry ngắn |
| DB hỏng | `PRAGMA integrity_check` khi khởi động; backup định kỳ bản nhỏ; tự tạo mới nếu hỏng |
| Log làm chậm F5 | Ghi bất đồng bộ + batch, không bao giờ chờ trên UI thread |
| Trùng tên "SQLQuery1.sql" gây nhầm | Dùng DocId nội bộ + hiển thị tooltip, icon đã-lưu/chưa-lưu, thời gian tạo |
| Người dùng sửa 1 ký tự rồi F5 liên tục → entry rác | Dedup theo hash + giới hạn số entry/document + (tùy chọn) gộp các entry cách nhau < 2 giây |
| Đổi định dạng xuống dòng làm hash khác | Chuẩn hóa EOL trước khi hash |

---

## 9. Tiêu chí nghiệm thu (Definition of Done)

1. Mỗi lần F5 tạo/cập nhật đúng 1 entry (đúng theo quy tắc gộp) cho đúng document, kể cả file chưa lưu ra đĩa.
2. F5 không bị chậm đáng kể (< 5 ms trên UI thread cho việc ghi log).
3. Chạy lại đúng script cũ nhiều lần **không** làm tăng số dòng/dung lượng đáng kể.
4. Dung lượng DB không vượt giới hạn cấu hình sau stress test 100k lần F5.
5. Panel mở < 300 ms với 5.000 document; chọn entry hiển thị nội dung < 100 ms.
6. Open mở nội dung vào tab mới đúng, giữ đúng server/database.
7. Crash app giữa chừng không làm mất entry đã ghi và không hỏng DB.

---

## 10. Xác nhận yêu cầu (Đã chốt)

1. **Biểu tượng phân loại (Icon)**:
   - Icon 📄: Chỉnh sửa văn bản / Snapshot (khi Lưu file Ctrl+S hoặc Đóng tab).
   - Icon ▶: Lần thực thi câu lệnh truy vấn (F5 / Ctrl+E / Run).
2. **Ghi log khi lỗi cú pháp**:
   - **Có**: Ghi nhận toàn bộ các lần chạy dù câu lệnh bị lỗi cú pháp từ database server hoặc client, gắn nhãn trạng thái `Lỗi` (màu đỏ) kèm thông điệp tóm tắt lỗi `error_summary`.
