"""
Generator and extractor for Public API Surface snapshot.
Used as safety net for Phase 6 refactoring (main.py decoupling).
"""
import inspect
import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def get_public_methods(cls):
    """Return sorted list of (method_name, signature_str) for public callable attributes."""
    results = []
    for name in dir(cls):
        if name.startswith("_"):
            continue
        try:
            attr = getattr(cls, name)
            if callable(attr):
                try:
                    sig = str(inspect.signature(attr))
                except (ValueError, TypeError):
                    sig = "(...)"
                results.append((name, sig))
        except Exception:
            continue
    results.sort(key=lambda x: x[0])
    return results


def get_flask_routes():
    """Return sorted list of Flask routes with HTTP methods and endpoint."""
    try:
        from app import create_app
        app = create_app()
        routes = []
        ignored_methods = {"HEAD", "OPTIONS"}
        for rule in app.url_map.iter_rules():
            methods = sorted(list(rule.methods - ignored_methods))
            methods_str = ",".join(methods) if methods else "ANY"
            routes.append(f"{rule.rule} [{methods_str}] -> {rule.endpoint}")
        routes.sort()
        return routes
    except Exception as e:
        return [f"ERROR_EXTRACTING_FLASK_ROUTES: {e}"]


def generate_api_surface_content():
    """Produce deterministic text representation of public API surface."""
    from main import (
        BravoApi,
        EventListenerSubwindowApi,
        MainApi,
        ProfilerSubwindowApi,
        QueryHistorySubwindowApi,
        SettingsSubwindowApi,
    )

    lines = []
    lines.append("# ====================================================================")
    lines.append("# Public API Surface Snapshot - Safety Net for Refactoring")
    lines.append("# Generated for IDE-SQL-Lite_New_Pyweb_Claude")
    lines.append("# ====================================================================")
    lines.append("")

    classes = [
        ("BravoApi", BravoApi),
        ("MainApi", MainApi),
        ("QueryHistorySubwindowApi", QueryHistorySubwindowApi),
        ("SettingsSubwindowApi", SettingsSubwindowApi),
        ("ProfilerSubwindowApi", ProfilerSubwindowApi),
        ("EventListenerSubwindowApi", EventListenerSubwindowApi),
    ]

    for class_name, cls in classes:
        methods = get_public_methods(cls)
        lines.append(f"CLASS {class_name} ({len(methods)} public methods):")
        for name, sig in methods:
            lines.append(f"  - {name}{sig}")
        lines.append("")

    routes = get_flask_routes()
    lines.append(f"FLASK ROUTES ({len(routes)} endpoints):")
    for r in routes:
        lines.append(f"  - {r}")
    lines.append("")

    return "\n".join(lines)


def main():
    content = generate_api_surface_content()
    out_path = Path(__file__).resolve().parent / "api_surface.txt"
    out_path.write_text(content, encoding="utf-8")
    print(f"API surface snapshot written to: {out_path}")


if __name__ == "__main__":
    main()
