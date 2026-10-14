# -*- coding: utf-8 -*-
"""
Connections API Mixin.
Handles connection profile management, creation, deletion, credentials, and adapter lookup.
"""
import logging
import uuid
from app.database.factory import create_adapter
from app.services.settings_store import (
    CONNECTIONS_FILE,
    _read_json,
    _write_json,
    get_saved_connections as load_saved_connections,
)
from app.utils.crypto import (
    encrypt_password,
    decrypt_password,
    CredentialDecryptError,
)

logger = logging.getLogger("luobtool.api.connections")


class ConnectionsApiMixin:
    def get_saved_connections(self):
        data = load_saved_connections(filter_groups=False)
        return {"success": True, "connections": data}


    def get_connection_password(self, profile_id_or_name):
        try:
            from app.utils.crypto import CredentialDecryptError
            logger.info("[get_connection_password] Profile password requested for: %s", profile_id_or_name)
            saved = _read_json(CONNECTIONS_FILE, [])
            target_str = str(profile_id_or_name).strip().lower()
            for p in saved:
                if p.get("id") == profile_id_or_name or str(p.get("name", "")).strip().lower() == target_str:
                    if p.get("password"):
                        try:
                            return {"success": True, "password": decrypt_password(p["password"])}
                        except CredentialDecryptError as dec_err:
                            logger.error("[get_connection_password] Failed to decrypt password: %s", dec_err)
                            return {"success": False, "error": "Mật khẩu không thể giải mã trên thiết bị này. Vui lòng nhập lại.", "password": ""}
                    break
            return {"success": True, "password": ""}
        except Exception as exc:
            logger.error("[get_connection_password] Unexpected error: %s", exc)
            return {"success": False, "error": str(exc), "password": ""}


    def save_connection_profile(self, profile):
        profiles = _read_json(CONNECTIONS_FILE, [])
        prof = dict(profile)
        prof_id = prof.get("id")

        matched_idx = -1
        if prof_id:
            for i, p in enumerate(profiles):
                if p.get("id") == prof_id:
                    matched_idx = i
                    break

        if matched_idx == -1 and prof.get("name"):
            p_name = str(prof.get("name")).strip().lower()
            p_type = str(prof.get("type", "")).strip().lower()
            for i, p in enumerate(profiles):
                if str(p.get("name")).strip().lower() == p_name and str(p.get("type", "")).strip().lower() == p_type:
                    matched_idx = i
                    break

        if matched_idx == -1 and (prof.get("server") or prof.get("host")):
            p_srv = str(prof.get("server") or prof.get("host")).strip().lower()
            p_port = str(prof.get("port") or "")
            p_db = str(prof.get("database") or "").strip().lower()
            p_type = str(prof.get("type", "")).strip().lower()
            for i, p in enumerate(profiles):
                e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                e_port = str(p.get("port") or "")
                e_db = str(p.get("database") or "").strip().lower()
                e_type = str(p.get("type", "")).strip().lower()
                if e_srv == p_srv and e_port == p_port and e_db == p_db and e_type == p_type:
                    matched_idx = i
                    break

        # Password encryption & preservation in connections.json
        pwd = prof.get("password")
        clear_pwd = prof.pop("clear_password", False)
        if clear_pwd:
            prof.pop("password", None)
            prof["has_password"] = False
        elif pwd:
            prof["password"] = encrypt_password(pwd)
            prof["has_password"] = True
        elif matched_idx >= 0 and profiles[matched_idx].get("password"):
            prof["password"] = profiles[matched_idx]["password"]
            prof["has_password"] = True
        else:
            prof.pop("password", None)
            prof["has_password"] = False

        if matched_idx >= 0:
            if not prof_id:
                prof["id"] = profiles[matched_idx].get("id") or f"conn_{uuid.uuid4().hex[:8]}"
            profiles[matched_idx] = prof
        else:
            if not prof_id:
                prof["id"] = f"conn_{uuid.uuid4().hex[:8]}"
            profiles.append(prof)

        _write_json(CONNECTIONS_FILE, profiles)
        return {"success": True, "connection": prof}


    def delete_saved_connection_profile(self, profile_id):
        profiles = _read_json(CONNECTIONS_FILE, [])
        new_profiles = [p for p in profiles if p.get("id") != profile_id]
        _write_json(CONNECTIONS_FILE, new_profiles)
        return {"success": True}


    def create_connection(self, config):
        if not config.get("type"):
            return {"success": False, "error": "Database type is required"}
        db_type = (config.get("type") or "").strip().lower()
        if db_type == "group_marker" or str(config.get("name", "")).startswith("__group__"):
            return {"success": False, "error": "Không thể kết nối đến nhóm. Vui lòng chọn một kết nối cơ sở dữ liệu."}
        try:
            cfg = dict(config)
            # If password not provided in payload and authentication requires password, load from connections.json
            if not cfg.get("password") and not cfg.get("trusted_connection") and (cfg.get("type") or "").lower() != "sqlite":
                saved = _read_json(CONNECTIONS_FILE, [])
                target = None
                prof_id = cfg.get("id")
                if prof_id:
                    for p in saved:
                        if p.get("id") == prof_id:
                            target = p
                            break
                if not target and cfg.get("name"):
                    c_name = str(cfg.get("name")).strip().lower()
                    c_type = str(cfg.get("type", "")).strip().lower()
                    for p in saved:
                        if str(p.get("name")).strip().lower() == c_name and str(p.get("type", "")).strip().lower() == c_type:
                            target = p
                            break
                if not target and (cfg.get("server") or cfg.get("host")):
                    c_srv = str(cfg.get("server") or cfg.get("host")).strip().lower()
                    c_port = str(cfg.get("port") or "")
                    for p in saved:
                        e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                        e_port = str(p.get("port") or "")
                        if e_srv == c_srv and e_port == c_port:
                            target = p
                            break

                if target and target.get("password"):
                    cfg["password"] = decrypt_password(target["password"])
                else:
                    return {"success": False, "error": "Mật khẩu là bắt buộc cho kết nối này. Vui lòng nhập mật khẩu."}

            conn, reused = self.cm.create_or_get(self.owner_session_id, cfg)
            return {"success": True, "connection": conn.public_info(), "reused": reused}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def list_connections(self):
        try:
            saved = _read_json(CONNECTIONS_FILE, [])
            sanitized_saved = []
            for d in saved:
                item = dict(d)
                db_type = (item.get("type") or "").strip().lower()
                if db_type == "group_marker" or str(item.get("name", "")).startswith("__group__"):
                    continue
                if item.get("password"):
                    item["has_password"] = True
                    item.pop("password", None)
                else:
                    item["has_password"] = False
                sanitized_saved.append(item)
            items = [c.public_info() for c in self.cm.list(self.owner_session_id)]
            return {
                "success": True,
                "connections": items,
                "saved_connections": sanitized_saved,
                "active_connections": items
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def delete_connection(self, connection_id):
        try:
            self.cm.close(self.owner_session_id, connection_id)
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def check_credential(self, config):
        db_type = (config.get("type") or "sqlserver").lower()
        if db_type == "group_marker" or str(config.get("name", "")).startswith("__group__"):
            return {"success": False, "error": "Không phải kết nối cơ sở dữ liệu."}
        trusted = bool(config.get("trusted_connection"))
        if db_type == "sqlite" or trusted:
            return {"success": True, "requires_password": False, "has_password": True}

        # Check directly in connections.json file (source of truth)
        saved = _read_json(CONNECTIONS_FILE, [])
        target = None
        prof_id = config.get("id")
        if prof_id:
            for p in saved:
                if p.get("id") == prof_id:
                    target = p
                    break
        if not target and config.get("name"):
            c_name = str(config.get("name")).strip().lower()
            c_type = str(config.get("type", "")).strip().lower()
            for p in saved:
                if str(p.get("name")).strip().lower() == c_name and str(p.get("type", "")).strip().lower() == c_type:
                    target = p
                    break
        if not target and (config.get("server") or config.get("host")):
            c_srv = str(config.get("server") or config.get("host")).strip().lower()
            c_port = str(config.get("port") or "")
            for p in saved:
                e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                e_port = str(p.get("port") or "")
                if e_srv == c_srv and e_port == c_port:
                    target = p
                    break

        if target and target.get("password"):
            return {"success": True, "requires_password": True, "has_password": True}

        return {"success": True, "requires_password": True, "has_password": False}


    def clear_credential(self, config):
        self.cm.clear_cached_password(config)
        return {"success": True}


    def fetch_connection_metadata(self, config):
        try:
            cfg = dict(config or {})
            if not cfg.get("password") and not cfg.get("trusted_connection") and (cfg.get("type") or "").lower() != "sqlite":
                saved = _read_json(CONNECTIONS_FILE, [])
                target = None
                prof_id = cfg.get("id")
                if prof_id:
                    for p in saved:
                        if p.get("id") == prof_id:
                            target = p
                            break
                if not target and cfg.get("name"):
                    c_name = str(cfg.get("name")).strip().lower()
                    c_type = str(cfg.get("type", "")).strip().lower()
                    for p in saved:
                        if str(p.get("name")).strip().lower() == c_name and str(p.get("type", "")).strip().lower() == c_type:
                            target = p
                            break
                if not target and (cfg.get("server") or cfg.get("host")):
                    c_srv = str(cfg.get("server") or cfg.get("host")).strip().lower()
                    c_port = str(cfg.get("port") or "")
                    for p in saved:
                        e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                        e_port = str(p.get("port") or "")
                        if e_srv == c_srv and e_port == c_port:
                            target = p
                            break

                if target and target.get("password"):
                    cfg["password"] = decrypt_password(target["password"])

            temp_conn = self.cm.create(self.owner_session_id, cfg)
            try:
                db_name = cfg.get("database") or None
                databases = []
                schemas = []
                try:
                    raw_dbs = temp_conn.metadata_service.list_databases()
                    databases = [d.get("name", d) if isinstance(d, dict) else str(d) for d in raw_dbs]
                except Exception:
                    pass
                try:
                    raw_schemas = temp_conn.metadata_service.list_schemas(db_name)
                    schemas = [s.get("name", s) if isinstance(s, dict) else str(s) for s in raw_schemas]
                except Exception:
                    pass
                return {"success": True, "databases": databases, "schemas": schemas}
            finally:
                self.cm.close(self.owner_session_id, temp_conn.connection_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def _get_connection(self, connection_id):
        if not connection_id or str(connection_id).lower() in ("undefined", "null", "none"):
            with self.cm._lock:
                for c in self.cm._connections.values():
                    c.touch()
                    return c
            return None

        with self.cm._lock:
            conn = self.cm._connections.get(connection_id)
            if conn:
                conn.touch()
                return conn
            for c in self.cm._connections.values():
                cfg = getattr(c, "config", {}) or {}
                if cfg.get("name") == connection_id or cfg.get("server") == connection_id or cfg.get("host") == connection_id:
                    c.touch()
                    return c

        try:
            return self.cm.get(self.owner_session_id, connection_id)
        except Exception:
            with self.cm._lock:
                for c in self.cm._connections.values():
                    c.touch()
                    return c
            return None

