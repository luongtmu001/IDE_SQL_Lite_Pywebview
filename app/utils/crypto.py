import os
from pathlib import Path
from cryptography.fernet import Fernet

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
KEY_FILE = DATA_DIR / ".secret.key"

def _get_fernet():
    if not KEY_FILE.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        KEY_FILE.write_bytes(key)
    else:
        key = KEY_FILE.read_bytes()
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
