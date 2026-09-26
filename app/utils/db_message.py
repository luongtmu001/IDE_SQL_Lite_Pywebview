import re

def clean_db_message(raw_msg):
    if not raw_msg:
        return ""
    if isinstance(raw_msg, (list, tuple)) and len(raw_msg) > 1:
        text = str(raw_msg[1])
    else:
        text = str(raw_msg)

    # If it is a stringified python tuple like ('42000', "[42000] ...")
    m = re.match(r"^\s*\(\s*(?:'[^']*'|\"[^\"]*\")\s*,\s*(['\"])([\s\S]*)\1\s*\)\s*$", text)
    if m:
        text = m.group(2)
        try:
            # Handle unicode escape sequences like \r\n or \' inside string repr
            text = text.encode('utf-8').decode('unicode_escape')
        except Exception:
            pass

    # Normalize line breaks
    text = text.replace('\r\n', '\n').replace('\r', '\n')

    # Strip ODBC / Driver prefixes
    text = re.sub(r'\[Microsoft\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[ODBC[^\]]*\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[SQL Server[^\]]*\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[PostgreSQL[^\]]*\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[[A-Z0-9]{5}\]', '', text)  # [42000], [01000], [HY000], etc.

    # Remove driver error prefixes like "psycopg2.errors.SyntaxError: "
    text = re.sub(r'^[a-zA-Z0-9_\.]+(?:Error|Exception):\s*', '', text)

    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        l = line.strip()
        # Remove trailing ODBC execution tags like (102) (SQLExecDirectW)
        l = re.sub(r'\s*\(\d+\)\s*\([A-Za-z0-9_]+\)\s*$', '', l)
        l = re.sub(r'\s*\([A-Za-z0-9_]+\)\s*$', '', l)
        # Remove leading colons or hyphens left by stripped prefixes
        l = re.sub(r'^\s*[:\-\s]+', '', l)
        l = l.strip()
        if l:
            cleaned_lines.append(l)

    return '\n'.join(cleaned_lines)


def parse_error_details(sql_text, error_message, batch_start_line=1):
    """
    Extracts line number, column, token, and cleaned message for active editor jumping.
    """
    cleaned = clean_db_message(error_message)
    line_num = None
    col_num = 1
    token = None

    # 1. Check explicit line numbers:
    # "Msg 102, Level 15, State 1, Line 3"
    # "LINE 2: SELECT * FRM users"
    # "at line 15"
    m_line = re.search(r'\b(?:line|dòng)\s*[:#]?\s*(\d+)', cleaned, re.IGNORECASE)
    if m_line:
        try:
            rel_line = int(m_line.group(1))
            line_num = batch_start_line + rel_line - 1
        except Exception:
            pass

    # 2. Extract error token from quotation marks
    m_token = re.search(
        r"(?:near|tại|object name|column name|relation|table|cột|bảng|syntax error at or near)\s+['\"`\[]([^'\"`\]]+)['\"`\]]",
        cleaned,
        re.IGNORECASE
    )
    if m_token:
        token = m_token.group(1)

    # 3. Locate token in SQL text
    if sql_text:
        sql_lines = sql_text.split('\n')
        if token:
            if line_num is not None and 1 <= line_num <= len(sql_lines):
                idx = sql_lines[line_num - 1].find(token)
                if idx != -1:
                    col_num = idx + 1
            else:
                for i, l in enumerate(sql_lines, 1):
                    idx = l.find(token)
                    if idx != -1:
                        line_num = batch_start_line + i - 1
                        col_num = idx + 1
                        break

    return {
        "line": line_num,
        "col": col_num,
        "token": token,
        "clean_message": cleaned
    }
