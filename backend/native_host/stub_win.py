#!/usr/bin/env python3
"""
Native messaging stub for Think browser extension (Windows version).

This minimal script bridges the browser extension to the Think backend
via Windows named pipes. It reads messages from stdin (native messaging protocol)
and forwards them to the backend's named pipe server.

Native messaging protocol:
- Messages are length-prefixed (4 bytes, little-endian) followed by JSON
- stdin: browser -> native host
- stdout: native host -> browser
"""

import json
import struct
import sys

# Only import win32 modules on Windows
try:
    import win32file
    import win32pipe
    import pywintypes
except ImportError:
    print("This script requires pywin32. Install with: pip install pywin32", file=sys.stderr)
    sys.exit(1)

# Named pipe path must match backend/app/native_messaging.py
PIPE_NAME = r"\\.\pipe\think-native"


def read_message():
    """Read a native messaging message from stdin."""
    # Read 4-byte length prefix (little-endian unsigned int)
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None

    length = struct.unpack("<I", raw_length)[0]

    # Read message body
    message = sys.stdin.buffer.read(length)
    if len(message) < length:
        return None

    return json.loads(message.decode("utf-8"))


def write_message(message):
    """Write a native messaging message to stdout."""
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def connect_to_pipe():
    """Connect to the backend's named pipe."""
    try:
        handle = win32file.CreateFile(
            PIPE_NAME,
            win32file.GENERIC_READ | win32file.GENERIC_WRITE,
            0,  # No sharing
            None,  # Default security
            win32file.OPEN_EXISTING,
            0,  # Default attributes
            None,  # No template
        )
        return handle
    except pywintypes.error as e:
        return None


def send_to_backend(handle, message):
    """Send message to backend and receive response."""
    # Send length-prefixed message
    encoded = json.dumps(message).encode("utf-8")
    length_bytes = struct.pack("<I", len(encoded))

    win32file.WriteFile(handle, length_bytes)
    win32file.WriteFile(handle, encoded)

    # Receive response length
    _, length_bytes = win32file.ReadFile(handle, 4)
    if len(length_bytes) < 4:
        raise ConnectionError("Backend closed connection")

    length = struct.unpack("<I", length_bytes)[0]

    # Receive response body
    _, response_bytes = win32file.ReadFile(handle, length)
    if len(response_bytes) < length:
        raise ConnectionError("Backend closed connection")

    return json.loads(response_bytes.decode("utf-8"))


def main():
    """Main entry point."""
    # Connect to backend pipe
    handle = connect_to_pipe()
    if handle is None:
        write_message(
            {
                "id": None,
                "error": {
                    "code": -32001,
                    "message": "Think app is not running. Please open the Think app first.",
                },
            }
        )
        return 1

    try:
        # Process messages in a loop
        while True:
            message = read_message()
            if message is None:
                # stdin closed, browser disconnected
                break

            try:
                response = send_to_backend(handle, message)
                write_message(response)
            except (ConnectionError, pywintypes.error) as e:
                write_message(
                    {
                        "id": message.get("id"),
                        "error": {
                            "code": -32003,
                            "message": f"Backend connection lost: {e}",
                        },
                    }
                )
                break
            except Exception as e:
                write_message(
                    {
                        "id": message.get("id"),
                        "error": {
                            "code": -32000,
                            "message": str(e),
                        },
                    }
                )

    finally:
        win32file.CloseHandle(handle)

    return 0


if __name__ == "__main__":
    sys.exit(main())
