"""Shared authenticated encryption. Passwords and OTPs are hashed by auth adapters."""
from cryptography.fernet import Fernet


def encrypt_secret(value: str, key: str) -> str:
    return Fernet(key.encode()).encrypt(value.encode()).decode()


def decrypt_secret(value: str, key: str) -> str:
    return Fernet(key.encode()).decrypt(value.encode()).decode()
