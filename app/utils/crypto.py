# -*- coding: utf-8 -*-
"""
Cryptographic module for password storage and retrieval.
Supports Windows DPAPI via ctypes with fallback to Fernet key files.
Format:
- ENC2:<base64_payload> (DPAPI encrypted)
- ENC2:F:<base64_payload> (Fernet fallback encrypted)
- ENC:<legacy_fernet_payload> (Legacy format, supported for backwards compatibility)
"""
import base64
import logging
import os
import sys
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet
from app.utils.paths import get_user_data_dir, get_app_dir

logger = logging.getLogger("app.utils.crypto")


class CredentialDecryptError(Exception):
    """Raised when an encrypted credential cannot be decrypted."""
    pass


# ---------------------------------------------------------------------------
# Windows DPAPI Implementation via ctypes
# ---------------------------------------------------------------------------
_HAS_DPAPI = False
if sys.platform == "win32":
    try:
        import ctypes
        from ctypes import wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte)),
            ]

        _HAS_DPAPI = True
    except Exception as exc:
        logger.warning("[Crypto] Could not initialize ctypes for DPAPI: %s", exc)


def _dpapi_encrypt(data: bytes, descr: str = "LLTool_Secret") -> bytes:
    """Encrypt byte data using Windows DPAPI CryptProtectData."""
    if not _HAS_DPAPI:
        raise OSError("DPAPI is only available on Windows")

    data_in = DATA_BLOB(
        len(data),
        ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_byte)),
    )
    data_out = DATA_BLOB()
    # CRYPTPROTECT_UI_FORBIDDEN = 0x1
    ok = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(data_in), descr, None, None, None, 0x1, ctypes.byref(data_out)
    )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(data_out.pbData, data_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(data_out.pbData)


def _dpapi_decrypt(cipher: bytes) -> bytes:
    """Decrypt byte data using Windows DPAPI CryptUnprotectData."""
    if not _HAS_DPAPI:
        raise OSError("DPAPI is only available on Windows")

    data_in = DATA_BLOB(
        len(cipher),
        ctypes.cast(ctypes.create_string_buffer(cipher), ctypes.POINTER(ctypes.c_byte)),
    )
    data_out = DATA_BLOB()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(data_in), None, None, None, None, 0x1, ctypes.byref(data_out)
    )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(data_out.pbData, data_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(data_out.pbData)


# ---------------------------------------------------------------------------
# Fallback Fernet key file management
# ---------------------------------------------------------------------------
def _resolve_key_file() -> Path:
    """Resolve location of .secret.key file for legacy or fallback encryption."""
    user_key = get_user_data_dir() / ".secret.key"
    if user_key.exists():
        return user_key

    # Check application source or frozen data directory
    app_key = get_app_dir() / "data" / ".secret.key"
    if app_key.exists():
        return app_key

    alt_int = get_app_dir() / "_internal" / "data" / ".secret.key"
    if alt_int.exists():
        return alt_int

    return user_key


def _get_fernet() -> Fernet:
    """Return Fernet cipher initialized from .secret.key file."""
    key_path = _resolve_key_file()
    if not key_path.exists():
        logger.warning("[Crypto] Generating fallback .secret.key at %s", key_path)
        key_path.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        key_path.write_bytes(key)
    else:
        key = key_path.read_bytes().strip()
    return Fernet(key)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def encrypt_password(password: str) -> str:
    """
    Encrypt a plaintext password.
    Prefers Windows DPAPI (ENC2: prefix), falls back to Fernet (ENC2:F: prefix).
    """
    if not password:
        return password

    pw_bytes = password.encode("utf-8")

    # Priority 1: Windows DPAPI
    if _HAS_DPAPI:
        try:
            cipher = _dpapi_encrypt(pw_bytes)
            b64 = base64.b64encode(cipher).decode("ascii")
            return f"ENC2:{b64}"
        except Exception as exc:
            logger.warning("[Crypto] DPAPI encryption failed (%s), falling back to file key", exc)

    # Priority 2: Fallback Fernet
    logger.warning("[Crypto] Using fallback file-based Fernet encryption for password")
    f = _get_fernet()
    encrypted = f.encrypt(pw_bytes).decode("ascii")
    return f"ENC2:F:{encrypted}"


def decrypt_password(encrypted_password: str) -> str:
    """
    Decrypt an encrypted password string.
    Supports ENC2: (DPAPI or Fernet fallback) and legacy ENC: (Fernet).
    Raises CredentialDecryptError on decryption failure.
    """
    if not encrypted_password or not isinstance(encrypted_password, str):
        return encrypted_password

    # Unencrypted string
    if not (encrypted_password.startswith("ENC2:") or encrypted_password.startswith("ENC:")):
        return encrypted_password

    # Format: ENC2:F:<fernet_token> (Explicit Fernet fallback)
    if encrypted_password.startswith("ENC2:F:"):
        token = encrypted_password[7:]
        try:
            f = _get_fernet()
            return f.decrypt(token.encode("ascii")).decode("utf-8")
        except Exception as exc:
            raise CredentialDecryptError(f"Failed to decrypt Fernet fallback credential: {exc}") from exc

    # Format: ENC2:<base64_dpapi_cipher>
    if encrypted_password.startswith("ENC2:"):
        token = encrypted_password[5:]
        try:
            raw_cipher = base64.b64decode(token)
            if _HAS_DPAPI:
                decrypted = _dpapi_decrypt(raw_cipher)
                return decrypted.decode("utf-8")
        except Exception as dpapi_exc:
            # Attempt Fernet as a secondary fallback if someone saved Fernet under ENC2:
            try:
                f = _get_fernet()
                return f.decrypt(token.encode("ascii")).decode("utf-8")
            except Exception:
                raise CredentialDecryptError(f"Failed to decrypt DPAPI credential: {dpapi_exc}") from dpapi_exc
        raise CredentialDecryptError("DPAPI decryption unavailable on this platform.")

    # Format: ENC:<legacy_fernet_token>
    if encrypted_password.startswith("ENC:"):
        token = encrypted_password[4:]
        try:
            f = _get_fernet()
            return f.decrypt(token.encode("ascii")).decode("utf-8")
        except Exception as exc:
            raise CredentialDecryptError(f"Failed to decrypt legacy ENC credential: {exc}") from exc

    return encrypted_password


def upgrade_encrypted_password(raw_password: str) -> str:
    """
    If password is in legacy ENC: format, decrypt and re-encrypt as ENC2:.
    If already ENC2: or plain, return as is.
    """
    if not raw_password or not isinstance(raw_password, str):
        return raw_password
    if raw_password.startswith("ENC:"):
        try:
            decrypted = decrypt_password(raw_password)
            return encrypt_password(decrypted)
        except Exception as exc:
            logger.warning("[Crypto] Could not upgrade legacy password: %s", exc)
    return raw_password
