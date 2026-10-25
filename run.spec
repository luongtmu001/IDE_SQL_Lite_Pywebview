# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec file for luoBTool IDE / LLTool Desktop Native App.
Configured for PyWebView + PythonNet + WebView2 runtime.
"""
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

BASE_PATH = os.path.abspath(SPECPATH)
import sys
if BASE_PATH not in sys.path:
    sys.path.insert(0, BASE_PATH)
try:
    from app.version import __version__, __app_name__
except Exception:
    __version__ = "1.0.0"
    __app_name__ = "luoBTool IDE"

# -------------------------------------------------------------
# 1. Datas Collection (Templates, Static assets, Configs, Data)
# -------------------------------------------------------------
datas = [
    (os.path.join(BASE_PATH, 'templates'), 'templates'),
    (os.path.join(BASE_PATH, 'static'), 'static'),
    (os.path.join(BASE_PATH, 'settings'), 'settings'),
    (os.path.join(BASE_PATH, 'logo.ico'), '.'),
]

version_json_path = os.path.join(BASE_PATH, 'version.json')
if os.path.exists(version_json_path):
    datas.append((version_json_path, '.'))

# Bundle Microsoft ScriptDOM DLL for offline syntax checking on client machines
scriptdom_dir = os.path.join(BASE_PATH, 'app', 'database', 'syntax', 'bin')
if os.path.exists(scriptdom_dir):
    datas.append((scriptdom_dir, 'app/database/syntax/bin'))

# Bundle app/data (e.g. syntax catalog database)
app_data_dir = os.path.join(BASE_PATH, 'app', 'data')
if os.path.exists(app_data_dir):
    datas.append((app_data_dir, 'app/data'))

# Include ONLY safe default data files (snippets, code_styles, default settings)
# Exclude sensitive user credentials and DBs: connections.json, programlist.json, history.db, .secret.key
ALLOWED_DEFAULT_DATA_FILES = {'snippets.json', 'code_styles.json', 'settings.json'}
data_dir = os.path.join(BASE_PATH, 'data')
if os.path.exists(data_dir):
    for f in os.listdir(data_dir):
        if f in ALLOWED_DEFAULT_DATA_FILES:
            full_path = os.path.join(data_dir, f)
            if os.path.isfile(full_path):
                datas.append((full_path, 'data'))

# Collect library data files (WebView2 JS files, pythonnet assemblies, etc.)
datas += collect_data_files('webview')
datas += collect_data_files('pythonnet')
datas += collect_data_files('clr_loader')
datas += collect_data_files('sqlglot')
datas += collect_data_files('openpyxl')

# -------------------------------------------------------------
# 2. Dynamic Libraries / Binaries (WebView2, PythonNet, CLR)
# -------------------------------------------------------------
binaries = []
binaries += collect_dynamic_libs('webview')
binaries += collect_dynamic_libs('pythonnet')
binaries += collect_dynamic_libs('clr_loader')

scriptdom_dll = os.path.join(scriptdom_dir, 'Microsoft.SqlServer.TransactSql.ScriptDom.dll')
if os.path.exists(scriptdom_dll):
    binaries.append((scriptdom_dll, 'app/database/syntax/bin'))
    binaries.append((scriptdom_dll, '.'))

# -------------------------------------------------------------
# 3. Hidden Imports (Runtime dynamic imports)
# -------------------------------------------------------------
hiddenimports = [
    # PyWebView & Platforms
    'webview',
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
    'webview.guilib',
    'webview.screen',
    'webview.util',
    'webview.window',
    'webview.menu',
    'webview.event',
    # CLR / PythonNet
    'clr',
    'clr_loader',
    'pythonnet',
    # Database Drivers
    'pyodbc',
    'psycopg',
    'psycopg_binary',
    'psycopg2',
    'sqlite3',
    # Cryptography
    'cryptography',
    'cryptography.fernet',
    'cryptography.hazmat.backends.openssl',
    # SQL Parser / Syntax
    'sqlglot',
    'sqlglot.dialects',
    'sqlglot.dialects.tsql',
    'sqlglot.dialects.postgres',
    'sqlglot.dialects.sqlite',
    'sqlglot.dialects.mysql',
    # Excel
    'openpyxl',
    'openpyxl.cell._writer',
    'et_xmlfile',
    # Application packages
    'app',
    'app.database',
    'app.database.base',
    'app.database.factory',
    'app.database.sqlserver',
    'app.database.postgresql',
    'app.database.sqlite',
    'app.database.syntax',
    'app.database.syntax.validator',
    'app.services',
    'app.services.connection_manager',
    'app.services.table_designer_service',
    'app.services.table_data_editor_service',
    'app.services.schema_compare_service',
    'app.services.google_sheets',
    'app.api.schema_compare_api',
    'app.api.google_sheets_api',
    'app.api.database_users_api',
    'app.api.syntax_catalog_api',
    'app.api.report_gen_api',
    'app.routes.report_gen',
    'app.services.report_layout_gen',
    'app.services.report_layout_gen.service',
    'app.services.report_layout_gen.session_store',
    'app.services.report_layout_gen.workbook_reader',
    'app.services.report_layout_gen.layout_reader',
    'app.services.report_layout_gen.layout_builder',
    'app.services.report_layout_gen.datasource_builder',
    'app.services.report_layout_gen.column_mapper',
    'app.services.report_layout_gen.region_detector',
    'app.services.report_layout_gen.gsheet_importer',
    'app.services.report_layout_gen.userdata',
    'app.services.report_layout_gen.units',
    'app.services.report_layout_gen.result_shape',
    'app.services.database_users',
    'app.services.syntax_catalog',
    'app.services.syntax_catalog.service',
    'app.bravo',
    'app.bravo.api',
    'app.bravo.xml_codec',
    'app.utils',
    'app.utils.crypto',
    'app.utils.dwm',
    'app.utils.system_fonts',
    'config',
    'main',
]
hiddenimports += collect_submodules('app')

# -------------------------------------------------------------
# 4. Excluded packages (to minimize size and build time)
# -------------------------------------------------------------
excludes = [
    'tkinter',
    '_tkinter',
    'unittest',
    'pytest',
    'PyQt5',
    'PyQt6',
    'PySide6',
    'IPython',
    'jupyter',
    'matplotlib',
    'pandas',
    'numpy',
    'scipy',
]

# -------------------------------------------------------------
# 5. Analysis
# -------------------------------------------------------------
a = Analysis(
    ['run.py'],
    pathex=[BASE_PATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

icon_path = os.path.join(BASE_PATH, 'logo.ico')
icon_file = [icon_path] if os.path.exists(icon_path) else None

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='LLTool',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX often breaks .NET / WebView2 runtime DLLs
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_file,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='LLTool',
)
