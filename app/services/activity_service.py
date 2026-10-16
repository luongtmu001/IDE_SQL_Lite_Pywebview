# -*- coding: utf-8 -*-
"""
Activity & Session Monitor Service.
Collects real-time active sessions, requests, execution times, wait stats,
and blocking chains (identifying Head Blockers) for SQL Server and PostgreSQL.
Supports safe query cancellation and session termination.
"""
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("luobtool.services.activity")


class ActivityService:
    """Service for querying and managing database sessions and blocking locks."""

    # -------------------------------------------------------------------------
    # Out-of-band Dedicated Connection Helper
    # -------------------------------------------------------------------------
    _monitor_adapters: Dict[str, Any] = {}

    @classmethod
    def _get_monitor_adapter(cls, session: Any) -> Tuple[Any, bool]:
        """
        Returns (adapter, is_dedicated).
        Attempts to create or reuse a dedicated adapter to avoid contention
        with long-running user transactions. Falls back to session.adapter.
        """
        conn_id = getattr(session, "connection_id", "default")
        adapter = cls._monitor_adapters.get(conn_id)
        if adapter and hasattr(adapter, "is_connected") and adapter.is_connected():
            return adapter, True

        config = getattr(session, "config", None)
        if config and isinstance(config, dict):
            try:
                from app.database.factory import create_adapter
                cfg = dict(config)
                # Mark application name to distinguish monitor sessions in server logs
                app_suffix = "ActivityMonitor"
                curr_app = cfg.get("app_name") or "luoBTool"
                cfg["app_name"] = f"{curr_app}_{app_suffix}"
                new_adapter = create_adapter(cfg)
                new_adapter.connect()
                cls._monitor_adapters[conn_id] = new_adapter
                return new_adapter, True
            except Exception as exc:
                logger.warning("Could not establish dedicated monitor connection (%s), falling back to main adapter: %s", conn_id, exc)

        return getattr(session, "adapter", None), False

    @classmethod
    def close_monitor_connection(cls, conn_id: str):
        """Closes dedicated monitor connection for a specific session."""
        adapter = cls._monitor_adapters.pop(conn_id, None)
        if adapter:
            try:
                adapter.close()
            except Exception:
                pass

    # -------------------------------------------------------------------------
    # Current SPID / PID Detection
    # -------------------------------------------------------------------------
    @classmethod
    def get_current_session_id(cls, session: Any) -> Optional[int]:
        """Returns the current SPID/PID for the connection session."""
        adapter = getattr(session, "adapter", None)
        if not adapter:
            return None
        engine = str(getattr(adapter, "db_type", "") or session.config.get("type", "")).lower()
        try:
            if "postgre" in engine or "pg" in engine:
                res = adapter.execute("SELECT pg_backend_pid() AS pid;")
                if res and res.get("rows") and len(res["rows"]) > 0:
                    return int(res["rows"][0][0])
            else:
                res = adapter.execute("SELECT @@SPID AS spid;")
                if res and res.get("rows") and len(res["rows"]) > 0:
                    return int(res["rows"][0][0])
        except Exception as exc:
            logger.debug("Failed to detect current session ID: %s", exc)
        return None

    # -------------------------------------------------------------------------
    # SQL Server Session & Blocking Queries
    # -------------------------------------------------------------------------
    @classmethod
    def _fetch_sqlserver_sessions(cls, adapter: Any, database: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = """
        SELECT
            s.session_id,
            COALESCE(s.login_name, '') AS login_name,
            COALESCE(s.host_name, '') AS host_name,
            COALESCE(s.program_name, '') AS program_name,
            COALESCE(DB_NAME(COALESCE(r.database_id, s.database_id)), '') AS database_name,
            COALESCE(r.status, s.status, 'unknown') AS status,
            COALESCE(r.command, '') AS command,
            COALESCE(r.cpu_time, s.cpu_time, 0) AS cpu_time_ms,
            COALESCE(r.total_elapsed_time, s.total_elapsed_time, 0) AS elapsed_time_ms,
            COALESCE(r.reads, s.reads, 0) AS reads,
            COALESCE(r.writes, s.writes, 0) AS writes,
            COALESCE(r.logical_reads, s.logical_reads, 0) AS logical_reads,
            COALESCE(r.wait_type, '') AS wait_type,
            COALESCE(r.wait_time, 0) AS wait_time_ms,
            COALESCE(r.last_wait_type, '') AS last_wait_type,
            COALESCE(r.wait_resource, '') AS wait_resource,
            COALESCE(r.blocking_session_id, 0) AS blocking_session_id,
            COALESCE(r.percent_complete, 0.0) AS percent_complete,
            CONVERT(varchar(23), r.start_time, 121) AS start_time,
            COALESCE(CAST(st_req.text AS NVARCHAR(MAX)), CAST(st_conn.text AS NVARCHAR(MAX)), '') AS sql_text
        FROM sys.dm_exec_sessions s
        LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
        LEFT JOIN sys.dm_exec_connections c ON s.session_id = c.session_id
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st_req
        OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) st_conn
        WHERE s.is_user_process = 1
        """
        params = []
        if database:
            sql += " AND DB_NAME(COALESCE(r.database_id, s.database_id)) = %s"
            params.append(database)

        sql += """
        ORDER BY
            CASE WHEN COALESCE(r.blocking_session_id, 0) > 0 THEN 0
                 WHEN r.session_id IS NOT NULL THEN 1
                 ELSE 2 END,
            COALESCE(r.total_elapsed_time, 0) DESC;
        """

        res = adapter.execute(sql, tuple(params) if params else None)
        columns = [c.lower() for c in res.get("columns", [])]
        raw_rows = res.get("rows", [])

        items = []
        for row in raw_rows:
            d = dict(zip(columns, row))
            items.append(d)
        return items

    # -------------------------------------------------------------------------
    # PostgreSQL Session & Blocking Queries
    # -------------------------------------------------------------------------
    @classmethod
    def _fetch_postgresql_sessions(cls, adapter: Any, database: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = """
        SELECT
            a.pid AS session_id,
            COALESCE(a.usename, '') AS login_name,
            COALESCE(a.client_addr::text, 'local') AS host_name,
            COALESCE(a.application_name, '') AS program_name,
            COALESCE(a.datname, '') AS database_name,
            COALESCE(a.state, 'unknown') AS status,
            COALESCE(a.query, '') AS sql_text,
            COALESCE(ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - a.query_start)) * 1000), 0)::bigint AS elapsed_time_ms,
            COALESCE(ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - a.xact_start)) * 1000), 0)::bigint AS xact_elapsed_time_ms,
            COALESCE(a.wait_event_type, '') AS wait_event_type,
            COALESCE(a.wait_event, '') AS wait_type,
            COALESCE(pg_catalog.pg_blocking_pids(a.pid), '{}') AS blocking_pids,
            to_char(a.backend_start, 'YYYY-MM-DD HH24:MI:SS') AS backend_start,
            to_char(a.xact_start, 'YYYY-MM-DD HH24:MI:SS') AS xact_start,
            to_char(a.query_start, 'YYYY-MM-DD HH24:MI:SS') AS start_time
        FROM pg_catalog.pg_stat_activity a
        WHERE a.pid <> pg_backend_pid()
        """
        params = []
        if database:
            sql += " AND a.datname = %s"
            params.append(database)

        sql += """
        ORDER BY
            CASE WHEN array_length(pg_catalog.pg_blocking_pids(a.pid), 1) > 0 THEN 0
                 WHEN a.state = 'active' THEN 1
                 ELSE 2 END,
            COALESCE(clock_timestamp() - a.query_start, interval '0 second') DESC;
        """

        res = adapter.execute(sql, tuple(params) if params else None)
        columns = [c.lower() for c in res.get("columns", [])]
        raw_rows = res.get("rows", [])

        items = []
        for row in raw_rows:
            d = dict(zip(columns, row))
            pids = d.get("blocking_pids") or []
            if isinstance(pids, (list, tuple)) and len(pids) > 0:
                d["blocking_session_id"] = pids[0]
            elif isinstance(pids, str) and pids.strip("{}"):
                try:
                    parts = [int(p.strip()) for p in pids.strip("{}").split(",") if p.strip()]
                    d["blocking_session_id"] = parts[0] if parts else 0
                    d["blocking_pids"] = parts
                except Exception:
                    d["blocking_session_id"] = 0
            else:
                d["blocking_session_id"] = 0
            items.append(d)
        return items

    # -------------------------------------------------------------------------
    # Core Snapshot & Head Blocker Analysis
    # -------------------------------------------------------------------------
    @classmethod
    def get_activity_snapshot(
        cls,
        session: Any,
        database: Optional[str] = None,
        active_only: bool = False,
    ) -> Dict[str, Any]:
        """
        Retrieves real-time session list and blocking analysis.
        Returns:
            {
                "success": True,
                "current_spid": int,
                "engine": "sqlserver" | "postgresql",
                "summary": {
                    "total_sessions": int,
                    "active_sessions": int,
                    "blocked_sessions": int,
                    "head_blockers_count": int,
                },
                "sessions": [ ... ],
                "databases": [ ... ]
            }
        """
        adapter, _ = cls._get_monitor_adapter(session)
        if not adapter:
            return {"success": False, "error": "No database connection available"}

        engine = str(getattr(adapter, "db_type", "") or getattr(session, "config", {}).get("type", "")).lower()
        is_pg = "postgre" in engine or "pg" in engine
        dialect = "postgresql" if is_pg else "sqlserver"

        try:
            if is_pg:
                raw_sessions = cls._fetch_postgresql_sessions(adapter, database)
            else:
                raw_sessions = cls._fetch_sqlserver_sessions(adapter, database)
        except Exception as exc:
            logger.exception("Error querying database activity on %s: %s", getattr(session, "connection_id", ""), exc)
            err_msg = str(exc)
            if "VIEW SERVER STATE" in err_msg.upper():
                err_msg = "Tài khoản không đủ quyền VIEW SERVER STATE để xem toàn bộ danh sách phiên làm việc."
            return {"success": False, "error": err_msg}

        current_spid = cls.get_current_session_id(session)
        decorated, head_blockers = cls._process_session_rows(raw_sessions, current_spid=current_spid, active_only=active_only)

        db_set = {s["database_name"] for s in decorated if s.get("database_name")}
        active_count = sum(1 for s in decorated if s.get("is_active"))
        blocked_count = sum(1 for s in decorated if s.get("is_blocked"))

        return {
            "success": True,
            "engine": dialect,
            "current_spid": current_spid,
            "counts": {
                "total": len(decorated),
                "active": active_count,
                "blocked": blocked_count,
                "head_blockers": len(head_blockers),
            },
            "summary": {
                "total_sessions": len(decorated),
                "active_sessions": active_count,
                "blocked_sessions": blocked_count,
                "head_blockers_count": len(head_blockers),
            },
            "sessions": decorated,
            "head_blocker_pids": sorted(list(head_blockers)),
            "databases": sorted(list(db_set)),
        }

    @classmethod
    def _process_session_rows(
        cls,
        raw_sessions: List[Dict[str, Any]],
        current_spid: Optional[int] = None,
        active_only: bool = False,
    ) -> Tuple[List[Dict[str, Any]], Set[int]]:
        """
        Calculates blocking chains, identifies Head Blockers, and enriches session rows
        with UI display metadata.
        """
        # Step 1: Collect all session IDs that are blocking someone
        all_blockers: Set[int] = set()
        for item in raw_sessions:
            b_id = item.get("blocking_session_id")
            if b_id and int(b_id) > 0:
                all_blockers.add(int(b_id))
            b_pids = item.get("blocking_pids")
            if isinstance(b_pids, (list, tuple)):
                for p in b_pids:
                    if int(p) > 0:
                        all_blockers.add(int(p))

        # Step 2: Determine which blockers are NOT blocked themselves (Head Blockers)
        head_blockers: Set[int] = set()
        session_map = {int(s["session_id"]): s for s in raw_sessions if "session_id" in s and s["session_id"]}

        for b_id in all_blockers:
            blocker_session = session_map.get(b_id)
            if blocker_session is None:
                # The blocker might be sleeping/outside active set, still a root cause
                head_blockers.add(b_id)
            else:
                b_self = blocker_session.get("blocking_session_id")
                if not b_self or int(b_self) == 0:
                    head_blockers.add(b_id)

        # Step 3: Decorate each session with flags, formatted elapsed times, and badges
        decorated: List[Dict[str, Any]] = []
        for s in raw_sessions:
            spid = int(s.get("session_id") or 0)
            status = str(s.get("status") or "").lower()
            is_active = status in ("running", "active", "runnable") or bool(s.get("command") and s.get("command") != "AWAITING COMMAND")

            blocking_id = int(s.get("blocking_session_id") or 0)
            is_blocked = blocking_id > 0
            is_head = spid in head_blockers
            is_blocker = spid in all_blockers
            is_self = bool(current_spid is not None and spid == current_spid)

            elapsed_ms = int(s.get("elapsed_time_ms") or 0)
            elapsed_str = cls._format_duration(elapsed_ms)

            item = {
                **s,
                "session_id": spid,
                "is_active": is_active,
                "is_blocked": is_blocked,
                "is_head_blocker": is_head,
                "is_blocker": is_blocker,
                "is_current": is_self,
                "is_current_session": is_self,
                "elapsed_str": elapsed_str,
                "cpu_time_str": cls._format_duration(int(s.get("cpu_time_ms") or 0)),
                "blocking_session_id": blocking_id if blocking_id > 0 else None,
            }

            if active_only and not (is_active or is_blocked or is_head):
                continue

            decorated.append(item)

        # Sort: Head Blockers first, then Blocked, then Active, then by Elapsed
        decorated.sort(
            key=lambda x: (
                0 if x["is_head_blocker"] else (1 if x["is_blocked"] else (2 if x["is_active"] else 3)),
                -int(x.get("elapsed_time_ms") or 0),
            )
        )
        return decorated, head_blockers

    @staticmethod
    def _format_duration(ms: int) -> str:
        """Formats milliseconds into readable HH:MM:SS or SS.ms format."""
        if ms <= 0:
            return "0s"
        total_seconds = ms // 1000
        rem_ms = ms % 1000
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        if minutes > 0:
            return f"{minutes:02d}:{seconds:02d}"
        if seconds > 0:
            return f"{seconds}.{rem_ms // 100}s"
        return f"{ms}ms"

    # -------------------------------------------------------------------------
    # Safe Cancel & Kill Operations
    # -------------------------------------------------------------------------
    @classmethod
    def cancel_session(cls, session: Any, target_id: int) -> Dict[str, Any]:
        """
        Safely cancels the currently running query of a session without terminating
        the connection. Supported natively on PostgreSQL. On SQL Server, executes KILL.
        """
        try:
            cls._verify_safe_mutation(session, target_id, action="CANCEL")
            adapter, _ = cls._get_monitor_adapter(session)
            if not adapter:
                return {"success": False, "error": "No database adapter available"}

            engine = str(getattr(adapter, "db_type", "") or getattr(session, "config", {}).get("type", "")).lower()
            if "postgre" in engine or "pg" in engine:
                adapter.execute("SELECT pg_cancel_backend(%s);", (int(target_id),))
                return {
                    "success": True,
                    "action": "cancel",
                    "session_id": target_id,
                    "message": f"✓ Đã gửi tín hiệu hủy truy vấn cho phiên làm việc PID {target_id}.",
                }
            else:
                # SQL Server doesn't have a separate cancel for remote session, so KILL is used
                adapter.execute(f"KILL {int(target_id)};")
                return {
                    "success": True,
                    "action": "kill",
                    "session_id": target_id,
                    "message": f"✓ Đã thực thi KILL {target_id} trên máy chủ SQL Server.",
                }
        except Exception as exc:
            logger.exception("Error cancelling session %s: %s", target_id, exc)
            return {"success": False, "error": str(exc)}

    @classmethod
    def kill_session(cls, session: Any, target_id: int) -> Dict[str, Any]:
        """
        Terminates the specified session/connection on the database server.
        Postgres: SELECT pg_terminate_backend(pid);
        SQL Server: KILL <spid>;
        """
        try:
            cls._verify_safe_mutation(session, target_id, action="KILL")
            adapter, _ = cls._get_monitor_adapter(session)
            if not adapter:
                return {"success": False, "error": "No database adapter available"}

            engine = str(getattr(adapter, "db_type", "") or getattr(session, "config", {}).get("type", "")).lower()
            if "postgre" in engine or "pg" in engine:
                res = adapter.execute("SELECT pg_terminate_backend(%s);", (int(target_id),))
                terminated = res["rows"][0][0] if (res and res.get("rows")) else True
                if not terminated:
                    return {"success": False, "error": f"Không thể ngắt kết nối PID {target_id} (tiến trình có thể đã kết thúc hoặc không đủ quyền)."}
                return {
                    "success": True,
                    "action": "terminate",
                    "session_id": target_id,
                    "message": f"✓ Đã ngắt kết nối phiên làm việc PID {target_id} thành công.",
                }
            else:
                adapter.execute(f"KILL {int(target_id)};")
                return {
                    "success": True,
                    "action": "kill",
                    "session_id": target_id,
                    "message": f"✓ Đã thực thi KILL {target_id} trên máy chủ SQL Server thành công.",
                }
        except Exception as exc:
            logger.exception("Error killing session %s: %s", target_id, exc)
            return {"success": False, "error": str(exc)}

    @classmethod
    def _verify_safe_mutation(cls, session: Any, target_id: int, action: str):
        """Validates that session is permitted to be cancelled/killed."""
        if getattr(session, "read_only", False):
            raise PermissionError("Kết nối đang ở chế độ CHỈ ĐỌC (Read-Only). Không được phép hủy hoặc kill session.")

        curr_id = cls.get_current_session_id(session)
        if curr_id is not None and int(target_id) == int(curr_id):
            raise ValueError(f"Không thể {action.lower()} phiên làm việc của chính bạn (SPID/PID {target_id}).")
