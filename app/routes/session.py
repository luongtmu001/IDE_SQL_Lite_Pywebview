# -*- coding: utf-8 -*-
"""
Session Persistence Routes — luoBTool IDE
Exposes HTTP endpoints for session save/restore, delegating to app.services.session_service.
Supports backward-compatible module attributes (SESSION_FILE, SETTINGS_FILE, CONNECTIONS_FILE)
so existing tests and monkeypatching continue to operate seamlessly.
"""
import logging
from pathlib import Path
from typing import Optional, Set
from flask import Blueprint, jsonify, request

from app.services.session_service import (
    CONNECTIONS_FILE as _DEFAULT_CONNECTIONS_FILE,
    DATA_DIR as _DEFAULT_DATA_DIR,
    SESSION_FILE as _DEFAULT_SESSION_FILE,
    SETTINGS_FILE as _DEFAULT_SETTINGS_FILE,
    atomic_write_json as _service_atomic_write,
    clear_session_data as _service_clear_session,
    get_active_connection_ids as _service_get_active_conn_ids,
    load_session_data as _service_load_session,
    save_session_data as _service_save_session,
)

logger = logging.getLogger("app.routes.session")

session_bp = Blueprint("session", __name__)

DATA_DIR = _DEFAULT_DATA_DIR
SESSION_FILE = _DEFAULT_SESSION_FILE
SETTINGS_FILE = _DEFAULT_SETTINGS_FILE
CONNECTIONS_FILE = _DEFAULT_CONNECTIONS_FILE

SESSION_FILE_PATH = SESSION_FILE
SETTINGS_FILE_PATH = SETTINGS_FILE
CONNECTIONS_FILE_PATH = CONNECTIONS_FILE


def _atomic_write_json(file_path: Path, data: dict) -> bool:
    return _service_atomic_write(file_path, data)


def _get_active_connection_ids() -> Set[str]:
    return _service_get_active_conn_ids(connections_file=CONNECTIONS_FILE)


def save_session_data(payload: dict) -> dict:
    return _service_save_session(
        payload,
        session_file=SESSION_FILE,
        settings_file=SETTINGS_FILE,
    )


def load_session_data() -> dict:
    return _service_load_session(
        session_file=SESSION_FILE,
        settings_file=SETTINGS_FILE,
        connections_file=CONNECTIONS_FILE,
    )


def clear_session_data() -> dict:
    return _service_clear_session(session_file=SESSION_FILE)


@session_bp.post("/save")
def api_save_session():
    data = request.get_json(silent=True) or {}
    res = save_session_data(data)
    return jsonify(res)


@session_bp.get("/load")
def api_load_session():
    res = load_session_data()
    return jsonify(res)


@session_bp.post("/clear")
def api_clear_session():
    res = clear_session_data()
    return jsonify(res)
