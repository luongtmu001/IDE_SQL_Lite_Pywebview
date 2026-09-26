/**
 * Bravo XML Monaco Editor Integration Module
 * File: static/js/bravo/features/bravo-xml-monaco.js
 * 
 * Provides Monaco Editor setup for BRAVO XML Layouts with 5 advanced features:
 *  1. Validation / Linting (DOMParser & setModelMarkers with red squiggly lines)
 *  2. Linked Editing / Auto-Rename Tag (synchronously renames matching open/close tags)
 *  3. Auto-Close Tag (automatically inserts closing tag on `>` and completes parent tag on `</`)
 *  4. Document Formatting (Shift+Alt+F & Beautify using registerDocumentFormattingEditProvider)
 *  5. Schema IntelliSense (Bravo XML Tags, Attributes, and Values/Enums Completion)
 */

(function (window) {
    'use strict';

    // Guard: ensure single registration of language providers
    let _providersRegistered = false;

    // ── Predefined Schema Dictionaries for Bravo XML Layouts ───────────────────
    const BRAVO_XML_TAGS = [
        { name: 'FormLayout', doc: 'Thẻ gốc bố cục form layout', snippet: 'FormLayout Name="${1:FormName}" Width="${2:1024}" Height="${3:768}">\n\t$0\n</FormLayout>' },
        { name: 'Form', doc: 'Bố cục Form BRAVO', snippet: 'Form Name="${1:FormName}" Title="${2:Tiêu đề}">\n\t$0\n</Form>' },
        { name: 'Header', doc: 'Tiêu đề form hoặc nhóm control', snippet: 'Header Title="${1:Tiêu đề}" AllowMinimize="True" />' },
        { name: 'Footer', doc: 'Chân form hoặc dòng tổng cộng', snippet: 'Footer ShowTotalSummary="True" />' },
        { name: 'Controls', doc: 'Vùng chứa danh sách các điều khiển', snippet: 'Controls>\n\t$0\n</Controls>' },
        { name: 'Grid', doc: 'Lưới dữ liệu hiển thị danh sách chứng từ/danh mục', snippet: 'Grid Name="${1:grdDoc}" Dock="Fill">\n\t$0\n</Grid>' },
        { name: 'DataGrid', doc: 'Bảng dữ liệu nâng cao', snippet: 'DataGrid Name="${1:dgData}" Dock="Fill">\n\t$0\n</DataGrid>' },
        { name: 'Column', doc: 'Cột hiển thị trong bảng dữ liệu', snippet: 'Column Name="${1:FieldCode}" Title="${2:Tiêu đề}" Width="${3:120}" Align="${4|Center,Left,Right|}" />' },
        { name: 'Row', doc: 'Dòng định nghĩa cấu trúc', snippet: 'Row Height="${1:28}">\n\t$0\n</Row>' },
        { name: 'Panel', doc: 'Khung nhóm chứa giao diện', snippet: 'Panel Name="${1:pnlMain}" Dock="${2|Fill,Top,Bottom,Left,Right|}">\n\t$0\n</Panel>' },
        { name: 'TabControl', doc: 'Bộ điều khiển Tab nhiều trang', snippet: 'TabControl Name="${1:tabMain}" Dock="Fill">\n\t$0\n</TabControl>' },
        { name: 'TabPage', doc: 'Trang con trong TabControl', snippet: 'TabPage Title="${1:Chi tiết}" Name="${2:tabDetail}">\n\t$0\n</TabPage>' },
        { name: 'TextBox', doc: 'Hộp nhập văn bản', snippet: 'TextBox Name="${1:txtCode}" DataField="${2:Code}" Width="${3:180}" />' },
        { name: 'NumericBox', doc: 'Hộp nhập số tiền, số lượng', snippet: 'NumericBox Name="${1:numAmount}" DataField="${2:Amount}" Format="#,##0" Width="${3:140}" Align="Right" />' },
        { name: 'DatePicker', doc: 'Hộp chọn ngày tháng', snippet: 'DatePicker Name="${1:dtDocDate}" DataField="${2:DocDate}" Width="${3:120}" Align="Center" />' },
        { name: 'ComboBox', doc: 'Hộp danh sách chọn dropdown', snippet: 'ComboBox Name="${1:cboType}" DataField="${2:Type}" DataSource="${3:Types}" Width="${4:160}" />' },
        { name: 'CheckBox', doc: 'Hộp kiểm chọn Có/Không', snippet: 'CheckBox Name="${1:chkActive}" Text="${2:Kích hoạt}" DataField="${3:IsActive}" />' },
        { name: 'Button', doc: 'Nút bấm thao tác', snippet: 'Button Name="${1:btnAction}" Text="${2:Thực hiện}" Width="${3:100}" />' },
        { name: 'Label', doc: 'Nhãn văn bản hiển thị', snippet: 'Label Text="${1:Mô tả:}" Width="${2:100}" />' },
        { name: 'ToolBar', doc: 'Thanh công cụ chức năng', snippet: 'ToolBar Name="${1:toolBar}">\n\t$0\n</ToolBar>' },
        { name: 'Command', doc: 'Lệnh thực thi trong ToolBar', snippet: 'Command Key="${1:Save}" Text="${2:Lưu}" Image="${3:save.png}" />' },
        { name: 'Splitter', doc: 'Thanh ngăn phân chia kích thước các panel', snippet: 'Splitter Dock="${1|Left,Top,Right,Bottom|}" Width="4" />' },
        { name: 'GroupBox', doc: 'Khung viền nhóm các điều khiển', snippet: 'GroupBox Title="${1:Thông tin chung}">\n\t$0\n</GroupBox>' },
        { name: 'TreeView', doc: 'Cây phân cấp dữ liệu', snippet: 'TreeView Name="${1:tvMenu}" Dock="Left" Width="220" />' },
        { name: 'ListView', doc: 'Danh sách đối tượng', snippet: 'ListView Name="${1:lvItems}" Dock="Fill" />' },
        { name: 'Image', doc: 'Hiển thị hình ảnh hoặc icon', snippet: 'Image Name="${1:imgLogo}" Width="48" Height="48" />' },
        { name: 'Layout', doc: 'Bố cục phần tử con', snippet: 'Layout Type="${1|Vertical,Horizontal,Grid|}">\n\t$0\n</Layout>' },
        { name: 'Property', doc: 'Thuộc tính động', snippet: 'Property Name="${1:PropName}" Value="${2:Value}" />' },
        { name: 'Items', doc: 'Danh sách các mục', snippet: 'Items>\n\t$0\n</Items>' }
    ];

    const BRAVO_XML_ATTRIBUTES = [
        { name: 'Name', doc: 'Tên định danh duy nhất của control' },
        { name: 'Title', doc: 'Tiêu đề hiển thị của form, tab, column hoặc group' },
        { name: 'Text', doc: 'Nội dung chữ hiển thị' },
        { name: 'DataField', doc: 'Trường dữ liệu kết nối (Database Binding)' },
        { name: 'Binding', doc: 'Biểu thức liên kết dữ liệu' },
        { name: 'DataSource', doc: 'Nguồn dữ liệu của combobox, grid' },
        { name: 'Width', doc: 'Chiều rộng phần tử (pixel hoặc auto)' },
        { name: 'Height', doc: 'Chiều cao phần tử (pixel hoặc auto)' },
        { name: 'Top', doc: 'Tọa độ cách mép trên' },
        { name: 'Left', doc: 'Tọa độ cách mép trái' },
        { name: 'Right', doc: 'Tọa độ cách mép phải' },
        { name: 'Bottom', doc: 'Tọa độ cách mép dưới' },
        { name: 'Dock', doc: 'Neo dính vào cạnh container (Fill, Top, Bottom, Left, Right, None)' },
        { name: 'Anchor', doc: 'Neo co dãn (Top, Bottom, Left, Right)' },
        { name: 'Align', doc: 'Căn lề văn bản (Left, Center, Right, Justify)' },
        { name: 'Alignment', doc: 'Căn chỉnh phần tử' },
        { name: 'Visible', doc: 'Hiển thị hay ẩn control (True / False)' },
        { name: 'Enabled', doc: 'Cho phép thao tác (True / False)' },
        { name: 'ReadOnly', doc: 'Chỉ cho phép đọc, không sửa (True / False)' },
        { name: 'Format', doc: 'Định dạng số hoặc ngày tháng (ví dụ: #,##0, dd/MM/yyyy)' },
        { name: 'Status', doc: 'Trạng thái bản vẽ (Active, Draft)' },
        { name: 'AllowMinimize', doc: 'Cho phép thu nhỏ (True / False)' },
        { name: 'AllowMaximize', doc: 'Cho phép phóng to (True / False)' },
        { name: 'ShowTotalSummary', doc: 'Hiển thị dòng tổng cộng chân bảng (True / False)' },
        { name: 'AllowSorting', doc: 'Cho phép sắp xếp cột (True / False)' },
        { name: 'AllowUserToAddRows', doc: 'Cho phép người dùng thêm dòng mới (True / False)' },
        { name: 'AllowUserToDeleteRows', doc: 'Cho phép người dùng xóa dòng (True / False)' },
        { name: 'AutoGenerateColumns', doc: 'Tự động tạo cột theo câu truy vấn (True / False)' },
        { name: 'RowHeight', doc: 'Độ cao của mỗi dòng' },
        { name: 'FrozenColumns', doc: 'Số lượng cột cố định bên trái khi cuộn ngang' },
        { name: 'TabIndex', doc: 'Thứ tự phím Tab' },
        { name: 'ForeColor', doc: 'Màu chữ' },
        { name: 'BackColor', doc: 'Màu nền' },
        { name: 'Font', doc: 'Phông chữ' },
        { name: 'FontSize', doc: 'Cỡ chữ' },
        { name: 'FontBold', doc: 'Chữ in đậm (True / False)' },
        { name: 'CommandKey', doc: 'Mã phím lệnh tương ứng' },
        { name: 'DefaultValue', doc: 'Giá trị mặc định ban đầu' },
        { name: 'Type', doc: 'Kiểu điều khiển hoặc kiểu dữ liệu' }
    ];

    const BRAVO_ATTR_VALUES = {
        'Align': ['Left', 'Center', 'Right', 'Justify'],
        'Alignment': ['Left', 'Center', 'Right', 'Top', 'Bottom', 'Center'],
        'Dock': ['Fill', 'Top', 'Bottom', 'Left', 'Right', 'None'],
        'Visible': ['True', 'False'],
        'Enabled': ['True', 'False'],
        'ReadOnly': ['True', 'False'],
        'AllowMinimize': ['True', 'False'],
        'AllowMaximize': ['True', 'False'],
        'ShowTotalSummary': ['True', 'False'],
        'AllowSorting': ['True', 'False'],
        'AllowUserToAddRows': ['True', 'False'],
        'AllowUserToDeleteRows': ['True', 'False'],
        'AutoGenerateColumns': ['True', 'False'],
        'FontBold': ['True', 'False'],
        'Status': ['Active', 'Draft']
    };

    // ── XML Beautifier Function ───────────────────────────────────────────────
    function beautifyXmlString(xml, tabSize = 2) {
        if (!xml || typeof xml !== 'string') return '';
        const indentStr = ' '.repeat(tabSize);

        // Normalize newlines and collapse whitespace between tags
        let raw = xml.replace(/>\s*</g, '><').trim();
        let formatted = '';
        let indent = 0;

        // Tokenize tags, comments, cdata and text
        const regex = /(<!--[\s\S]*?-->)|(<!\[CDATA\[[\s\S]*?\]\]>)|(<\?[^>]*\?>)|(<\/?[a-zA-Z0-9_:-]+(?:\s+[^>]*)?\/?>)|([^<]+)/g;
        let match;

        while ((match = regex.exec(raw)) !== null) {
            const [full, comment, cdata, pi, tag, text] = match;

            if (comment) {
                formatted += '\n' + indentStr.repeat(indent) + comment;
            } else if (cdata) {
                formatted += '\n' + indentStr.repeat(indent) + cdata;
            } else if (pi) {
                formatted += pi + '\n';
            } else if (tag) {
                if (tag.startsWith('</')) {
                    // Closing tag
                    indent = Math.max(0, indent - 1);
                    formatted += '\n' + indentStr.repeat(indent) + tag;
                } else if (tag.endsWith('/>')) {
                    // Self-closing tag
                    formatted += '\n' + indentStr.repeat(indent) + tag;
                } else {
                    // Opening tag
                    formatted += '\n' + indentStr.repeat(indent) + tag;
                    indent++;
                }
            } else if (text && text.trim()) {
                // Text node inside a tag
                formatted += text.trim();
            }
        }

        return formatted.trim();
    }

    // ── XML Tag Matcher for Linked Editing ────────────────────────────────────
    function findMatchingTagRanges(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const line = model.getLineContent(position.lineNumber);
        const col = position.column;

        // Pattern 1: <(TagName) ...>
        const openTagRegex = /<([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?>/g;
        // Pattern 2: </(TagName)>
        const closeTagRegex = /<\/([a-zA-Z0-9_\-:]+)>/g;

        let isCurrentOpen = false;
        let isCurrentClose = false;
        let targetTag = word.word;

        let m;
        while ((m = openTagRegex.exec(line)) !== null) {
            const tagStartCol = m.index + 2; // after '<'
            const tagEndCol = tagStartCol + m[1].length;
            if (col >= tagStartCol && col <= tagEndCol && m[1] === targetTag) {
                isCurrentOpen = true;
                break;
            }
        }

        if (!isCurrentOpen) {
            while ((m = closeTagRegex.exec(line)) !== null) {
                const tagStartCol = m.index + 3; // after '</'
                const tagEndCol = tagStartCol + m[1].length;
                if (col >= tagStartCol && col <= tagEndCol && m[1] === targetTag) {
                    isCurrentClose = true;
                    break;
                }
            }
        }

        if (!isCurrentOpen && !isCurrentClose) return null;

        const fullText = model.getValue();
        const tagRegex = /(<!--[\s\S]*?-->)|(<!\[CDATA\[[\s\S]*?\]\]>)|<(\/)?([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?(\/)?>/g;
        const stack = [];
        let matchedPair = null;

        while ((m = tagRegex.exec(fullText)) !== null) {
            if (m[1] || m[2]) continue;
            const isClosing = Boolean(m[3]);
            const tagName = m[4];
            const isSelfClosing = Boolean(m[5]);

            if (tagName !== targetTag) continue;
            if (isSelfClosing) continue;

            const offset = m.index;
            const pos = model.getPositionAt(offset);

            if (!isClosing) {
                const startCol = pos.column + 1;
                const range = new monaco.Range(pos.lineNumber, startCol, pos.lineNumber, startCol + tagName.length);
                stack.push({ range, offset });
            } else {
                const startCol = pos.column + 2;
                const range = new monaco.Range(pos.lineNumber, startCol, pos.lineNumber, startCol + tagName.length);
                if (stack.length > 0) {
                    const openItem = stack.pop();
                    const cursorOffset = model.getOffsetAt(position);
                    const openStartOffset = openItem.offset;
                    const openEndOffset = openItem.offset + tagName.length + 2;
                    const closeStartOffset = offset;
                    const closeEndOffset = offset + tagName.length + 3;

                    if ((cursorOffset >= openStartOffset && cursorOffset <= openEndOffset) ||
                        (cursorOffset >= closeStartOffset && cursorOffset <= closeEndOffset)) {
                        matchedPair = {
                            ranges: [openItem.range, range],
                            wordPattern: /[a-zA-Z0-9_\-:]+/
                        };
                        break;
                    }
                }
            }
        }

        return matchedPair;
    }

    // ── XML Language Configuration & Monarch Tokenizer Definition ─────────────
    const XML_LANGUAGE_CONF = {
        comments: {
            blockComment: ['<!--', '-->']
        },
        brackets: [
            ['<', '>']
        ],
        autoClosingPairs: [
            { open: '<', close: '>' },
            { open: "'", close: "'" },
            { open: '"', close: '"' }
        ],
        surroundingPairs: [
            { open: '<', close: '>' },
            { open: "'", close: "'" },
            { open: '"', close: '"' }
        ],
        folding: {
            markers: {
                start: new RegExp('^\\s*<!--\\s*#region\\b.*-->'),
                end: new RegExp('^\\s*<!--\\s*#endregion\\b.*-->')
            }
        }
    };

    const XML_LANGUAGE_DEF = {
        defaultToken: '',
        tokenPostfix: '.xml',
        ignoreCase: true,
        qualifiedName: /(?:[\w\.\-]+:)?[\w\.\-]+/,
        tokenizer: {
            root: [
                [/[^<&]+/, ''],
                { include: '@whitespace' },
                [/(<)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'tag', next: '@tag' }]],
                [/(<\/)(@qualifiedName)(\s*)(>)/, [{ token: 'delimiter' }, { token: 'tag' }, '', { token: 'delimiter' }]],
                [/(<\?)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'metatag', next: '@tag' }]],
                [/(<\!)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'metatag', next: '@tag' }]],
                [/<\!\[CDATA\[/, { token: 'delimiter.cdata', next: '@cdata' }],
                [/&\w+;/, 'string.escape']
            ],
            cdata: [
                [/[^\]]+/, ''],
                [/\]\]>/, { token: 'delimiter.cdata', next: '@pop' }],
                [/\]/, '']
            ],
            tag: [
                [/[ \t\r\n]+/, ''],
                [/(@qualifiedName)(\s*=\s*)("[^"]*"|'[^']*')/, ['attribute.name', '', 'attribute.value']],
                [/(@qualifiedName)(\s*=\s*)("[^">?\/]*|'[^'>?\/]*)(?=[\?\/]\>)/, ['attribute.name', '', 'attribute.value']],
                [/(@qualifiedName)(\s*=\s*)("[^">]*|'[^'>]*)/, ['attribute.name', '', 'attribute.value']],
                [/@qualifiedName/, 'attribute.name'],
                [/\?>/, { token: 'delimiter', next: '@pop' }],
                [/(\/)(>)/, [{ token: 'tag' }, { token: 'delimiter', next: '@pop' }]],
                [/>/, { token: 'delimiter', next: '@pop' }]
            ],
            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/<!--/, { token: 'comment', next: '@comment' }]
            ],
            comment: [
                [/[^<\-]+/, 'comment.content'],
                [/-->/, { token: 'comment', next: '@pop' }],
                [/<!--/, 'comment.content.invalid'],
                [/[<\-]/, 'comment.content']
            ]
        }
    };

    // ── Register Monaco Language Providers for XML ───────────────────────────
    function registerXmlLanguageProviders() {
        if (_providersRegistered || typeof monaco === 'undefined' || !monaco.languages) return;
        _providersRegistered = true;

        // Register XML Language if not already registered
        if (!monaco.languages.getLanguages().some(l => l.id === 'xml')) {
            monaco.languages.register({
                id: 'xml',
                extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg'],
                aliases: ['XML', 'xml'],
                mimetypes: ['text/xml', 'application/xml']
            });
        }

        monaco.languages.setLanguageConfiguration('xml', XML_LANGUAGE_CONF);
        monaco.languages.setMonarchTokensProvider('xml', XML_LANGUAGE_DEF);

        // Feature: Tag-based Folding Range Provider for XML
        monaco.languages.registerFoldingRangeProvider('xml', {
            provideFoldingRanges: function(model) {
                const ranges = [];
                const lineCount = model.getLineCount();
                const stack = [];
                const tagRegex = /<(\/)?([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?(\/)?>/g;

                for (let i = 1; i <= lineCount; i++) {
                    const line = model.getLineContent(i);
                    if (line.trim().startsWith('<!--') && line.includes('-->')) continue;

                    let match;
                    tagRegex.lastIndex = 0;
                    while ((match = tagRegex.exec(line)) !== null) {
                        const isClosing = Boolean(match[1]);
                        const tagName = match[2];
                        const isSelfClosing = Boolean(match[3]) || match[0].endsWith('/>');

                        if (isSelfClosing || tagName.startsWith('?') || tagName.startsWith('!')) continue;

                        if (!isClosing) {
                            stack.push({ line: i, tagName: tagName });
                        } else {
                            for (let s = stack.length - 1; s >= 0; s--) {
                                if (stack[s].tagName === tagName) {
                                    const startLine = stack[s].line;
                                    if (i > startLine) {
                                        ranges.push({
                                            start: startLine,
                                            end: i,
                                            kind: monaco.languages.FoldingRangeKind.Region
                                        });
                                    }
                                    stack.splice(s, 1);
                                    break;
                                }
                            }
                        }
                    }
                }
                return ranges;
            }
        });

        // 1. Feature 4: Document Formatting Provider (Shift + Alt + F & Beautify)
        monaco.languages.registerDocumentFormattingEditProvider('xml', {
            provideDocumentFormattingEdits(model, options) {
                const text = model.getValue();
                const tabSize = options.tabSize || 2;
                const formatted = beautifyXmlString(text, tabSize);
                return [{
                    range: model.getFullModelRange(),
                    text: formatted
                }];
            }
        });

        // 2. Feature 2: Linked Editing Range Provider (Auto-Rename Tag)
        if (typeof monaco.languages.registerLinkedEditingRangeProvider === 'function') {
            monaco.languages.registerLinkedEditingRangeProvider('xml', {
                provideLinkedEditingRanges(model, position) {
                    try {
                        return findMatchingTagRanges(model, position);
                    } catch (e) {
                        return null;
                    }
                }
            });
        }

        // 3. Feature 5: Schema IntelliSense (Completion Provider)
        monaco.languages.registerCompletionItemProvider('xml', {
            triggerCharacters: ['<', ' ', ':', '"', '/', '='],
            provideCompletionItems(model, position) {
                const textUntilPosition = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });

                const suggestions = [];

                // 3a. Attribute Value suggestions: inside attr="|"
                const attrValMatch = textUntilPosition.match(/([a-zA-Z0-9_\-:]+)=["']([^"']*)$/);
                if (attrValMatch) {
                    const attrName = attrValMatch[1];
                    const possibleVals = BRAVO_ATTR_VALUES[attrName];
                    if (possibleVals && possibleVals.length > 0) {
                        possibleVals.forEach(val => {
                            suggestions.push({
                                label: val,
                                kind: monaco.languages.CompletionItemKind.EnumMember,
                                insertText: val,
                                detail: `Giá trị cho ${attrName}`,
                                documentation: `Gợi ý giá trị chuẩn của thuộc tính ${attrName} trong Bravo XML`
                            });
                        });
                        return { suggestions };
                    }
                }

                // 3b. Attribute suggestions: inside `<Tag attr1="val" |`
                const insideTagMatch = textUntilPosition.match(/<([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?$/);
                if (insideTagMatch && !textUntilPosition.endsWith('<')) {
                    const currentTagText = insideTagMatch[0];
                    const existingAttrs = new Set();
                    const attrMatches = currentTagText.matchAll(/([a-zA-Z0-9_\-:]+)=/g);
                    for (const m of attrMatches) existingAttrs.add(m[1]);

                    BRAVO_XML_ATTRIBUTES.forEach(attr => {
                        if (!existingAttrs.has(attr.name)) {
                            suggestions.push({
                                label: attr.name,
                                kind: monaco.languages.CompletionItemKind.Property,
                                insertText: `${attr.name}="$1"`,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                detail: `Thuộc tính Bravo: ${attr.name}`,
                                documentation: attr.doc
                            });
                        }
                    });

                    const fullText = model.getValue();
                    const docAttrs = fullText.matchAll(/\s+([a-zA-Z0-9_\-:]+)=/g);
                    for (const da of docAttrs) {
                        const name = da[1];
                        if (!existingAttrs.has(name) && !BRAVO_XML_ATTRIBUTES.some(a => a.name === name)) {
                            suggestions.push({
                                label: name,
                                kind: monaco.languages.CompletionItemKind.Property,
                                insertText: `${name}="$1"`,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                detail: `Thuộc tính từ tài liệu: ${name}`
                            });
                        }
                    }

                    return { suggestions };
                }

                // 3c. Tag suggestions: when typing `<` or inside `<...`
                if (textUntilPosition.match(/<([a-zA-Z0-9_\-:]*)$/)) {
                    BRAVO_XML_TAGS.forEach(t => {
                        suggestions.push({
                            label: t.name,
                            kind: monaco.languages.CompletionItemKind.Class,
                            insertText: t.snippet,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                            detail: `Thẻ Bravo Layout: <${t.name}>`,
                            documentation: t.doc,
                            filterText: t.name
                        });
                    });

                    const fullText = model.getValue();
                    const docTags = fullText.matchAll(/<([a-zA-Z0-9_\-:]+)(?:\s+|>)/g);
                    const knownSet = new Set(BRAVO_XML_TAGS.map(t => t.name));
                    for (const dt of docTags) {
                        const tagName = dt[1];
                        if (!knownSet.has(tagName) && !tagName.startsWith('!') && !tagName.startsWith('?')) {
                            knownSet.add(tagName);
                            suggestions.push({
                                label: tagName,
                                kind: monaco.languages.CompletionItemKind.Class,
                                insertText: `${tagName}>$0</${tagName}>`,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                detail: `Thẻ từ tài liệu: <${tagName}>`
                            });
                        }
                    }

                    return { suggestions };
                }

                return { suggestions };
            }
        });
    }

    // ── Validation / Linting Runner ───────────────────────────────────────────
    function validateXmlModel(model) {
        if (!model || model.isDisposed()) return;
        const text = model.getValue();
        if (!text || !text.trim()) {
            monaco.editor.setModelMarkers(model, 'xml-validator', []);
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'application/xml');
            const parseError = xmlDoc.querySelector('parsererror');

            if (!parseError) {
                monaco.editor.setModelMarkers(model, 'xml-validator', []);
                return;
            }

            const errorText = parseError.textContent || '';
            let errLine = 1;
            let errCol = 1;

            const lineMatch = errorText.match(/line\s+(\d+)/i) || errorText.match(/dòng\s+(\d+)/i);
            if (lineMatch) errLine = parseInt(lineMatch[1], 10);

            const colMatch = errorText.match(/column\s+(\d+)/i) || errorText.match(/cột\s+(\d+)/i);
            if (colMatch) errCol = parseInt(colMatch[1], 10);

            let cleanMsg = 'Lỗi cú pháp XML';
            const detailMatch = errorText.match(/error on line \d+ at column \d+:\s*(.*)/i) ||
                                errorText.match(/error:\s*(.*)/i);
            if (detailMatch && detailMatch[1]) {
                cleanMsg = detailMatch[1].split('\n')[0].trim();
            } else {
                const parts = errorText.split('\n').map(s => s.trim()).filter(Boolean);
                if (parts.length > 0) cleanMsg = parts[0];
            }

            const totalLines = model.getLineCount();
            const safeLine = Math.min(Math.max(1, errLine), totalLines);
            const lineMaxCol = model.getLineMaxColumn(safeLine);
            const safeCol = Math.min(Math.max(1, errCol), lineMaxCol);

            const markers = [{
                severity: monaco.MarkerSeverity.Error,
                startLineNumber: safeLine,
                startColumn: Math.max(1, safeCol - 1),
                endLineNumber: safeLine,
                endColumn: Math.min(lineMaxCol, safeCol + 6),
                message: `[XML Linter] ${cleanMsg}`,
                source: 'Bravo XML Validation'
            }];

            monaco.editor.setModelMarkers(model, 'xml-validator', markers);
        } catch (e) {
            console.warn('[BravoXmlMonaco] Validation error:', e);
        }
    }

    // ── Auto-Close Tag Handler (Feature 3) ────────────────────────────────────
    function setupAutoCloseTag(editor) {
        if (!editor) return;

        editor.onKeyDown(function (e) {
            if (e.browserEvent.key === '>') {
                setTimeout(() => {
                    const model = editor.getModel();
                    if (!model) return;
                    const pos = editor.getPosition();
                    if (!pos) return;

                    const lineContent = model.getLineContent(pos.lineNumber);
                    const beforeCursor = lineContent.substring(0, pos.column - 1);

                    const match = beforeCursor.match(/<([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?>$/);
                    if (!match) return;

                    const tagName = match[1];
                    const fullTag = match[0];

                    if (fullTag.endsWith('/>') || fullTag.startsWith('<!--') || fullTag.startsWith('<?') || fullTag.startsWith('</')) {
                        return;
                    }

                    const afterCursor = lineContent.substring(pos.column - 1);
                    if (afterCursor.startsWith(`</${tagName}>`)) return;

                    const closingTag = `</${tagName}>`;
                    editor.executeEdits('auto-close-tag', [{
                        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                        text: closingTag
                    }]);

                    editor.setPosition(pos);
                }, 10);
            }
        });
    }

    // ── BravoXmlMonaco Class Definition ───────────────────────────────────────
    class BravoXmlMonaco {
        constructor(containerEl, options = {}) {
            this.container = containerEl;
            this.options = Object.assign({
                readOnly: false,
                fontSize: 13,
                tabSize: 2,
                onChange: null
            }, options);

            this.editor = null;
            this.model = null;
            this._decorations = [];
            this._validationTimeout = null;
            this._disposables = [];

            this._init();
        }

        _init() {
            if (typeof monaco === 'undefined' || !monaco.editor) {
                console.error('[BravoXmlMonaco] Monaco editor not loaded yet.');
                return;
            }

            registerXmlLanguageProviders();

            // Ensure custom IDE themes are defined in Monaco
            if (window.MonacoInit && typeof window.MonacoInit.defineThemes === 'function') {
                window.MonacoInit.defineThemes();
            }

            const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
            const themeName = window.MonacoInit
                ? window.MonacoInit.getMonacoTheme(currentTheme)
                : (['light', 'win-nt', 'win-xp'].includes(currentTheme) || currentTheme.toLowerCase().includes('light') ? 'ide-light' : 'ide-dark');

            this.model = monaco.editor.createModel('', 'xml');

            this.editor = monaco.editor.create(this.container, {
                model: this.model,
                theme: themeName,
                fontSize: this.options.fontSize || 13,
                lineHeight: 20, // Strict integer pixel height to match font metrics exactly (Issue 4)
                letterSpacing: 0, // Strict zero letter-spacing to prevent character offset drift (Issue 4)
                fontLigatures: false, // Monospace width precision
                fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                glyphMargin: true,
                folding: true,
                foldingStrategy: 'auto',
                showFoldingControls: 'always',
                matchBrackets: 'always',
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                autoIndent: 'full',
                tabSize: this.options.tabSize || 2,
                insertSpaces: true,
                renderWhitespace: 'none', // High performance: don't render whitespace glyphs during scroll (Issue 1)
                renderControlCharacters: false,
                renderLineHighlight: 'line', // Single line highlight avoids expensive box repaints
                scrollBeyondLastLine: false,
                automaticLayout: true,
                readOnly: this.options.readOnly,
                // High-performance scrolling in WebView2 (Fix for Issue 1)
                smoothScrolling: false, // Direct hardware scrolling, eliminating mousewheel input delay
                mouseWheelScrollSensitivity: 1.2,
                fastScrollSensitivity: 5,
                stopRenderingLineAfter: 1000,
                scrollbar: {
                    useShadows: false, // Disables box-shadow layers during scroll
                    vertical: 'visible',
                    horizontal: 'auto',
                    verticalScrollbarSize: 10,
                    horizontalScrollbarSize: 10,
                    arrowSize: 0,
                    alwaysConsumeMouseWheel: false
                },
                minimap: {
                    enabled: true,
                    scale: 1,
                    renderCharacters: false, // Greatly reduces canvas draw calls per scroll frame
                    maxColumn: 80,
                    showSlider: 'mouseover'
                },
                suggest: {
                    showWords: true,
                    snippetsPreventQuickSuggestions: false
                },
                fixedOverflowWidgets: true
            });

            // Debounced change and validation listeners (Issue 1 & 4)
            let changeDebounceTimer = null;
            const contentChangeDisposable = this.model.onDidChangeContent(() => {
                clearTimeout(this._validationTimeout);
                this._validationTimeout = setTimeout(() => {
                    validateXmlModel(this.model);
                }, 400);

                if (typeof this.options.onChange === 'function') {
                    clearTimeout(changeDebounceTimer);
                    changeDebounceTimer = setTimeout(() => {
                        this.options.onChange(this.model.getValue());
                    }, 250);
                }
            });
            this._disposables.push(contentChangeDisposable);

            setupAutoCloseTag(this.editor);
            if (typeof window.attachMonacoClipboardHook === 'function') {
                window.attachMonacoClipboardHook(this.editor);
            }
            this._wireThemeSync();
            this._initFontMetricsAlignment();
        }

        _initFontMetricsAlignment() {
            // Remeasure fonts immediately
            if (typeof monaco !== 'undefined' && monaco.editor?.remeasureFonts) {
                monaco.editor.remeasureFonts();
            }

            // Remeasure as soon as web fonts (JetBrains Mono) are completely loaded
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => {
                    try {
                        if (typeof monaco !== 'undefined' && monaco.editor?.remeasureFonts) {
                            monaco.editor.remeasureFonts();
                        }
                        if (this.editor) {
                            this.editor.layout();
                        }
                    } catch (_) {}
                });
            }

            // Staggered remeasurement for WebView2 font decoding stages
            setTimeout(() => {
                try {
                    if (typeof monaco !== 'undefined' && monaco.editor?.remeasureFonts) {
                        monaco.editor.remeasureFonts();
                    }
                    if (this.editor) this.editor.layout();
                } catch (_) {}
            }, 200);

            setTimeout(() => {
                try {
                    if (typeof monaco !== 'undefined' && monaco.editor?.remeasureFonts) {
                        monaco.editor.remeasureFonts();
                    }
                    if (this.editor) this.editor.layout();
                } catch (_) {}
            }, 800);
        }

        setTheme(themeName) {
            if (typeof monaco === 'undefined' || !monaco.editor) return;
            const target = themeName || document.documentElement.getAttribute('data-bs-theme') || 'dark';
            if (window.MonacoInit && typeof window.MonacoInit.defineThemes === 'function') {
                window.MonacoInit.defineThemes();
            }
            const monacoTheme = window.MonacoInit
                ? window.MonacoInit.getMonacoTheme(target)
                : (['light', 'win-nt', 'win-xp'].includes(target) ? 'ide-light' : 'ide-dark');
            monaco.editor.setTheme(monacoTheme);
        }

        _wireThemeSync() {
            const updateTheme = (newTheme) => {
                this.setTheme(newTheme);
            };

            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.attributeName === 'data-bs-theme') {
                        updateTheme(document.documentElement.getAttribute('data-bs-theme'));
                    }
                }
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
            this._disposables.push({ dispose: () => observer.disconnect() });

            const handleThemeChanged = (e) => {
                updateTheme(e.detail?.theme);
            };
            document.addEventListener('ide-theme-changed', handleThemeChanged);
            this._disposables.push({ dispose: () => document.removeEventListener('ide-theme-changed', handleThemeChanged) });
            window.addEventListener('ide-theme-changed', handleThemeChanged);
            this._disposables.push({ dispose: () => window.removeEventListener('ide-theme-changed', handleThemeChanged) });
        }

        getValue() {
            return this.model ? this.model.getValue() : '';
        }

        setValue(xml) {
            if (!this.model) return;
            const cleanXml = xml || '';
            if (this.model.getValue() !== cleanXml) {
                this.model.setValue(cleanXml);
            }
            validateXmlModel(this.model);
        }

        formatDocument() {
            if (!this.editor) return;
            const action = this.editor.getAction('editor.action.formatDocument');
            if (action) {
                action.run();
            } else {
                const text = this.getValue();
                const beautified = beautifyXmlString(text, this.options.tabSize);
                this.setValue(beautified);
            }
        }

        foldAll() {
            if (!this.editor) return;
            const action = this.editor.getAction('editor.foldAll');
            if (action) action.run();
        }

        unfoldAll() {
            if (!this.editor) return;
            const action = this.editor.getAction('editor.unfoldAll');
            if (action) action.run();
        }

        revealLine(lineNumber) {
            if (!this.editor || !this.model) return;
            const safeLine = Math.min(Math.max(1, lineNumber), this.model.getLineCount());
            this.editor.revealLineInCenter(safeLine);
            this.editor.setPosition({ lineNumber: safeLine, column: 1 });
            this.editor.focus();
        }

        highlightMatches(query) {
            if (!this.editor || !this.model || !query) {
                this.clearHighlight();
                return [];
            }

            const matches = this.model.findMatches(query, false, false, false, null, true);
            const newDecorations = matches.map(m => ({
                range: m.range,
                options: {
                    isWholeLine: false,
                    className: 'bravo-monaco-search-highlight',
                    overviewRuler: {
                        color: '#ffc107',
                        position: monaco.editor.OverviewRulerLane.Full
                    },
                    minimap: {
                        color: '#ffc107',
                        position: monaco.editor.MinimapPosition.Inline
                    }
                }
            }));

            this._decorations = this.editor.deltaDecorations(this._decorations, newDecorations);
            return matches.map(m => ({
                line: m.range.startLineNumber - 1,
                column: m.range.startColumn,
                range: m.range
            }));
        }

        clearHighlight() {
            if (this.editor && this._decorations.length > 0) {
                this._decorations = this.editor.deltaDecorations(this._decorations, []);
            }
        }

        layout() {
            if (this.editor) {
                this.editor.layout();
            }
        }

        focus() {
            if (this.editor) {
                this.editor.focus();
            }
        }

        dispose() {
            clearTimeout(this._validationTimeout);
            this._disposables.forEach(d => {
                if (d && typeof d.dispose === 'function') d.dispose();
            });
            this._disposables = [];
            if (this.editor) {
                this.editor.dispose();
                this.editor = null;
            }
            if (this.model) {
                this.model.dispose();
                this.model = null;
            }
        }
    }

    function createBravoXmlEditor(containerEl, options = {}) {
        return new Promise((resolve, reject) => {
            function instantiate() {
                try {
                    if (window.MonacoInit && typeof window.MonacoInit.defineThemes === 'function') {
                        window.MonacoInit.defineThemes();
                    }
                    const instance = new BravoXmlMonaco(containerEl, options);
                    resolve(instance);
                } catch (err) {
                    reject(err);
                }
            }

            if (typeof window._onMonacoReady === 'function') {
                window._onMonacoReady(instantiate);
            } else if (typeof monaco !== 'undefined' && monaco.editor) {
                instantiate();
            } else if (typeof window.require !== 'undefined') {
                window.require(['vs/editor/editor.main'], instantiate);
            } else {
                reject(new Error('Monaco AMD loader (require) is not available'));
            }
        });
    }

    window.BravoXmlMonaco = BravoXmlMonaco;
    window.createBravoXmlEditor = createBravoXmlEditor;
    window.beautifyXmlString = beautifyXmlString;

})(window);
