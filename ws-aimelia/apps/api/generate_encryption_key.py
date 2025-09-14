#!/usr/bin/env python3
"""
Generate a Fernet encryption key for token storage.
"""
from cryptography.fernet import Fernet

def generate_key():
    """Generate a new Fernet encryption key."""
    key = Fernet.generate_key()
    print("Generated Fernet encryption key:")
    print(key.decode())
    print("\nAdd this to your environment variables:")
    print(f"ENCRYPTION_KEY={key.decode()}")
    return key.decode()

if __name__ == "__main__":
    generate_key()
