/**
 * Native messaging stub for Think browser extension.
 *
 * Pure C implementation - no Python dependency.
 * Bridges Chrome extension to Think backend via Unix domain socket.
 *
 * Native messaging protocol:
 * - Messages are length-prefixed (4 bytes, little-endian) followed by JSON
 * - stdin: browser -> native host
 * - stdout: native host -> browser
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <pwd.h>
#include <stdint.h>
#include <errno.h>

#define MAX_MESSAGE_SIZE (1024 * 1024)  /* 1MB max message */
#define SOCKET_NAME "native.sock"
#define THINK_DIR ".think"

/**
 * Get the socket path: ~/.think/native.sock
 */
static int get_socket_path(char *buf, size_t size) {
    const char *home = getenv("HOME");
    if (!home) {
        struct passwd *pw = getpwuid(getuid());
        if (!pw) return -1;
        home = pw->pw_dir;
    }
    snprintf(buf, size, "%s/%s/%s", home, THINK_DIR, SOCKET_NAME);
    return 0;
}

/**
 * Write a native messaging response to stdout.
 */
static void write_response(const char *json) {
    uint32_t len = (uint32_t)strlen(json);
    fwrite(&len, sizeof(len), 1, stdout);
    fwrite(json, 1, len, stdout);
    fflush(stdout);
}

/**
 * Write an error response in JSON-RPC format.
 */
static void write_error(int code, const char *message) {
    char buf[1024];
    snprintf(buf, sizeof(buf),
        "{\"id\":null,\"error\":{\"code\":%d,\"message\":\"%s\"}}",
        code, message);
    write_response(buf);
}

/**
 * Read exactly n bytes from a file descriptor.
 */
static ssize_t read_exact(int fd, void *buf, size_t n) {
    size_t total = 0;
    while (total < n) {
        ssize_t r = read(fd, (char *)buf + total, n - total);
        if (r <= 0) return r;
        total += r;
    }
    return total;
}

/**
 * Read exactly n bytes from FILE*.
 */
static size_t fread_exact(void *buf, size_t n, FILE *f) {
    size_t total = 0;
    while (total < n) {
        size_t r = fread((char *)buf + total, 1, n - total, f);
        if (r == 0) return total;
        total += r;
    }
    return total;
}

/**
 * Send exactly n bytes to a socket.
 */
static ssize_t send_exact(int fd, const void *buf, size_t n) {
    size_t total = 0;
    while (total < n) {
        ssize_t r = send(fd, (const char *)buf + total, n - total, 0);
        if (r <= 0) return r;
        total += r;
    }
    return total;
}

int main(int argc, char *argv[]) {
    char socket_path[512];
    struct sockaddr_un addr;
    int sock = -1;
    uint32_t msg_len;
    char *msg_buf = NULL;

    /* Get socket path */
    if (get_socket_path(socket_path, sizeof(socket_path)) != 0) {
        write_error(-32001, "Cannot determine home directory");
        return 1;
    }

    /* Check if socket exists */
    struct stat st;
    if (stat(socket_path, &st) != 0) {
        write_error(-32001, "Think app is not running. Please open the Think app first.");
        return 1;
    }

    /* Connect to backend socket */
    sock = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock < 0) {
        write_error(-32002, "Cannot create socket");
        return 1;
    }

    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);

    if (connect(sock, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        write_error(-32002, "Cannot connect to Think app");
        close(sock);
        return 1;
    }

    /* Allocate message buffer */
    msg_buf = malloc(MAX_MESSAGE_SIZE);
    if (!msg_buf) {
        write_error(-32000, "Out of memory");
        close(sock);
        return 1;
    }

    /* Main loop: read from stdin, forward to socket, return response */
    while (1) {
        /* Read message length from stdin (4 bytes, little-endian) */
        if (fread_exact(&msg_len, 4, stdin) != 4) {
            break;  /* stdin closed, browser disconnected */
        }

        if (msg_len > MAX_MESSAGE_SIZE) {
            write_error(-32000, "Message too large");
            continue;
        }

        /* Read message body from stdin */
        if (fread_exact(msg_buf, msg_len, stdin) != msg_len) {
            break;
        }

        /* Forward to backend: send length + message */
        if (send_exact(sock, &msg_len, 4) != 4 ||
            send_exact(sock, msg_buf, msg_len) != (ssize_t)msg_len) {
            write_error(-32003, "Backend connection lost");
            break;
        }

        /* Read response length from backend */
        if (read_exact(sock, &msg_len, 4) != 4) {
            write_error(-32003, "Backend connection lost");
            break;
        }

        if (msg_len > MAX_MESSAGE_SIZE) {
            write_error(-32000, "Response too large");
            break;
        }

        /* Read response body from backend */
        if (read_exact(sock, msg_buf, msg_len) != (ssize_t)msg_len) {
            write_error(-32003, "Backend connection lost");
            break;
        }

        /* Write response to stdout */
        fwrite(&msg_len, sizeof(msg_len), 1, stdout);
        fwrite(msg_buf, 1, msg_len, stdout);
        fflush(stdout);
    }

    free(msg_buf);
    close(sock);
    return 0;
}
