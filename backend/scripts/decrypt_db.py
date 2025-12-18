#!/usr/bin/env python3
"""Derive the database encryption key from master password.

Usage:
    python decrypt_db.py                           # Uses default salt path for current OS
    python decrypt_db.py --salt-file /path/.salt   # Uses custom salt file
    python decrypt_db.py --salt abc123def456       # Uses salt value directly
"""

import argparse
import hashlib
import os
import platform
import sys
from pathlib import Path
from getpass import getpass


def get_data_dir() -> Path:
    """Get the app data directory for the current platform."""
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Think"
    elif system == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Think"
    else:
        return Path.home() / ".local" / "share" / "Think"


def main():
    parser = argparse.ArgumentParser(
        description="Derive the database encryption key from master password"
    )
    parser.add_argument(
        "--salt-file",
        type=Path,
        help="Path to .salt file"
    )
    parser.add_argument(
        "--salt",
        type=str,
        help="Salt value directly (32 hex characters)"
    )
    args = parser.parse_args()

    # Determine salt value
    if args.salt:
        salt = args.salt.strip()
        print(f"Using provided salt: {salt}")
    elif args.salt_file:
        if not args.salt_file.exists():
            print(f"Salt file not found: {args.salt_file}", file=sys.stderr)
            sys.exit(1)
        salt = args.salt_file.read_bytes().decode('ascii').strip()
        print(f"Salt from file {args.salt_file}: {salt}")
    else:
        salt_path = get_data_dir() / ".salt"
        print(f"Using default salt path: {salt_path}")
        if not salt_path.exists():
            print(f"Salt file not found: {salt_path}", file=sys.stderr)
            sys.exit(1)
        salt = salt_path.read_bytes().decode('ascii').strip()
        print(f"Salt value: {salt}")

    password = getpass("Master password: ")

    key = hashlib.pbkdf2_hmac(
        'sha256', password.encode(), salt.encode(), 100000
    ).hex()

    print(f"\nDerived key (use this in DB Browser for SQLite):\n{key}")


if __name__ == "__main__":
    main()
