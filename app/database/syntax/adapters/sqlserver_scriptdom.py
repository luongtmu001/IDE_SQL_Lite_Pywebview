# -*- coding: utf-8 -*-
"""
Microsoft ScriptDOM Adapter for SQL Server (T-SQL).
Provides high-performance, side-effect-free in-memory static syntax validation
using official Microsoft.SqlServer.TransactSql.ScriptDom via pythonnet.

Complies with Section 4.1 & 6.2 of .SKILL/SQL_Syntax_Check_Parser_Extension.md.
"""
from __future__ import annotations

import logging
import os
import re
import sys
from typing import Any

from app.database.syntax.adapters.base import BaseSyntaxAdapter
from app.database.syntax.adapters.diagnostics_mapper import normalize_diagnostic

logger = logging.getLogger(__name__)

# Fallback system paths for Microsoft.SqlServer.TransactSql.ScriptDom.dll
_KNOWN_SCRIPTDOM_PATHS = [
    r"C:\Program Files\Microsoft SQL Server Management Studio 22\Release\Common7\IDE\Extensions\Application\Microsoft.SqlServer.TransactSql.ScriptDom.dll",
    r"C:\Program Files\Azure Data Studio\resources\app\extensions\mssql\sqltoolsservice\Windows\4.10.2.1\Microsoft.SqlServer.TransactSql.ScriptDom.dll",
    r"C:\Program Files (x86)\Microsoft SQL Server Management Studio 19\Common7\IDE\Extensions\Application\Microsoft.SqlServer.TransactSql.ScriptDom.dll",
    r"C:\Program Files (x86)\Microsoft SQL Server Management Studio 18\Common7\IDE\Extensions\Application\Microsoft.SqlServer.TransactSql.ScriptDom.dll",
    r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\IDE\Extensions\Microsoft\SQLDB\DAC\150\Microsoft.SqlServer.TransactSql.ScriptDom.dll",
    r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\Extensions\Microsoft\SQLDB\DAC\Microsoft.SqlServer.TransactSql.ScriptDom.dll",
]


class SqlServerScriptDomAdapter(BaseSyntaxAdapter):
    """
    T-SQL Syntax Adapter leveraging Microsoft ScriptDOM via pythonnet.
    Provides full procedural parsing (GO batches, CTEs, TRY/CATCH, procs/functions).
    Falls back smoothly to database-native parse or sqlglot if ScriptDOM is unavailable.
    """

    def __init__(self, custom_dll_path: str | None = None) -> None:
        self._dll_path: str | None = None
        self._parser_class: Any = None
        self._string_reader_class: Any = None
        self._is_initialized: bool = False
        self._init_error: str | None = None

        self._initialize(custom_dll_path)

    def _locate_dll(self, custom_path: str | None = None) -> str | None:
        if custom_path is not None:
            return custom_path if (custom_path and os.path.isfile(custom_path)) else None

        # Priority 1: User-specified path in data/settings.json
        try:
            from app.services.settings_store import load_settings
            settings = load_settings()
            if isinstance(settings, dict):
                syntax_cfg = settings.get("syntax", {})
                if isinstance(syntax_cfg, dict):
                    settings_dll = syntax_cfg.get("scriptDomDllPath") or syntax_cfg.get("scriptdom_dll_path")
                    if settings_dll and os.path.isfile(str(settings_dll).strip()):
                        return str(settings_dll).strip()
        except Exception:
            pass

        # Priority 2: User-specified environment variable
        env_path = os.environ.get("MSSQL_SCRIPTDOM_DLL", "").strip()
        if env_path and os.path.isfile(env_path):
            return env_path

        # Priority 3: Bundled with the application (development & installed)
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        bundled_local = os.path.join(base_dir, "bin", "Microsoft.SqlServer.TransactSql.ScriptDom.dll")
        if os.path.isfile(bundled_local):
            return bundled_local

        # Priority 4: PyInstaller frozen executable bundle paths
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            pyinstaller_candidates = [
                os.path.join(meipass, "app", "database", "syntax", "bin", "Microsoft.SqlServer.TransactSql.ScriptDom.dll"),
                os.path.join(meipass, "Microsoft.SqlServer.TransactSql.ScriptDom.dll"),
            ]
            for candidate in pyinstaller_candidates:
                if os.path.isfile(candidate):
                    return candidate

        # Executable directory (one-folder mode or installed layout)
        if getattr(sys, "frozen", False):
            exe_dir = os.path.dirname(sys.executable)
            exe_candidates = [
                os.path.join(exe_dir, "app", "database", "syntax", "bin", "Microsoft.SqlServer.TransactSql.ScriptDom.dll"),
                os.path.join(exe_dir, "Microsoft.SqlServer.TransactSql.ScriptDom.dll"),
            ]
            for candidate in exe_candidates:
                if os.path.isfile(candidate):
                    return candidate

        # Priority 5: Known installed tool paths on Windows
        for candidate in _KNOWN_SCRIPTDOM_PATHS:
            if candidate and os.path.isfile(candidate):
                return candidate
        return None

    def _initialize(self, custom_path: str | None = None) -> None:
        dll_path = self._locate_dll(custom_path)
        if not dll_path:
            self._init_error = "Microsoft.SqlServer.TransactSql.ScriptDom.dll not found in candidate paths."
            logger.info(f"[ScriptDOM] {self._init_error}")
            return

        try:
            import clr

            clr.AddReference(dll_path)
            from System.IO import StringReader
            from Microsoft.SqlServer.TransactSql.ScriptDom import (
                TSql160Parser,
                TSql150Parser,
                TSql140Parser,
                TSql130Parser,
                TSql120Parser,
                TSql110Parser,
                TSql100Parser,
            )

            self._string_reader_class = StringReader
            self._parsers: dict[str, Any] = {
                "160": TSql160Parser,  # SQL Server 2022
                "150": TSql150Parser,  # SQL Server 2019
                "140": TSql140Parser,  # SQL Server 2017
                "130": TSql130Parser,  # SQL Server 2016
                "120": TSql120Parser,  # SQL Server 2014
                "110": TSql110Parser,  # SQL Server 2012
                "100": TSql100Parser,  # SQL Server 2008
            }
            # Default fallback parser
            self._parser_class = TSql160Parser
            self._dll_path = dll_path
            self._is_initialized = True
            logger.info(f"[ScriptDOM] Successfully loaded assembly from {dll_path}")
        except Exception as exc:
            self._init_error = f"Failed to initialize pythonnet with ScriptDOM: {exc}"
            logger.warning(f"[ScriptDOM] {self._init_error}")

    @property
    def is_available(self) -> bool:
        """Returns True if ScriptDOM was loaded and is ready to parse."""
        return self._is_initialized and self._parser_class is not None

    def get_status(self) -> dict[str, Any]:
        """Provides status and diagnostics about ScriptDOM assembly availability."""
        norm_path = self._dll_path.replace("\\", "/") if self._dll_path else ""
        return {
            "is_available": self.is_available,
            "dll_path": self._dll_path,
            "is_bundled": bool("syntax/bin" in norm_path or "app/database/syntax/bin" in norm_path),
            "error": self._init_error,
        }

    def _resolve_parser_class(self, connection_session: Any = None) -> Any:
        if not hasattr(self, "_parsers") or not self._parsers:
            return self._parser_class

        version_str: str | None = None
        if connection_session:
            meta_cache = getattr(connection_session, "metadata_cache", None) or {}
            version_str = meta_cache.get("server_version")

            if not version_str:
                cfg = getattr(connection_session, "config", None) or {}
                version_str = cfg.get("server_version") or cfg.get("version") or cfg.get("compatibility_level")

            if not version_str:
                adapter = getattr(connection_session, "adapter", None)
                conn = getattr(adapter, "connection", None)
                if conn is not None and hasattr(conn, "getinfo"):
                    try:
                        import pyodbc
                        raw_ver = conn.getinfo(pyodbc.SQL_DBMS_VER)
                        if isinstance(raw_ver, bytes):
                            raw_ver = raw_ver.decode("utf-8", errors="ignore")
                        if raw_ver:
                            version_str = str(raw_ver)
                            if isinstance(meta_cache, dict):
                                meta_cache["server_version"] = version_str
                    except Exception:
                        pass

        if version_str:
            v_clean = str(version_str).strip()
            # Match version numbers like 15.00.xxxx -> '150'
            m = re.match(r"^(\d+)\.", v_clean)
            if m:
                major_num = int(m.group(1))
                # Only resolve down to 130+ (SQL 2016+) so modern DDL like DROP TABLE IF EXISTS,
                # STRING_AGG, TRIM are never falsely rejected as syntax errors
                if major_num >= 13:
                    major_key = f"{major_num}0"
                    if major_key in self._parsers:
                        return self._parsers[major_key]

            year_map = {
                "2022": "160",
                "2019": "150",
                "2017": "140",
                "2016": "130",
            }
            for yr, pkey in year_map.items():
                if yr in v_clean and pkey in self._parsers:
                    return self._parsers[pkey]

        return self._parsers.get("160") or self._parser_class

    def _extract_token_from_message(self, message: str, line_text: str | None = None) -> str:
        """Extract faulty token from ScriptDOM error message or line text."""
        # 1. 'near [the keyword] <TOKEN>'
        m = re.search(r"near\s+(?:the\s+keyword\s+)?['\"]?([^'\"\r\n]+)['\"]?", message, re.IGNORECASE)
        if m:
            token = m.group(1).rstrip(".'\"").strip("'\"").strip()
            if token:
                return token

        # 2. 'encountered <TOKEN> instead' (common in ScriptDOM parser error messages)
        m_enc = re.search(r"encountered\s+['\"]?([^'\"\s\r\n\.]+)['\"]?\s+instead", message, re.IGNORECASE)
        if m_enc:
            token = m_enc.group(1).rstrip(".'\"").strip("'\"").strip()
            if token:
                return token

        # 3. Quoted element/token in message, e.g. 'The datatype 'TEXT' is not supported'
        m_quote = re.search(r"['\"]([^'\"]+)['\"]", message)
        if m_quote:
            token = m_quote.group(1).strip()
            if token:
                return token

        if line_text:
            stripped = line_text.strip()
            if stripped:
                return stripped.split()[0] if " " in stripped else stripped

        return ""

    def _collect_quality_and_deprecated_warnings(
        self, fragment: Any, sql: str
    ) -> list[dict[str, Any]]:
        """Collect deprecated syntax and code quality warnings from ScriptDOM token stream."""
        warnings: list[dict[str, Any]] = []
        if not fragment or not hasattr(fragment, "ScriptTokenStream"):
            return warnings

        try:
            tokens = list(fragment.ScriptTokenStream)
        except Exception:
            return warnings

        TABLE_HINTS = {
            "NOLOCK",
            "READUNCOMMITTED",
            "UPDLOCK",
            "REPEATABLEREAD",
            "SERIALIZABLE",
            "READCOMMITTED",
            "TABLOCK",
            "TABLOCKX",
            "PAGLOCK",
            "ROWLOCK",
            "NOWAIT",
            "READPAST",
            "XLOCK",
        }

        for i, t in enumerate(tokens):
            txt = (t.Text or "").upper()
            t_type = t.TokenType.ToString()

            # 1. Deprecated data types (TEXT, NTEXT, IMAGE)
            if txt in ("TEXT", "NTEXT", "IMAGE"):
                prev_idx = i - 1
                while prev_idx >= 0 and tokens[prev_idx].TokenType.ToString() in ("WhiteSpace", "Comment"):
                    prev_idx -= 1
                if prev_idx >= 0:
                    prev_tok = tokens[prev_idx]
                    if prev_tok.TokenType.ToString() in ("Variable", "Identifier"):
                        col = t.Column
                        warnings.append({
                            "severity": "warning",
                            "message": f"Data type '{txt}' is deprecated in modern SQL Server. Consider using VARCHAR(MAX), NVARCHAR(MAX), or VARBINARY(MAX).",
                            "code": "SQL_SYNTAX_WARNING",
                            "line": t.Line,
                            "column": col,
                            "end_column": col + len(t.Text),
                            "token": t.Text,
                            "source": "sqlserver",
                        })

            # 2. Table hint without WITH keyword: (NOLOCK)
            elif txt in TABLE_HINTS:
                prev_idx = i - 1
                while prev_idx >= 0 and tokens[prev_idx].TokenType.ToString() in ("WhiteSpace", "Comment"):
                    prev_idx -= 1
                if prev_idx >= 0 and tokens[prev_idx].TokenType.ToString() == "LeftParenthesis":
                    p2 = prev_idx - 1
                    while p2 >= 0 and tokens[p2].TokenType.ToString() in ("WhiteSpace", "Comment"):
                        p2 -= 1
                    if p2 >= 0 and tokens[p2].TokenType.ToString() != "With":
                        paren_col = tokens[prev_idx].Column
                        raw_token = f"({t.Text})"
                        warnings.append({
                            "severity": "warning",
                            "message": f"Table hint '({t.Text})' without WITH keyword is deprecated. Use 'WITH ({t.Text})' instead.",
                            "code": "SQL_SYNTAX_WARNING",
                            "line": tokens[prev_idx].Line,
                            "column": paren_col,
                            "end_column": paren_col + len(raw_token),
                            "token": raw_token,
                            "source": "sqlserver",
                        })

            # 3. Missing semicolon before WITH (Common Table Expression)
            elif t_type == "With":
                next_idx = i + 1
                while next_idx < len(tokens) and tokens[next_idx].TokenType.ToString() in ("WhiteSpace", "Comment"):
                    next_idx += 1
                if next_idx < len(tokens) and tokens[next_idx].TokenType.ToString() == "Identifier":
                    prev_idx = i - 1
                    while prev_idx >= 0 and tokens[prev_idx].TokenType.ToString() in ("WhiteSpace", "Comment"):
                        prev_idx -= 1
                    if prev_idx >= 0:
                        prev_tok = tokens[prev_idx]
                        prev_type = prev_tok.TokenType.ToString()
                        prev_text = (prev_tok.Text or "").upper()
                        # Block headers and batch separators where semicolon is NOT required
                        is_block_header = (
                            prev_type in ("Semicolon", "Go", "EndOfFile", "Begin", "As")
                            or (prev_type == "Identifier" and prev_text in ("TRY", "CATCH", "TRAN", "TRANSACTION"))
                        )
                        if not is_block_header:
                            warnings.append({
                                "severity": "warning",
                                "message": "The statement preceding a Common Table Expression (WITH) must be terminated with a semicolon ';'.",
                                "code": "SQL_SYNTAX_WARNING",
                                "line": t.Line,
                                "column": t.Column,
                                "end_column": t.Column + len(t.Text),
                                "token": "WITH",
                                "source": "sqlserver",
                            })

        return warnings

    def validate(
        self,
        sql: str,
        connection_session: Any = None,
        database: str | None = None,
        schema: str | None = None,
        is_debug: bool = False,
    ) -> list[dict[str, Any]]:
        """Validate T-SQL syntax using ScriptDOM (or fallback to legacy validator if unavailable)."""
        if not sql or not sql.strip():
            return []

        # If ScriptDOM is available, perform high-speed static parse
        if self.is_available:
            try:
                parser_cls = self._resolve_parser_class(connection_session)
                parser = parser_cls(True)  # initialQuotedIdentifiers = True
                reader = self._string_reader_class(sql)
                fragment, errors = parser.Parse(reader)

                diagnostics: list[dict[str, Any]] = []
                lines = sql.splitlines()

                # 1. Parse errors
                if errors and errors.Count > 0:
                    for err in errors:
                        line = err.Line
                        col = err.Column
                        msg = err.Message
                        offset = getattr(err, "Offset", None)

                        line_text = lines[line - 1] if 0 < line <= len(lines) else ""
                        token = self._extract_token_from_message(msg, line_text)

                        # Calculate end_column
                        end_col = col + max(1, len(token))
                        if line_text and token and token in line_text:
                            m_word = re.search(rf"\b{re.escape(token)}\b", line_text)
                            if m_word:
                                w_start = m_word.start() + 1
                                if abs(w_start - col) <= 2:
                                    col = w_start
                                    end_col = m_word.end() + 1

                        raw_diag = {
                            "severity": "error",
                            "message": msg,
                            "code": "SQL_SYNTAX_ERROR",
                            "line": line,
                            "column": col,
                            "end_column": end_col,
                            "token": token,
                            "offset": offset,
                            "source": "sqlserver",
                        }
                        diagnostics.append(normalize_diagnostic(raw_diag, default_source="sqlserver", sql=sql))

                # 2. Collect quality and deprecation warnings
                raw_warnings = self._collect_quality_and_deprecated_warnings(fragment, sql)
                for w in raw_warnings:
                    diagnostics.append(normalize_diagnostic(w, default_source="sqlserver", sql=sql))

                return diagnostics
            except Exception as exc:
                logger.warning(f"[ScriptDOM] Parse exception, falling back to legacy validator: {exc}")

        # Graceful fallback to legacy validator
        if not self.is_available:
            logger.warning(
                "[ScriptDOM] ScriptDOM assembly is not available (%s). Falling back to legacy database/sqlglot parser.",
                self._init_error or "not initialized",
            )
        from app.database.syntax.validator import validate_sql_server

        diags = validate_sql_server(
            sql=sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
        )
        for d in diags:
            if not d.get("source"):
                d["source"] = "sqlserver-legacy"
        return diags
