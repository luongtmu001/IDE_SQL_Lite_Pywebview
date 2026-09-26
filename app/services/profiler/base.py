# -*- coding: utf-8 -*-
"""
Base classes for the Universal Database Trace Profiler.
Implements the 4-tier event pipeline:
1. Engine Adapter (MSSQL / Postgres)
2. Thread-Safe FIFO Queue (Capacity 50,000)
3. Dual-Trigger Batch Dispatcher (Size 50-100 or Timeout 100ms)
4. IPC Bridge Serializer
"""

import json
import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("luobtool.profiler")


@dataclass
class TraceEvent:
    id: int
    time: str
    event: str
    spid: int
    db: str
    app: str
    duration: float  # in milliseconds
    sql: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "time": self.time,
            "event": self.event,
            "spid": self.spid,
            "db": self.db or "—",
            "app": self.app or "—",
            "duration": round(float(self.duration), 2) if self.duration is not None else 0.0,
            "sql": self.sql or "",
        }


class BaseProfilerSession:
    """
    Abstract base class for a trace session.
    Manages collector thread, FIFO queue, and batch dispatcher thread.
    """

    def __init__(
        self,
        session_id: str,
        conn_config: Dict[str, Any],
        on_batch_callback: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        max_queue_size: int = 50000,
        batch_size: int = 50,
        batch_timeout: float = 0.1,  # 100ms
    ):
        self.session_id = session_id
        self.conn_config = dict(conn_config)
        self.on_batch_callback = on_batch_callback
        self.max_queue_size = max_queue_size
        self.batch_size = batch_size
        self.batch_timeout = batch_timeout

        self.event_queue: queue.Queue = queue.Queue(maxsize=max_queue_size)
        self.event_counter: int = 0
        self.total_dispatched: int = 0

        self.is_running: bool = False
        self.is_paused: bool = False
        self._lock = threading.Lock()

        self._collector_thread: Optional[threading.Thread] = None
        self._dispatcher_thread: Optional[threading.Thread] = None
        self._target_window: Any = None
        self.error_message: Optional[str] = None

    def set_target_window(self, win: Any):
        self._target_window = win

    def start(self) -> bool:
        with self._lock:
            if self.is_running:
                return True

            try:
                self._init_session()
            except Exception as e:
                self.error_message = str(e)
                logger.exception("Failed to initialize profiler session: %s", e)
                return False

            self.is_running = True
            self.is_paused = False

            # Start Dispatcher Thread
            self._dispatcher_thread = threading.Thread(
                target=self._dispatcher_loop,
                name=f"ProfilerDispatcher-{self.session_id}",
                daemon=True,
            )
            self._dispatcher_thread.start()

            # Start Collector Thread
            self._collector_thread = threading.Thread(
                target=self._collector_loop,
                name=f"ProfilerCollector-{self.session_id}",
                daemon=True,
            )
            self._collector_thread.start()

            logger.info("Profiler session %s started successfully", self.session_id)
            return True

    def pause(self):
        with self._lock:
            self.is_paused = True
            logger.info("Profiler session %s paused", self.session_id)

    def resume(self):
        with self._lock:
            self.is_paused = False
            logger.info("Profiler session %s resumed", self.session_id)

    def stop(self):
        with self._lock:
            if not self.is_running:
                return
            self.is_running = False

        try:
            self._cleanup_session()
        except Exception as e:
            logger.warning("Error during session cleanup: %s", e)

        # Drain queue if needed
        try:
            while not self.event_queue.empty():
                self.event_queue.get_nowait()
        except Exception:
            pass

        logger.info("Profiler session %s stopped", self.session_id)

    def emit_event(
        self,
        time_str: str,
        event_type: str,
        spid: int,
        db_name: str,
        app_name: str,
        duration_ms: float,
        sql_text: str,
    ):
        """Called by collector thread to enqueue a standardized trace event."""
        with self._lock:
            self.event_counter += 1
            cur_id = self.event_counter

        ev = TraceEvent(
            id=cur_id,
            time=time_str,
            event=event_type,
            spid=spid,
            db=db_name,
            app=app_name,
            duration=duration_ms,
            sql=sql_text,
        )

        try:
            self.event_queue.put_nowait(ev)
        except queue.Full:
            # Drop oldest event if overflow to prevent process freeze
            try:
                self.event_queue.get_nowait()
                self.event_queue.put_nowait(ev)
            except Exception:
                pass

    def _dispatcher_loop(self):
        """Dual-trigger batch dispatcher loop."""
        batch: List[Dict[str, Any]] = []
        last_flush = time.time()

        while self.is_running:
            try:
                # Wait up to 50ms for next item
                try:
                    ev: TraceEvent = self.event_queue.get(timeout=0.05)
                    batch.append(ev.to_dict())
                except queue.Empty:
                    pass

                now = time.time()
                # Dual trigger check: size >= batch_size OR elapsed >= batch_timeout
                should_flush = len(batch) >= self.batch_size or (
                    len(batch) > 0 and (now - last_flush) >= self.batch_timeout
                )

                if should_flush:
                    if not self.is_paused:
                        self._flush_batch(batch)
                        self.total_dispatched += len(batch)
                    batch = []
                    last_flush = now

            except Exception as e:
                logger.exception("Error in dispatcher loop: %s", e)
                time.sleep(0.05)

        # Flush any remaining items before exit
        if batch and not self.is_paused:
            self._flush_batch(batch)

    def _flush_batch(self, batch: List[Dict[str, Any]]):
        """Dispatches batch to target window via evaluate_js or callback."""
        if not batch:
            return

        # 1. Custom callback if registered
        if callable(self.on_batch_callback):
            try:
                self.on_batch_callback(batch)
            except Exception as e:
                logger.warning("Callback error: %s", e)

        # 2. Window IPC dispatch via evaluate_js
        win = self._target_window
        if win is not None:
            try:
                gui = getattr(win, "gui", None)
                if gui is not None:
                    if getattr(gui, "IsDisposed", False) or getattr(gui, "Disposing", False):
                        return
                    browser = getattr(gui, "browser", None)
                    if browser is not None:
                        wb = getattr(browser, "webview", None)
                        if wb is not None and (
                            getattr(wb, "IsDisposed", False)
                            or getattr(wb, "Disposing", False)
                        ):
                            return

                json_data = json.dumps(batch)
                js_cmd = f"if (window.ingestTraceBatch) {{ window.ingestTraceBatch({json_data}); }}"
                win.evaluate_js(js_cmd)
            except BaseException as e:
                logger.debug("Failed evaluate_js in profiler dispatch: %s", e)

    def get_status(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "is_running": self.is_running,
            "is_paused": self.is_paused,
            "queued_events": self.event_queue.qsize(),
            "total_captured": self.event_counter,
            "total_dispatched": self.total_dispatched,
            "error": self.error_message,
        }

    # Abstract methods to be implemented by child classes
    def _init_session(self):
        raise NotImplementedError

    def _collector_loop(self):
        raise NotImplementedError

    def _cleanup_session(self):
        raise NotImplementedError
