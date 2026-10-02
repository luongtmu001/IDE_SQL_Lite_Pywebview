import os
from pathlib import Path
from cryptography.fernet import Fernet

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
KEY_FILE = DATA_DIR / ".secret.key"

def _resolve_key_file():
    global DATA_DIR, KEY_FILE
    if KEY_FILE.exists():
        return KEY_FILE
    import sys
    if getattr(sys, 'frozen', False):
        app_dir = Path(sys.executable).resolve().parent
        alt_key = app_dir / "data" / ".secret.key"
        if alt_key.exists():
            DATA_DIR = app_dir / "data"
            KEY_FILE = alt_key
            return KEY_FILE
        alt_int = app_dir / "_internal" / "data" / ".secret.key"
        if alt_int.exists():
            return alt_int
    return KEY_FILE

def _get_fernet():
    key_path = _resolve_key_file()
    if not key_path.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        key_path.write_bytes(key)
    else:
        key = key_path.read_bytes()
    return Fernet(key)

def encrypt_password(password: str) -> str:
    if not password:
        return password
    f = _get_fernet()
    encrypted = f.encrypt(password.encode("utf-8"))
    return f"ENC:{encrypted.decode('utf-8')}"

def decrypt_password(encrypted_password: str) -> str:
    if not encrypted_password or not encrypted_password.startswith("ENC:"):
        return encrypted_password
    try:
        f = _get_fernet()
        token = encrypted_password[4:]
        decrypted = f.decrypt(token.encode("utf-8")).decode("utf-8")
        return decrypted
    except Exception:
        return encrypted_password
