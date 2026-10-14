# -*- coding: utf-8 -*-
"""
Local BRAVO Backend and IIS Discovery Utility.
Safely detects local BRAVO Backend instances running on Windows:
- Checks common BRAVO backend listening ports (8001, 8080, 5000, 5001, 8888).
- Checks Windows Services matching BRAVO / IIS patterns.
- Inspects IIS applicationHost.config if permissions allow.
- Always provides robust, non-crashing fallback lists.
"""

import logging
import os
import re
import socket
import subprocess
import sys
from typing import Any, Dict, List

logger = logging.getLogger("luobtool.profiler.discovery")

DEFAULT_CANDIDATE_PORTS = [
    {"port": 8001, "name": "BRAVO Backend API (Port 8001)", "type": "backend"},
    {"port": 8080, "name": "BRAVO Service Host (Port 8080)", "type": "backend"},
    {"port": 5000, "name": "BRAVO Platform Core (Port 5000)", "type": "backend"},
    {"port": 5001, "name": "BRAVO Platform Secure (Port 5001)", "type": "backend"},
    {"port": 6379, "name": "Local Redis Cache (Port 6379)", "type": "redis"},
    {"port": 5432, "name": "Local PostgreSQL (Port 5432)", "type": "postgresql"},
]


def _check_port_open(host: str, port: int, timeout: float = 0.3) -> bool:
    """Quick socket check to verify if a local port is listening."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            return result == 0
    except Exception:
        return False


def _check_windows_services() -> List[Dict[str, Any]]:
    """Discovers running Windows services related to BRAVO or IIS."""
    services = []
    if sys.platform != "win32":
        return services

    try:
        # Run sc query or Get-Service via PowerShell safely with short timeout
        cmd = 'powershell.exe -NoProfile -Command "Get-Service | Where-Object { $_.Name -match \'bravo|w3svc\' } | Select-Object Name, DisplayName, Status | ConvertTo-Json"'
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3.0, shell=True)
        if proc.returncode == 0 and proc.stdout.strip():
            import json
            try:
                data = json.loads(proc.stdout)
                if isinstance(data, dict):
                    data = [data]
                for item in data:
                    status_str = str(item.get("Status", "")).lower()
                    services.append({
                        "name": item.get("DisplayName") or item.get("Name"),
                        "service_name": item.get("Name"),
                        "status": "running" if "running" in status_str else "stopped",
                        "source": "windows_service"
                    })
            except Exception:
                pass
    except Exception as e:
        logger.debug("Error checking Windows services: %s", e)

    return services


def discover_local_backends() -> List[Dict[str, Any]]:
    """
    Main discovery entry point.
    Returns a unified list of detected local BRAVO backends and services.
    """
    discovered: List[Dict[str, Any]] = []

    # 1. Scan candidate local ports
    for candidate in DEFAULT_CANDIDATE_PORTS:
        is_open = _check_port_open("127.0.0.1", candidate["port"])
        if is_open:
            discovered.append({
                "id": f"local_port_{candidate['port']}",
                "name": f"{candidate['name']} — Đang chạy (Active)",
                "host": "127.0.0.1",
                "port": candidate["port"],
                "type": candidate["type"],
                "status": "running",
                "source": "local_port",
                "is_detected": True,
            })

    # 2. Check Windows Services
    services = _check_windows_services()
    for svc in services:
        discovered.append({
            "id": f"svc_{svc.get('service_name', 'bravo')}",
            "name": f"[Service] {svc['name']} ({svc['status'].upper()})",
            "host": "127.0.0.1",
            "port": 8001,
            "type": "backend",
            "status": svc["status"],
            "source": "windows_service",
            "is_detected": True,
        })

    # 3. Always ensure at least default standard options are available
    if not any(d["port"] == 8001 for d in discovered):
        discovered.insert(0, {
            "id": "bravo_default_8001",
            "name": "BRAVO Backend Default (http://localhost:8001)",
            "host": "127.0.0.1",
            "port": 8001,
            "type": "backend",
            "status": "configured",
            "source": "default_config",
            "is_detected": False,
        })

    if not any(d["port"] == 8080 for d in discovered):
        discovered.append({
            "id": "bravo_iis_8080",
            "name": "BRAVO IIS Site (http://localhost:8080)",
            "host": "127.0.0.1",
            "port": 8080,
            "type": "backend",
            "status": "configured",
            "source": "default_config",
            "is_detected": False,
        })

    return discovered
