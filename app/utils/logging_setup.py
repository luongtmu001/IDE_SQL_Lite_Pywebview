# -*- coding: utf-8 -*-
"""
Centralized Logging Infrastructure for luoBTool IDE.
Provides:
- RotatingFileHandler with auto-rotation (default 5 files x 2MB).
- SensitiveDataFilter to redact passwords, tokens, and database connection secrets.
- Uncaught exception hooks for sys.excepthook and threading.excepthook.
- Directory resolution and open_log_folder helper.
"""

import os
import re
import sys
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import subprocess
import threading
from typing import Optional, Dict, Any

# Regular expressions for masking sensitive credentials in log messages
_SENSITIVE_PATTERNS = [
    # 1. Standard DB connection URLs with user:pass@host (handles passwords with @ inside)
    (
        re.compile(r'(?i)([a-z0-9+.-]+://[^:/\s]+:)(.+?)(@[a-zA-Z0-9_.-]+(?::\d+)?(?:/|\?|\s|$))'),
        r'\1***REDACTED***\3'
    ),
    # 2. ADO.NET / ODBC / OLEDB connection strings: Password=...; or Pwd=...;
    (
        re.compile(r'(?i)\b(Password|Pwd)\s*=\s*([^;]+)'),
        r'\1=***REDACTED***'
    ),
    # 3. JSON-like keys: "password": "...", "pwd": "...", "secret": "..."
    (
        re.compile(r'(?i)("(?:password|pwd|secret|token|accessToken|refreshToken|api_key)")\s*:\s*"([^"]+)"'),
        r'\1: "***REDACTED***"'
    ),
    # 4. Key-value pairs: password=..., pwd=..., token=..., secret=...
    (
        re.compile(r'(?i)\b(password|pwd|secret|auth_token|access_token|api_key)\s*([=:]\s*["\']?)([^"\'\s;&,\\]+)(["\']?)'),
        r'\1\2***REDACTED***\4'
    ),
]


class SensitiveDataFilter(logging.Filter):
    """
    Logging filter that sanitizes passwords, connection strings, and tokens
    from log records before writing to disk or console.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.mask_sensitive(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: (self.mask_sensitive(v) if isinstance(v, str) else v) for k, v in record.args.items()}
            elif isinstance(record.args, tuple):
                record.args = tuple((self.mask_sensitive(v) if isinstance(v, str) else v) for v in record.args)
            elif isinstance(record.args, list):
                record.args = [self.mask_sensitive(v) if isinstance(v, str) else v for v in record.args]
        return True

    @classmethod
    def mask_sensitive(cls, text: str) -> str:
        if not text or not isinstance(text, str):
            return text
        masked = text
        for pattern, replacement in _SENSITIVE_PATTERNS:
            masked = pattern.sub(replacement, masked)
        return masked


_LOG_SETUP_DONE = False
_ACTIVE_FILE_HANDLER: Optional[RotatingFileHandler] = None
_CURRENT_LOG_DIR: Optional[Path] = None
_DEFAULT_LOG_FILENAME = "app.log"


def get_default_log_dir() -> Path:
    """
    Resolves the log directory.
    Uses <APP_ROOT>/data/logs by default.
    """
    global _CURRENT_LOG_DIR
    if _CURRENT_LOG_DIR is not None:
        return _CURRENT_LOG_DIR

    # Try resolving via current file path (IDE-SQL-Lite_New_Pyweb_Claude/app/utils/..)
    base_dir = Path(__file__).resolve().parent.parent.parent
    data_dir = base_dir / "data"
    log_dir = data_dir / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Fallback to local logs directory if data is not writable
        log_dir = base_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)

    _CURRENT_LOG_DIR = log_dir
    return log_dir


def set_custom_log_dir(custom_dir: Path) -> Path:
    """Sets a custom directory for logging."""
    global _CURRENT_LOG_DIR
    p = Path(custom_dir).resolve()
    p.mkdir(parents=True, exist_ok=True)
    _CURRENT_LOG_DIR = p
    return p


def get_log_file_path() -> Path:
    """Returns the primary log file path."""
    return get_default_log_dir() / _DEFAULT_LOG_FILENAME


def close_logging() -> None:
    """Closes and unregisters the active file handler cleanly."""
    global _ACTIVE_FILE_HANDLER
    if _ACTIVE_FILE_HANDLER:
        root_logger = logging.getLogger()
        if _ACTIVE_FILE_HANDLER in root_logger.handlers:
            root_logger.removeHandler(_ACTIVE_FILE_HANDLER)
        try:
            _ACTIVE_FILE_HANDLER.close()
        except Exception:
            pass
        _ACTIVE_FILE_HANDLER = None


def setup_logging(
    log_dir: Optional[Path] = None,
    level_name: str = "INFO",
    max_bytes: int = 2 * 1024 * 1024,
    backup_count: int = 5,
    enable_console: bool = True
) -> logging.Logger:
    """
    Initializes root logger with RotatingFileHandler and SensitiveDataFilter.
    Sets up uncaught exception handlers.
    """
    global _LOG_SETUP_DONE, _ACTIVE_FILE_HANDLER

    target_log_dir = log_dir if log_dir else get_default_log_dir()
    set_custom_log_dir(target_log_dir)

    log_level = getattr(logging, level_name.upper(), logging.INFO)
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    log_format = "%(asctime)s [%(levelname)s] [%(name)s] [%(threadName)s] %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(log_format, datefmt=date_format)
    sensitive_filter = SensitiveDataFilter()

    # Clean up any existing handler from previous calls
    close_logging()

    # Configure rotating file handler
    log_file = target_log_dir / _DEFAULT_LOG_FILENAME
    file_handler = RotatingFileHandler(
        str(log_file),
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
        delay=True
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)
    file_handler.addFilter(sensitive_filter)
    root_logger.addHandler(file_handler)
    _ACTIVE_FILE_HANDLER = file_handler

    # Configure console handler if requested and not already present
    if enable_console:
        has_console = any(isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler) for h in root_logger.handlers)
        if not has_console:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(log_level)
            console_handler.setFormatter(formatter)
            console_handler.addFilter(sensitive_filter)
            root_logger.addHandler(console_handler)

    # Attach uncaught exception hooks once
    if not _LOG_SETUP_DONE:
        _install_exception_hooks()
        _LOG_SETUP_DONE = True

    app_logger = logging.getLogger("luobtool")
    app_logger.info("Logging initialized. Directory: %s, Level: %s", target_log_dir, level_name)
    return app_logger


def _install_exception_hooks():
    """Installs sys.excepthook and threading.excepthook for unhandled errors."""
    logger = logging.getLogger("luobtool.crash")

    def handle_sys_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return
        logger.critical(
            "Uncaught exception in main thread: %s",
            exc_value,
            exc_info=(exc_type, exc_value, exc_traceback)
        )

    sys.excepthook = handle_sys_exception

    if hasattr(threading, "excepthook"):
        def handle_thread_exception(args):
            if issubclass(args.exc_type, KeyboardInterrupt):
                return
            thread_name = args.thread.name if args.thread else "unknown"
            logger.critical(
                "Uncaught exception in background thread [%s]: %s",
                thread_name,
                args.exc_value,
                exc_info=(args.exc_type, args.exc_value, args.exc_traceback)
            )

        threading.excepthook = handle_thread_exception


def open_log_folder() -> Dict[str, Any]:
    """
    Opens the log directory in Windows Explorer (or default OS file browser).
    Returns a result dict { "success": bool, "path": str, "error"?: str }.
    """
    log_dir = get_default_log_dir()
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        path_str = str(log_dir.resolve())
        if sys.platform == "win32":
            os.startfile(path_str)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path_str])
        else:
            subprocess.Popen(["xdg-open", path_str])
        return {"success": True, "path": path_str}
    except Exception as exc:
        logging.getLogger("luobtool").error("Failed to open log folder: %s", exc)
        return {"success": False, "error": str(exc), "path": str(log_dir)}


def get_log_info() -> Dict[str, Any]:
    """
    Returns diagnostic information about the current logging setup.
    """
    log_dir = get_default_log_dir()
    log_file = get_log_file_path()
    file_size_bytes = log_file.stat().st_size if log_file.exists() else 0
    
    root_logger = logging.getLogger()
    level_name = logging.getLevelName(root_logger.getEffectiveLevel())

    log_files = []
    if log_dir.exists():
        for f in sorted(log_dir.glob("app.log*")):
            try:
                log_files.append({
                    "name": f.name,
                    "size_bytes": f.stat().st_size,
                    "modified": f.stat().st_mtime
                })
            except Exception:
                pass

    return {
        "log_dir": str(log_dir),
        "log_file": str(log_file),
        "file_exists": log_file.exists(),
        "file_size_bytes": file_size_bytes,
        "current_level": level_name,
        "files": log_files
    }


def update_log_level(level_name: str) -> bool:
    """Updates the active log level dynamically."""
    level = getattr(logging, level_name.upper(), None)
    if level is None:
        return False
    logging.getLogger().setLevel(level)
    if _ACTIVE_FILE_HANDLER:
        _ACTIVE_FILE_HANDLER.setLevel(level)
    logging.getLogger("luobtool").info("Log level updated to %s", level_name)
    return True
