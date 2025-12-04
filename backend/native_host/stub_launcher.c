/**
 * Thin native messaging stub launcher.
 *
 * This small binary launches stub.py with the system Python interpreter.
 * It avoids bundling libpython, which causes macOS Gatekeeper warnings.
 *
 * The launcher:
 * 1. Finds its own executable path
 * 2. Locates stub.py in the same directory
 * 3. Finds python3 in common locations
 * 4. Executes python3 with stub.py
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <libgen.h>
#include <mach-o/dyld.h>
#include <sys/stat.h>

#define MAX_PATH 4096

/* Common Python 3 locations on macOS */
static const char *python_paths[] = {
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    NULL
};

/**
 * Check if a file exists and is executable.
 */
static int file_exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0 && (st.st_mode & S_IXUSR);
}

/**
 * Find python3 executable.
 */
static const char *find_python(void) {
    /* Check common paths first */
    for (int i = 0; python_paths[i] != NULL; i++) {
        if (file_exists(python_paths[i])) {
            return python_paths[i];
        }
    }

    /* Fall back to PATH lookup */
    return "python3";
}

/**
 * Get the directory containing this executable.
 */
static int get_exe_dir(char *buf, size_t size) {
    uint32_t bufsize = (uint32_t)size;

    if (_NSGetExecutablePath(buf, &bufsize) != 0) {
        return -1;
    }

    /* Resolve symlinks */
    char resolved[MAX_PATH];
    if (realpath(buf, resolved) == NULL) {
        return -1;
    }

    /* Get directory */
    char *dir = dirname(resolved);
    strncpy(buf, dir, size - 1);
    buf[size - 1] = '\0';

    return 0;
}

int main(int argc, char *argv[]) {
    char exe_dir[MAX_PATH];
    char stub_path[MAX_PATH];
    const char *python;

    /* Get directory containing this executable */
    if (get_exe_dir(exe_dir, sizeof(exe_dir)) != 0) {
        fprintf(stderr, "Failed to get executable directory\n");
        return 1;
    }

    /* Build path to stub.py */
    snprintf(stub_path, sizeof(stub_path), "%s/stub.py", exe_dir);

    /* Check stub.py exists */
    if (!file_exists(stub_path)) {
        fprintf(stderr, "stub.py not found at: %s\n", stub_path);
        return 1;
    }

    /* Find Python */
    python = find_python();

    /* Execute Python with stub.py */
    execl(python, "python3", stub_path, (char *)NULL);

    /* If execl returns, it failed */
    perror("Failed to execute python3");
    return 1;
}
