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
const { execSync } = require('child_process');

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
 * Get the path to the native host stub executable.
 * Uses pure C binary (no Python dependency) to avoid Gatekeeper warnings.
 */
function getStubPath(resourcesPath, isDev = false) {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';

  // Both dev and production: use pure C native binary from native_host/
  const binaryPath = path.join(resourcesPath, 'backend', 'native_host', `think-native-stub${ext}`);

  if (fs.existsSync(binaryPath)) {
    console.log(`[Native Host] Using native binary: ${binaryPath}`);
    return binaryPath;
  }

  console.error(`[Native Host] Binary not found at ${binaryPath}`);
  console.error('[Native Host] Run "pnpm build:stub" to compile the native stub');
  return null;
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
 * Install Windows registry entries using reg.exe (no external dependencies).
 */
function installWindowsRegistry(stubPath, extensionIds) {
  // Windows requires registry entries that point to manifest files
  const manifestDir = path.dirname(stubPath);

  // Chrome/Edge manifest
  const chromeManifestPath = path.join(manifestDir, `${NATIVE_HOST_NAME}.json`);
  const chromeManifest = createChromeManifest(stubPath, extensionIds);
  fs.writeFileSync(chromeManifestPath, JSON.stringify(chromeManifest, null, 2));

  // Firefox manifest
  const firefoxManifestPath = path.join(manifestDir, `${NATIVE_HOST_NAME}.firefox.json`);
  const firefoxManifest = createFirefoxManifest(stubPath);
  fs.writeFileSync(firefoxManifestPath, JSON.stringify(firefoxManifest, null, 2));

  const browsers = [
    { name: 'Chrome', key: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, manifest: chromeManifestPath },
    { name: 'Edge', key: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, manifest: chromeManifestPath },
    { name: 'Firefox', key: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, manifest: firefoxManifestPath },
  ];

  for (const browser of browsers) {
    try {
      // Use reg.exe to add registry key (no external dependencies needed)
      execSync(`reg add "${browser.key}" /ve /t REG_SZ /d "${browser.manifest}" /f`, {
        stdio: 'pipe',
        windowsHide: true,
      });
      console.log(`[Native Host] Installed registry entry for ${browser.name}`);
    } catch (error) {
      console.error(`[Native Host] Failed to install registry for ${browser.name}:`, error.message);
    }
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

  // Check if stub binary exists
  if (!stubPath || !fs.existsSync(stubPath)) {
    console.warn('[Native Host] Stub binary not found, skipping installation');
    console.warn('[Native Host] Run "pnpm build:stub" to compile the native stub');
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
 */
function uninstallNativeHost() {
  console.log('[Native Host] Uninstalling native messaging host manifests...');

  if (process.platform === 'win32') {
    // Remove Windows registry entries using reg.exe
    const keys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
      `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    ];

    for (const key of keys) {
      try {
        execSync(`reg delete "${key}" /f`, {
          stdio: 'pipe',
          windowsHide: true,
        });
      } catch (error) {
        // Ignore errors (key might not exist)
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
