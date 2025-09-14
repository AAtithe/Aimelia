#!/usr/bin/env python3
"""
Generate a Fernet encryption key for token storage.
Add this key to your .env file as ENCRYPTION_KEY.
"""
from cryptography.fernet import Fernet

def generate_key():
    """Generate a new Fernet encryption key."""
    key = Fernet.generate_key()
    print("🔐 Generated Fernet encryption key:")
    print(f"ENCRYPTION_KEY={key.decode()}")
    print("\n📝 Add this to your .env file:")
    print(f"echo 'ENCRYPTION_KEY={key.decode()}' >> .env")

if __name__ == "__main__":
    generate_key()
