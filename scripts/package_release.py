# -*- coding: utf-8 -*-
"""
Release Packaging Script for LLTool IDE / luoBTool Desktop.
Generates:
1. dist/LLTool_v1.1.0.zip (Full standalone application distribution)
2. dist/LLTool_v1.1.0_patch.zip (Lightweight in-place update patch archive)
3. dist/README_UPDATE.txt (Release notes and update guide)
Updates version.json with the exact byte size and SHA-256 checksums.
"""
import hashlib
import json
import os
import shutil
import sys
import zipfile
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

VERSION = "1.1.6"
FULL_ZIP_NAME = f"LLTool_v{VERSION}.zip"
PATCH_ZIP_NAME = f"LLTool_v{VERSION}_patch.zip"


def calculate_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def create_readme_update() -> str:
    content = f"""================================================================================
HUONG DAN CAP NHAT & PHAT HANH LLTOOL IDE v{VERSION}
================================================================================
Ngay phat hanh: 2026-10-25
Phien ban: v{VERSION} (Report Layout Gen v2 - Sinh Layout Bao Cao Bravo Tu Excel/Google Sheets)

CAC TINH NANG MOI & NANG CAP TRONG BAN v{VERSION}:
1. Bo Cong Cu Sinh Layout Bao Cao Bravo v2 (Report Layout Gen v2):
   - Trich xuat cau truc va kieu dang o tinh tu file Excel (.xlsx/.xlsm) va Google Sheets.
   - Ho tro phien lam viec da file (File Cards & File Switcher) va quan ly da sheet.

2. Boc Tanh Cot Routine Sieu An Toan (Static Analysis - NO EXEC):
   - Phan tich cu phap tinh tu dinh nghia Routine DDL (Stored Procedure/Function).
   - Tuyet doi khong chay cau lenh EXEC len Database, phong tranh moi rui ro du lieu.

3. Bang Tinh Tuong Tac SheetGrid & Khoanh Vung Thong Minh:
   - Tu dong nhan dien va goi y khoanh vung Title, Content (Header), Summary.
   - Ho tro keo chuot chon vung, Shift+Click, Name Box, Zoom, menu chuot phai gan vung.

4. Anh Xa Cot DB & Tham So Output Bravo:
   - Cot Layout giu nguyen the <Col_...> va tu dong chen the con <Name>ten_cot</Name>.
   - O Title / Summary tu dong thay the gia tri text thanh tham so Output {{=@_param}}.
   - Cot bi tat su dung duoc danh dau <Visible>False</Visible>.

5. Trinh Bien Dich & Xuat XML 2 Panel Truc Quan:
   - Chia tab sheet thong minh, chuyen doi nhanh giua report_layout.xml va report_datasource.xml.
   - Ho tro sao chep 1-click vao Clipboard hoac luu file truc tiep ra thu muc may tinh.

--------------------------------------------------------------------------------
CACH 1: SU DUNG GOI FULL (LLTool_v{VERSION}.zip - Khuyen nghi)
--------------------------------------------------------------------------------
- Giai nen toan bo file LLTool_v{VERSION}.zip vao mot thu muc tuy y tren may tinh.
- Chay truc tiep LLTool.exe de su dung (khong can cai dat).
- Du lieu ket noi va lich su se duoc giu nguyen tai %APPDATA%\\LLTool.

--------------------------------------------------------------------------------
CACH 2: NANG CAP TAI CHO (IN-PLACE PATCH / AUTO-UPDATE)
--------------------------------------------------------------------------------
- Tat ung dung LLTool neu dang mo.
- Giai nen de toan bo thu muc 'static', 'templates', 'app', 'version.json' va '_internal'
  tu file patch vao thu muc cai dat hien tai cua ban (vi du: dist\\LLTool\\).
- Hoac de tinh nang Tu dong cap nhat trong ung dung (In-App Auto-Updater) tu dong tai
  va ap dung goi LLTool_v{VERSION}_patch.zip mot cach hoan toan tu dong!
- Khoi dong lai LLTool.exe de tan huong cac tinh nang moi nhat.
================================================================================
"""
    return content


def sync_workspace_to_dist():
    """Synchronize all updated workspace files into dist/LLTool/ and dist/LLTool/_internal/."""
    print(f"[0/5] Đồng bộ mã nguồn workspace sang bản đóng gói dist/LLTool...")

    dist_root_targets = [APP_DIST_DIR]
    if (APP_DIST_DIR / "_internal").exists():
        dist_root_targets.append(APP_DIST_DIR / "_internal")

    # 1. Sync static/
    static_src = ROOT_DIR / "static"
    for target_base in dist_root_targets:
        static_dst = target_base / "static"
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
    for target_base in dist_root_targets:
        templates_dst = target_base / "templates"
        templates_dst.mkdir(parents=True, exist_ok=True)
        for root, dirs, files in os.walk(templates_src):
            rel = Path(root).relative_to(templates_src)
            (templates_dst / rel).mkdir(parents=True, exist_ok=True)
            for f in files:
                try:
                    shutil.copy2(Path(root) / f, templates_dst / rel / f)
                except PermissionError:
                    pass

    # 3. Sync app/ (excluding __pycache__, .pyc, .pyo)
    app_src = ROOT_DIR / "app"
    for target_base in dist_root_targets:
        app_dst = target_base / "app"
        app_dst.mkdir(parents=True, exist_ok=True)
        for root, dirs, files in os.walk(app_src):
            if "__pycache__" in root:
                continue
            rel = Path(root).relative_to(app_src)
            (app_dst / rel).mkdir(parents=True, exist_ok=True)
            for f in files:
                if f.endswith((".pyc", ".pyo")):
                    continue
                try:
                    shutil.copy2(Path(root) / f, app_dst / rel / f)
                except PermissionError:
                    # Skip locked file (e.g. ScriptDom DLL in use by active app)
                    pass

    # 4. Sync root python files & version.json
    for root_file in ["main.py", "config.py", "run.py", "version.json"]:
        rf_src = ROOT_DIR / root_file
        if rf_src.exists():
            for target_base in dist_root_targets:
                try:
                    shutil.copy2(rf_src, target_base / root_file)
                except PermissionError:
                    pass

    # 5. Clean any __pycache__ in dist
    for target_base in dist_root_targets:
        for pycache in target_base.rglob("__pycache__"):
            if pycache.is_dir():
                try:
                    shutil.rmtree(pycache)
                except Exception:
                    pass

    print(f"      -> Đồng bộ thành công: static, templates, app, main.py, version.json vào dist/LLTool và _internal.")


def build_full_zip() -> Path:
    print(f"[2/5] Đóng gói full distribution: {FULL_ZIP_NAME}...")
    full_zip_path = DIST_DIR / FULL_ZIP_NAME
    if full_zip_path.exists():
        full_zip_path.unlink()

    with zipfile.ZipFile(full_zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # Add README_UPDATE.txt at root of zip
        readme_content = create_readme_update()
        zf.writestr("README_UPDATE.txt", readme_content)

        # Walk through dist/LLTool
        for root, dirs, files in os.walk(APP_DIST_DIR):
            for file in files:
                file_path = Path(root) / file
                rel_path = file_path.relative_to(APP_DIST_DIR)
                zf.write(file_path, arcname=str(rel_path).replace("\\", "/"))

    print(f"      -> Tạo thành công: {full_zip_path} ({full_zip_path.stat().st_size:,} bytes)")
    return full_zip_path


def build_patch_zip() -> Path:
    print(f"[3/5] Đóng gói patch update: {PATCH_ZIP_NAME}...")
    patch_zip_path = DIST_DIR / PATCH_ZIP_NAME
    if patch_zip_path.exists():
        patch_zip_path.unlink()

    readme_content = create_readme_update()

    with zipfile.ZipFile(patch_zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr("README_UPDATE.txt", readme_content)

        # Include version.json at root and _internal
        version_json_path = ROOT_DIR / "version.json"
        if version_json_path.exists():
            zf.write(version_json_path, arcname="version.json")
            zf.write(version_json_path, arcname="_internal/version.json")

        # Include static/ assets (both top-level and in _internal)
        static_dir = ROOT_DIR / "static"
        for root, _, files in os.walk(static_dir):
            for file in files:
                f_path = Path(root) / file
                rel_p = f_path.relative_to(ROOT_DIR)
                zf.write(f_path, arcname=str(rel_p).replace("\\", "/"))
                zf.write(f_path, arcname=f"_internal/{str(rel_p).replace('\\', '/')}")

        # Include templates/ assets
        templates_dir = ROOT_DIR / "templates"
        for root, _, files in os.walk(templates_dir):
            for file in files:
                f_path = Path(root) / file
                rel_p = f_path.relative_to(ROOT_DIR)
                zf.write(f_path, arcname=str(rel_p).replace("\\", "/"))
                zf.write(f_path, arcname=f"_internal/{str(rel_p).replace('\\', '/')}")

        # Include app python source for update_checker auto-extract
        app_dir = ROOT_DIR / "app"
        for root, dirs, files in os.walk(app_dir):
            if "__pycache__" in root:
                continue
            for file in files:
                if file.endswith((".pyc", ".pyo")):
                    continue
                f_path = Path(root) / file
                rel_p = f_path.relative_to(ROOT_DIR)
                zf.write(f_path, arcname=str(rel_p).replace("\\", "/"))
                zf.write(f_path, arcname=f"_internal/{str(rel_p).replace('\\', '/')}")

        # Include root python entry scripts so in-place patch updates entire python execution layer
        for root_file in ["main.py", "config.py", "run.py"]:
            rf_path = ROOT_DIR / root_file
            if rf_path.exists():
                zf.write(rf_path, arcname=root_file)
                zf.write(rf_path, arcname=f"_internal/{root_file}")

    print(f"      -> Tạo thành công: {patch_zip_path} ({patch_zip_path.stat().st_size:,} bytes)")
    return patch_zip_path


def build_pyinstaller():
    """Compile LLTool using PyInstaller and run.spec."""
    import subprocess
    print("[0/6] Đang biên dịch bản thực thi với PyInstaller (run.spec)...")
    cmd = [sys.executable, "-m", "PyInstaller", "run.spec", "--noconfirm"]
    res = subprocess.run(cmd, cwd=str(ROOT_DIR))
    if res.returncode != 0:
        print("LỖI: Biên dịch PyInstaller thất bại!")
        sys.exit(res.returncode)
    print("      -> Biên dịch PyInstaller thành công!")


def main():
    if "--build" in sys.argv or "--rebuild" in sys.argv:
        build_pyinstaller()
    elif not APP_DIST_DIR.exists() or not (APP_DIST_DIR / "LLTool.exe").exists():
        print(f"Chưa tìm thấy '{APP_DIST_DIR / 'LLTool.exe'}'. Tự động biên dịch PyInstaller...")
        build_pyinstaller()

    print("=================================================================")
    print(f"BẮT ĐẦU ĐÓNG GÓI PHÁT HÀNH VÀ TẠO FILE CẬP NHẬT v{VERSION}")
    print("=================================================================")

    # Step 0: Synchronize workspace updates to dist/LLTool/
    sync_workspace_to_dist()

    # Step 1: Save README_UPDATE.txt to dist/
    readme_path = DIST_DIR / "README_UPDATE.txt"
    readme_content = create_readme_update()
    readme_path.write_text(readme_content, encoding="utf-8")
    print(f"[1/5] Đã tạo file hướng dẫn: {readme_path}")

    # Build archives (pass 1 to obtain realistic file sizes)
    full_zip = build_full_zip()
    patch_zip = build_patch_zip()

    full_size = full_zip.stat().st_size
    patch_size = patch_zip.stat().st_size

    # Update version.json with actual sizes and checksums
    print(f"[4/5] Đồng bộ fileSize và SHA256 vào version.json...")
    vjson_path = ROOT_DIR / "version.json"
    with open(vjson_path, "r", encoding="utf-8") as f:
        vdata = json.load(f)

    vdata["fileSize"] = full_size
    vdata["patchFileName"] = PATCH_ZIP_NAME
    vdata["patchFileSize"] = patch_size

    with open(vjson_path, "w", encoding="utf-8") as f:
        json.dump(vdata, f, indent=2, ensure_ascii=False)

    # Sync version.json into dist/LLTool/
    shutil.copy2(vjson_path, APP_DIST_DIR / "version.json")
    if (APP_DIST_DIR / "_internal").exists():
        shutil.copy2(vjson_path, APP_DIST_DIR / "_internal" / "version.json")

    # Pass 2: Re-generate clean zip archives without any duplicates
    full_zip = build_full_zip()
    patch_zip = build_patch_zip()

    # Re-calculate final exact metrics
    final_full_size = full_zip.stat().st_size
    final_full_sha = calculate_sha256(full_zip)
    final_patch_size = patch_zip.stat().st_size
    final_patch_sha = calculate_sha256(patch_zip)

    vdata["fileSize"] = final_full_size
    vdata["sha256"] = final_full_sha
    vdata["patchFileSize"] = final_patch_size
    vdata["patchSha256"] = final_patch_sha

    with open(vjson_path, "w", encoding="utf-8") as f:
        json.dump(vdata, f, indent=2, ensure_ascii=False)

    shutil.copy2(vjson_path, APP_DIST_DIR / "version.json")
    if (APP_DIST_DIR / "_internal").exists():
        shutil.copy2(vjson_path, APP_DIST_DIR / "_internal" / "version.json")

    # Also save dist/release_v1.1.0_manifest.json
    manifest_path = DIST_DIR / f"release_v{VERSION}_manifest.json"
    manifest_path.write_text(json.dumps(vdata, indent=2, ensure_ascii=False), encoding="utf-8")

    print("[5/5] Hoàn tất quá trình đóng gói sạch!")
    print("-----------------------------------------------------------------")
    print(f"File cập nhật 1 (Bản đầy đủ): {full_zip.name}")
    print(f"  - Đường dẫn : {full_zip}")
    print(f"  - Kích thước: {final_full_size:,} bytes ({final_full_size / (1024*1024):.2f} MB)")
    print(f"  - SHA-256   : {final_full_sha}")
    print(f"File cập nhật 2 (Bản patch): {patch_zip.name}")
    print(f"  - Đường dẫn : {patch_zip}")
    print(f"  - Kích thước: {final_patch_size:,} bytes ({final_patch_size / (1024*1024):.2f} MB)")
    print(f"  - SHA-256   : {final_patch_sha}")
    print(f"File hướng dẫn: {readme_path.name}")
    print(f"Manifest JSON : {manifest_path.name}")
    print("=================================================================")


if __name__ == "__main__":
    main()
