# -*- coding: utf-8 -*-
"""
Tests for app.utils.crypto (Phase 2):
- DPAPI round-trip encryption (ENC2:)
- Legacy Fernet token decryption (ENC:)
- CredentialDecryptError on invalid cipher
- Automatic password upgrade from ENC: to ENC2:
"""
import pytest
from cryptography.fernet import Fernet
from app.utils.crypto import (
    encrypt_password,
    decrypt_password,
    upgrade_encrypted_password,
    CredentialDecryptError,
    _get_fernet,
)


def test_crypto_round_trip():
    """Verify password encryption produces ENC2: and decrypts back to original."""
    plaintext = "P@ssw0rd!_Test_2026"
    encrypted = encrypt_password(plaintext)
    assert encrypted.startswith("ENC2:")
    assert encrypted != plaintext

    decrypted = decrypt_password(encrypted)
    assert decrypted == plaintext


def test_crypto_legacy_enc_format():
    """Verify backwards compatibility reading legacy ENC: Fernet format."""
    plaintext = "Legacy_MSSQL_Password#456"
    f = _get_fernet()
    legacy_token = f.encrypt(plaintext.encode("utf-8")).decode("ascii")
    legacy_enc = f"ENC:{legacy_token}"

    decrypted = decrypt_password(legacy_enc)
    assert decrypted == plaintext


def test_crypto_corrupted_payload_raises():
    """Verify that malformed or corrupted ciphertext raises CredentialDecryptError."""
    with pytest.raises(CredentialDecryptError):
        decrypt_password("ENC2:ThisIsDefinitelyNotAValidCipherBlob==")

    with pytest.raises(CredentialDecryptError):
        decrypt_password("ENC:CorruptedFernetTokenPayload")


def test_crypto_upgrade_legacy_password():
    """Verify upgrade_encrypted_password transforms ENC: into ENC2:."""
    plaintext = "UpgradeMePlease_789"
    f = _get_fernet()
    legacy_token = f.encrypt(plaintext.encode("utf-8")).decode("ascii")
    legacy_enc = f"ENC:{legacy_token}"

    upgraded = upgrade_encrypted_password(legacy_enc)
    assert upgraded.startswith("ENC2:")
    assert decrypt_password(upgraded) == plaintext


def test_crypto_plaintext_and_empty():
    """Verify unencrypted and empty strings are passed through safely."""
    assert encrypt_password("") == ""
    assert decrypt_password("") == ""
    assert decrypt_password(None) is None
    assert decrypt_password("PlainUnencryptedPassword") == "PlainUnencryptedPassword"
