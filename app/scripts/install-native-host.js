/**
 * Native Host Manifest Installation Script
 *
 * Installs native messaging host manifests for Chrome, Firefox, and Edge
 * to enable secure communication between the Think browser extension
 * and the desktop application.
 *
 * This script is called during Electron app startup.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Extension IDs - update these when publishing to browser stores
// During development, Chrome assigns a dynamic ID based on the extension path
// To find your dev extension ID: chrome://extensions -> copy the ID shown under your extension
//
// You can also set THINK_EXTENSION_IDS environment variable (comma-separated)
// e.g., THINK_EXTENSION_IDS=abcdefg,hijklmn
const CHROME_EXTENSION_IDS = process.env.THINK_EXTENSION_IDS
  ? process.env.THINK_EXTENSION_IDS.split(',').map(id => id.trim()).filter(Boolean)
  : [
      // Stable extension ID (generated from public key in manifest.json)
      'ddkjmfghdikcpfnemhpecpmiajjhghoi',
    ];

// Firefox extension ID (must match browser_specific_settings.gecko.id in manifest.json)
const FIREFOX_EXTENSION_ID = 'think@thinkapp.dev';

const NATIVE_HOST_NAME = 'com.think.native';

/**
 * Get the paths to native messaging host directories for each browser.
 */
function getManifestDirectories() {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return {
      chrome: path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      chromium: path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts'),
      firefox: path.join(home, 'Library/Application Support/Mozilla/NativeMessagingHosts'),
      edge: path.join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
    };
  } else if (platform === 'linux') {
    return {
      chrome: path.join(home, '.config/google-chrome/NativeMessagingHosts'),
      chromium: path.join(home, '.config/chromium/NativeMessagingHosts'),
      firefox: path.join(home, '.mozilla/native-messaging-hosts'),
      edge: path.join(home, '.config/microsoft-edge/NativeMessagingHosts'),
    };
  } else if (platform === 'win32') {
    // Windows uses registry - handled separately
    return null;
  }

  return null;
}

/**
 * Get the absolute path to python3.
 * Chrome launches native hosts with minimal PATH, so we need absolute paths.
 */
function getPythonPath() {
  const { execSync } = require('child_process');

  try {
    // Try pyenv first (common on macOS)
    const pyenvPath = execSync('pyenv which python3 2>/dev/null', { encoding: 'utf8' }).trim();
    if (pyenvPath && fs.existsSync(pyenvPath)) {
      return pyenvPath;
    }
  } catch {
    // pyenv not available
  }

  try {
    // Fall back to which python3
    const whichPath = execSync('which python3', { encoding: 'utf8' }).trim();
    // If it's a shim, try to resolve the actual binary
    if (whichPath.includes('shims')) {
      const realPath = execSync('python3 -c "import sys; print(sys.executable)"', { encoding: 'utf8' }).trim();
      if (realPath && fs.existsSync(realPath)) {
        return realPath;
      }
    }
    return whichPath;
  } catch {
    // Fallback to generic python3
    return 'python3';
  }
}

/**
 * Get the path to the native host stub executable.
 * Uses thin C binary (no bundled Python) to avoid Gatekeeper warnings.
 */
function getStubPath(resourcesPath, isDev = false) {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';

  // Both dev and production: use thin native binary from native_host/
  const binaryPath = path.join(resourcesPath, 'backend', 'native_host', `think-native-stub${ext}`);

  if (fs.existsSync(binaryPath)) {
    console.log(`[Native Host] Using thin binary: ${binaryPath}`);
    return binaryPath;
  }

  // Fallback: use Python script directly (requires macOS security approval)
  console.log('[Native Host] Binary not found, falling back to Python script');
  const stubPy = path.join(resourcesPath, 'backend', 'native_host', 'stub.py');

  // Ensure stub.py is executable
  try {
    fs.chmodSync(stubPy, 0o755);
  } catch (e) {
    console.error('[Native Host] Failed to make stub.py executable:', e.message);
  }

  return stubPy;
}

/**
 * Create Chrome/Edge manifest content.
 */
function createChromeManifest(stubPath, extensionIds) {
  const allowedOrigins = extensionIds.map(id => `chrome-extension://${id}/`);

  return {
    name: NATIVE_HOST_NAME,
    description: 'Think Native Messaging Host - Secure communication between Think browser extension and desktop app',
    path: stubPath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };
}

/**
 * Create Firefox manifest content.
 */
function createFirefoxManifest(stubPath) {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Think Native Messaging Host - Secure communication between Think browser extension and desktop app',
    path: stubPath,
    type: 'stdio',
    allowed_extensions: [FIREFOX_EXTENSION_ID],
  };
}

/**
 * Install manifest file to a directory.
 */
function installManifest(directory, manifest) {
  try {
    // Create directory if it doesn't exist
    fs.mkdirSync(directory, { recursive: true });

    const manifestPath = path.join(directory, `${NATIVE_HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`[Native Host] Installed manifest to ${manifestPath}`);
    return true;
  } catch (error) {
    console.error(`[Native Host] Failed to install manifest to ${directory}:`, error.message);
    return false;
  }
}

/**
 * Install Windows registry entries.
 */
function installWindowsRegistry(stubPath, extensionIds) {
  // Windows requires registry entries instead of manifest files
  // This uses the 'winreg' module - install with: npm install winreg

  let Registry;
  try {
    Registry = require('winreg');
  } catch (e) {
    console.error('[Native Host] winreg module not found. Install with: npm install winreg');
    console.error('[Native Host] Skipping Windows registry installation');
    return;
  }

  const browsers = [
    { name: 'Chrome', key: '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + NATIVE_HOST_NAME },
    { name: 'Edge', key: '\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' + NATIVE_HOST_NAME },
  ];

  for (const browser of browsers) {
    try {
      const regKey = new Registry({
        hive: Registry.HKCU,
        key: browser.key,
      });

      // Create manifest file in app directory
      const manifestDir = path.dirname(stubPath);
      const manifestPath = path.join(manifestDir, `${NATIVE_HOST_NAME}.json`);

      const manifest = createChromeManifest(stubPath, extensionIds);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Point registry to manifest file
      regKey.set('', Registry.REG_SZ, manifestPath, (err) => {
        if (err) {
          console.error(`[Native Host] Failed to set registry for ${browser.name}:`, err);
        } else {
          console.log(`[Native Host] Installed registry entry for ${browser.name}`);
        }
      });
    } catch (error) {
      console.error(`[Native Host] Failed to install registry for ${browser.name}:`, error.message);
    }
  }

  // Firefox on Windows also uses registry
  try {
    const firefoxKey = new Registry({
      hive: Registry.HKCU,
      key: '\\Software\\Mozilla\\NativeMessagingHosts\\' + NATIVE_HOST_NAME,
    });

    const manifestDir = path.dirname(stubPath);
    const manifestPath = path.join(manifestDir, `${NATIVE_HOST_NAME}.firefox.json`);

    const manifest = createFirefoxManifest(stubPath);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    firefoxKey.set('', Registry.REG_SZ, manifestPath, (err) => {
      if (err) {
        console.error('[Native Host] Failed to set registry for Firefox:', err);
      } else {
        console.log('[Native Host] Installed registry entry for Firefox');
      }
    });
  } catch (error) {
    console.error('[Native Host] Failed to install registry for Firefox:', error.message);
  }
}

/**
 * Main installation function.
 * @param {string} resourcesPath - Path to Electron app resources directory
 * @param {string[]} extensionIds - Chrome/Edge extension IDs to allow
 * @param {boolean} isDev - Whether running in development mode
 */
function installNativeHost(resourcesPath, extensionIds = CHROME_EXTENSION_IDS, isDev = false) {
  console.log('[Native Host] Installing native messaging host manifests...');

  const stubPath = getStubPath(resourcesPath, isDev);

  // Check if stub (or source script in dev mode) exists
  const checkPath = isDev
    ? path.join(resourcesPath, 'backend', 'native_host', 'stub.py')
    : stubPath;

  if (!fs.existsSync(checkPath)) {
    console.warn(`[Native Host] Stub not found at ${checkPath}, skipping installation`);
    return false;
  }

  // Make stub executable on Unix-like systems
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(stubPath, 0o755);
    } catch (error) {
      console.error('[Native Host] Failed to set stub permissions:', error.message);
    }
  }

  if (process.platform === 'win32') {
    installWindowsRegistry(stubPath, extensionIds);
    return true;
  }

  const directories = getManifestDirectories();
  if (!directories) {
    console.warn('[Native Host] Unsupported platform:', process.platform);
    return false;
  }

  // Install to each browser directory
  let installed = 0;

  // Chrome-based browsers (Chrome, Chromium, Edge) - only if extension IDs are provided
  if (extensionIds.length > 0) {
    const chromeManifest = createChromeManifest(stubPath, extensionIds);
    for (const browser of ['chrome', 'chromium', 'edge']) {
      if (directories[browser]) {
        if (installManifest(directories[browser], chromeManifest)) {
          installed++;
        }
      }
    }
  } else {
    console.warn('[Native Host] No Chrome extension IDs configured. Skipping Chrome/Edge manifest installation.');
    console.warn('[Native Host] Set THINK_EXTENSION_IDS env var or add IDs to install-native-host.js');
  }

  // Firefox manifest
  const firefoxManifest = createFirefoxManifest(stubPath);

  // Firefox
  if (directories.firefox) {
    if (installManifest(directories.firefox, firefoxManifest)) {
      installed++;
    }
  }

  console.log(`[Native Host] Installation complete. ${installed} manifests installed.`);
  return installed > 0;
}

/**
 * Uninstall native messaging host manifests.
 * @param {string} resourcesPath - Path to Electron app resources directory
 */
function uninstallNativeHost(resourcesPath) {
  console.log('[Native Host] Uninstalling native messaging host manifests...');

  if (process.platform === 'win32') {
    // Remove Windows registry entries
    const Registry = require('winreg');

    const keys = [
      '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + NATIVE_HOST_NAME,
      '\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' + NATIVE_HOST_NAME,
      '\\Software\\Mozilla\\NativeMessagingHosts\\' + NATIVE_HOST_NAME,
    ];

    for (const key of keys) {
      try {
        const regKey = new Registry({ hive: Registry.HKCU, key });
        regKey.destroy((err) => {
          if (err && err.code !== 2) { // Ignore "key not found" errors
            console.error(`[Native Host] Failed to remove registry key ${key}:`, err);
          }
        });
      } catch (error) {
        // Ignore errors
      }
    }

    return;
  }

  const directories = getManifestDirectories();
  if (!directories) return;

  for (const dir of Object.values(directories)) {
    const manifestPath = path.join(dir, `${NATIVE_HOST_NAME}.json`);
    try {
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
        console.log(`[Native Host] Removed ${manifestPath}`);
      }
    } catch (error) {
      console.error(`[Native Host] Failed to remove ${manifestPath}:`, error.message);
    }
  }
}

module.exports = {
  installNativeHost,
  uninstallNativeHost,
  CHROME_EXTENSION_IDS,
  FIREFOX_EXTENSION_ID,
};
