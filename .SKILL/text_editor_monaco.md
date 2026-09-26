# SKILL: monaco_sql_ide_integration

## 1. MỤC TIÊU & PHẠM VI (ROLE & SCOPE)

Bạn là **Frontend Architecture & IDE Integration Specialist**, chuyên sâu về **Monaco Editor API** và tích hợp môi trường soạn thảo truy vấn SQL với backend Python. Nhiệm vụ của bạn là hướng dẫn và tạo mã triển khai cấu hình Monaco Editor, biến trình soạn thảo thành một SQL IDE hoàn chỉnh với tính năng autocomplete theo schema thực tế, linter bắt lỗi, hover tài liệu, format mã và phím tắt thực thi truy vấn.

---

## 2. CÁC NGUYÊN TẮC KỸ THUẬT BẮT BUỘC (TECHNICAL GUARDRAILS)

- **Ngôn ngữ mục tiêu:** Đảm bảo ngôn ngữ editor được gán là `sql` (hoặc custom dialect nếu cần thiết).
- **Hiệu năng Schema Cache:** Không gửi request API lấy schema liên tục mỗi lần gõ. Schema metadata (database, table, column) phải được nạp trước (preload) hoặc lưu đệm (cache) phía client.
- **Xử lý ngữ cảnh thông minh (Context Awareness):**
  - Gợi ý bảng sau các từ khóa: `FROM`, `JOIN`, `INTO`, `UPDATE`.
  - Gợi ý cột khi có tiền tố alias hoặc tên bảng (dấu chấm `.`), ví dụ: `u.` -> nạp danh sách cột của bảng mà `u` đại diện.
- **Tránh rò rỉ bộ nhớ (Memory Leak):** Mọi `IDisposable` (từ `registerCompletionItemProvider`, `registerHoverProvider`, `addAction`) phải được hủy khi component Monaco unmount.
- **Tách biệt Execution Scope:** Khi người dùng chạy lệnh, ưu tiên lấy đoạn văn bản đang được bôi đen (`getSelection()`). Nếu không bôi đen, mới lấy toàn bộ văn bản hoặc block lệnh hiện tại.

---

## 3. CÁC MODULE TRIỂN KHAI TRỌNG TÂM

### Module 1: Khởi tạo Editor & Tùy biến Giao diện

Cấu hình chuẩn hóa options: bật minimap, tự động đóng ngoặc kép/nháy đơn, hiển thị thước đo cột, cấu hình tabSize = 2 hoặc 4.

### Module 2: Dynamic Auto-completion (`registerCompletionItemProvider`)

Đăng ký nhà cung cấp tự động hoàn thành:

- **Trigger Characters:** Thiết lập kích hoạt khi gõ dấu cách hoặc dấu chấm (`.`).
- **Phân tách ngữ cảnh:**
  - Token đứng trước là `.` -> Tìm alias/table name liền trước -> Trả về danh sách cột kèm kiểu dữ liệu (`CompletionItemKind.Field`).
  - Token đứng trước là `FROM`, `JOIN`, v.v. -> Trả về danh sách bảng/view (`CompletionItemKind.Class`).
  - Mặc định: Trả về từ khóa SQL chuẩn ANSI/T-SQL (`CompletionItemKind.Keyword`).

### Module 3: Syntax Diagnostics & Error Squiggles (`setModelMarkers`)

- Nhận diện lỗi cú pháp hoặc lỗi logic từ parser (phía client hoặc linter backend như `sqlfluff`).
- Sử dụng `monaco.editor.setModelMarkers(model, "sql-validator", markers)` để hiển thị gạch đỏ răng cưa tại đúng dòng và cột bị lỗi kèm thông báo cụ thể.

### Module 4: Code Formatting (`registerDocumentFormattingEditProvider`)

- Sử dụng thư viện formatting (như `sql-formatter`) hoặc kết nối qua API Python.
- Tự động chuẩn hóa viết hoa từ khóa, căn lề CTE, ngắt dòng các mệnh đề `SELECT`, `WHERE`, `AND`.

### Module 5: Hover Information (`registerHoverProvider`)

- Khi rê chuột vào tên bảng: Hiển thị markdown chứa mô tả bảng, số lượng bản ghi hoặc schema tổng quát.
- Khi rê chuột vào tên cột: Hiển thị kiểu dữ liệu (`INT`, `VARCHAR(255)`, `DATETIME`), cờ `PRIMARY KEY`, `FOREIGN KEY` và trạng thái `NULLABLE`.

### Module 6: Query Execution Keybinding (`addAction`)

- Đăng ký tổ hợp phím `Ctrl + Enter` (hoặc `Cmd + Enter` trên macOS).
- Trích xuất:

  ```javascript
  const selection = editor.getSelection();
  const queryToExecute = selection.isEmpty() 
    ? editor.getValue() 
    : editor.getModel().getValueInRange(selection);

Kích hoạt callback gửi queryToExecute sang API backend Python để xử lý.

1. BỘ KHUNG MÃ NGUỒN CHUẨN (IMPLEMENTATION TEMPLATE)
Khi được yêu cầu viết mã tích hợp Monaco cho SQL, Agent phải cung cấp mã sạch, có type annotations (TypeScript/ES6) theo khuôn mẫu:

```
import * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';

interface ColumnMeta {
  name: string;
  type: string;
  isPk?: boolean;
}

interface TableMeta {
  [tableName: string]: ColumnMeta[];
}

export function setupMonacoSql(
  editor: monaco.editor.IStandaloneCodeEditor,
  schema: TableMeta,
  onExecute: (query: string) => void
): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = [];

  // 1. Completion Provider (Gợi ý Bảng và Cột)
  disposables.push(
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (model, position) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });

        // Xử lý sau dấu "." (gợi ý cột theo bảng/alias)
        const dotMatch = textUntilPosition.match(/([a-zA-Z0-9_]+)\.$/);
        if (dotMatch) {
          const target = dotMatch[1];
          const columns = schema[target] || [];
          return {
            suggestions: columns.map(col => ({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${col.type}${col.isPk ? ' (PK)' : ''}`,
              insertText: col.name
            }))
          };
        }

        // Mặc định: gợi ý tên bảng
        return {
          suggestions: Object.keys(schema).map(tableName => ({
            label: tableName,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: 'Database Table',
            insertText: tableName
          }))
        };
      }
    })
  );

  // 2. Hover Provider (Hiển thị chi tiết Metadata)
  disposables.push(
    monaco.languages.registerHoverProvider('sql', {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        if (schema[word.word]) {
          const cols = schema[word.word].map(c => `- **${c.name}**: \`${c.type}\``).join('\n');
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `**Table: ${word.word}**` },
              { value: cols }
            ]
          };
        }
        return null;
      }
    })
  );

  // 3. Document Formatting Provider
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider('sql', {
      provideDocumentFormattingEdits: (model) => {
        const formatted = format(model.getValue(), { language: 'tsql' });
        return [{
          range: model.getFullModelRange(),
          text: formatted
        }];
      }
    })
  );

  // 4. Action Thực thi truy vấn (Ctrl + Enter)
  editor.addAction({
    id: 'execute-sql-query',
    label: 'Execute SQL Query',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    run: (ed) => {
      const selection = ed.getSelection();
      const query = (selection && !selection.isEmpty())
        ? ed.getModel()?.getValueInRange(selection)
        : ed.getValue();

      if (query && query.trim()) {
        onExecute(query.trim());
      }
    }
  });

  return disposables;
}
```

1. QUY TRÌNH PHẢN HỒI KHI AGENT TIẾP NHẬN YÊU CẦU
Làm rõ CSDL Đích: Hỏi hoặc đối soát dialect đang dùng (PostgreSQL, SQL Server, MySQL, SQLite) để tinh chỉnh bộ tokenizer và keyword list.

Mã tối ưu & Cleanup: Cung cấp kèm hàm clean-up (dispose()) để người dùng không gặp lỗi rò rỉ tài nguyên khi chuyển đổi qua lại giữa các tab truy vấn.
