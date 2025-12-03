#!/usr/bin/env python3
"""Derive the database encryption key from master password."""

import hashlib
import sys
from pathlib import Path
from getpass import getpass


def get_data_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / "Think"


def main():
    salt_path = get_data_dir() / ".salt"

    if not salt_path.exists():
        print(f"Salt file not found: {salt_path}", file=sys.stderr)
        sys.exit(1)

    salt = salt_path.read_text().strip()
    password = getpass("Master password: ")

    key = hashlib.pbkdf2_hmac(
        'sha256', password.encode(), salt.encode(), 100000
    ).hex()

    print(key)


if __name__ == "__main__":
    main()
