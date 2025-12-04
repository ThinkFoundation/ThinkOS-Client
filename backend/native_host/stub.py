#!/usr/bin/env python3
"""
Native messaging stub for Think browser extension.

This minimal script bridges the browser extension to the Think backend
via Unix domain socket. It reads messages from stdin (native messaging protocol)
and forwards them to the backend's socket server.

Native messaging protocol:
- Messages are length-prefixed (4 bytes, little-endian) followed by JSON
- stdin: browser -> native host
- stdout: native host -> browser
"""

import json
import socket
import struct
import sys
from pathlib import Path

# Socket path must match backend/app/native_messaging.py
SOCKET_PATH = Path.home() / ".think" / "native.sock"


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


def send_to_backend(sock, message):
    """Send message to backend and receive response."""
    # Send length-prefixed message
    encoded = json.dumps(message).encode("utf-8")
    sock.sendall(struct.pack("<I", len(encoded)))
    sock.sendall(encoded)

    # Receive response length
    length_bytes = sock.recv(4)
    if len(length_bytes) < 4:
        raise ConnectionError("Backend closed connection")

    length = struct.unpack("<I", length_bytes)[0]

    # Receive response body
    response_bytes = b""
    while len(response_bytes) < length:
        chunk = sock.recv(length - len(response_bytes))
        if not chunk:
            raise ConnectionError("Backend closed connection")
        response_bytes += chunk

    return json.loads(response_bytes.decode("utf-8"))


def main():
    """Main entry point."""
    # Check if socket exists
    if not SOCKET_PATH.exists():
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

    # Connect to backend socket
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(SOCKET_PATH))
    except socket.error as e:
        write_message(
            {
                "id": None,
                "error": {
                    "code": -32002,
                    "message": f"Cannot connect to Think app: {e}",
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
                response = send_to_backend(sock, message)
                write_message(response)
            except ConnectionError as e:
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
        sock.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
