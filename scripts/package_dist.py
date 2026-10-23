# -*- coding: utf-8 -*-
"""
Standalone Packaging Script for LLTool IDE.
Packages dist/LLTool into dist/LLTool_v1.1.3.zip and dist/LLTool.zip.
Excludes any documentation, scratch, tests, and temporary files.
"""
import os
import sys
import shutil
import zipfile
import hashlib
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
APP_DIST_DIR = DIST_DIR / "LLTool"
VERSION = "1.1.5"

def calculate_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def sync_assets():
    print("[1/3] Đồng bộ tài nguyên tĩnh và giao diện vào dist/LLTool/_internal...")
    targets = [APP_DIST_DIR / "_internal"]

    # 1. Sync static/
    static_src = ROOT_DIR / "static"
    for target in targets:
        static_dst = target / "static"
        static_dst.mkdir(parents=True, exist_ok=True)
        for root, dirs, files in os.walk(static_src):
            rel = Path(root).relative_to(static_src)
            (static_dst / rel).mkdir(parents=True, exist_ok=True)
            for f in files:
                try:
                    shutil.copy2(Path(root) / f, static_dst / rel / f)
                except PermissionError:
                    pass

    # 2. Sync templates/
    templates_src = ROOT_DIR / "templates"
    for target in targets:
        templates_dst = target / "templates"
        templates_dst.mkdir(parents=True, exist_ok=True)
        for root, dirs, files in os.walk(templates_src):
            rel = Path(root).relative_to(templates_src)
            (templates_dst / rel).mkdir(parents=True, exist_ok=True)
            for f in files:
                try:
                    shutil.copy2(Path(root) / f, templates_dst / rel / f)
                except PermissionError:
                    pass

    # 3. Copy version.json & logo.ico
    vjson = ROOT_DIR / "version.json"
    if vjson.exists():
        shutil.copy2(vjson, APP_DIST_DIR / "version.json")
        shutil.copy2(vjson, APP_DIST_DIR / "_internal" / "version.json")
    logo = ROOT_DIR / "logo.ico"
    if logo.exists():
        shutil.copy2(logo, APP_DIST_DIR / "logo.ico")

    # Clean __pycache__
    for target in targets:
        for pycache in target.rglob("__pycache__"):
            if pycache.is_dir():
                try:
                    shutil.rmtree(pycache)
                except Exception:
                    pass
    print("      -> Đồng bộ hoàn tất.")

def build_zip(zip_name: str) -> Path:
    zip_path = DIST_DIR / zip_name
    print(f"[2/3] Đang nén {zip_name} từ {APP_DIST_DIR}...")
    if zip_path.exists():
        try:
            zip_path.unlink()
        except Exception:
            pass

    # Excluded substrings for safety (docs, skills, tests, git)
    EXCLUDE_PATTERNS = {".git", ".github", "docs", "doc", ".skill", ".SKILL", "tests", "scratch", ".pytest_cache"}

    total_files = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=3) as zf:
        for root, dirs, files in os.walk(APP_DIST_DIR):
            for file in files:
                file_path = Path(root) / file
                rel_path = file_path.relative_to(APP_DIST_DIR)
                rel_parts = set(rel_path.parts)
                # Check exclusion
                if any(ex in rel_parts for ex in EXCLUDE_PATTERNS):
                    continue
                zf.write(file_path, arcname=str(rel_path).replace("\\", "/"))
                total_files += 1

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    sha256 = calculate_sha256(zip_path)
    print(f"      -> {zip_name}: {total_files} files, {size_mb:.2f} MB, SHA256: {sha256[:16]}...")
    return zip_path

def main():
    if not (APP_DIST_DIR / "LLTool.exe").exists():
        print(f"LỖI: Không tìm thấy {APP_DIST_DIR / 'LLTool.exe'}")
        sys.exit(1)

    sync_assets()

    v_zip = f"LLTool_v{VERSION}.zip"
    full_zip = build_zip(v_zip)

    # Also update LLTool.zip for general distribution
    build_zip("LLTool.zip")

    # Update version.json with final size
    vjson = ROOT_DIR / "version.json"
    if vjson.exists():
        import json
        with open(vjson, "r", encoding="utf-8") as f:
            vdata = json.load(f)
        vdata["fileSize"] = full_zip.stat().st_size
        vdata["sha256"] = calculate_sha256(full_zip)
        with open(vjson, "w", encoding="utf-8") as f:
            json.dump(vdata, f, indent=2, ensure_ascii=False)
        shutil.copy2(vjson, APP_DIST_DIR / "version.json")
        shutil.copy2(vjson, APP_DIST_DIR / "_internal" / "version.json")

    print("[3/3] Đóng gói thành công!")
    print("=================================================================")
    print(f"Bản đóng gói: {full_zip}")
    print(f"Kích thước  : {full_zip.stat().st_size / (1024*1024):.2f} MB")
    print("=================================================================")

if __name__ == "__main__":
    main()
