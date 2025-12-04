const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { installNativeHost } = require('../scripts/install-native-host');

let mainWindow;
let pythonProcess;
let backendReady = false;

// Backend health check configuration
const HEALTH_CHECK_URL = 'http://localhost:8765/health';
const HEALTH_CHECK_INTERVAL_MS = 200;
const HEALTH_CHECK_TIMEOUT_MS = 30000;

/**
 * Polls the backend health endpoint until it responds successfully.
 * Returns a Promise that resolves when backend is ready, or rejects on timeout.
 */
function waitForBackendReady() {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkHealth = async () => {
      try {
        const response = await fetch(HEALTH_CHECK_URL);
        if (response.ok) {
          console.log('Backend is ready');
          resolve();
          return;
        }
      } catch {
        // Backend not ready yet, this is expected during startup
      }

      if (Date.now() - startTime > HEALTH_CHECK_TIMEOUT_MS) {
        reject(new Error('Backend failed to start within timeout'));
        return;
      }

      setTimeout(checkHealth, HEALTH_CHECK_INTERVAL_MS);
    };

    checkHealth();
  });
}

/**
 * Start Ollama if installed but not running
 */
async function ensureOllamaRunning() {
  // Check if already running
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      console.log('Ollama is already running');
      return;
    }
  } catch {
    // Not running, continue to start it
  }

  // Check if installed and start it
  const platform = process.platform;
  if (platform === 'darwin') {
    const ollamaAppPath = '/Applications/Ollama.app';
    if (fs.existsSync(ollamaAppPath)) {
      console.log('Starting Ollama...');
      spawn('open', [ollamaAppPath], { detached: true, stdio: 'ignore' });
    }
  } else if (platform === 'win32') {
    const ollamaPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
    if (fs.existsSync(ollamaPath)) {
      console.log('Starting Ollama...');
      spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore' });
    }
  }
}

function getBackendPath() {
  if (app.isPackaged) {
    // Production: bundled backend executable
    const resourcesPath = process.resourcesPath;
    const platform = process.platform;
    const ext = platform === 'win32' ? '.exe' : '';
    return path.join(resourcesPath, 'backend', `think-backend${ext}`);
  }
  return null; // Dev mode uses Python directly
}

function startPythonBackend() {
  const bundledBackend = getBackendPath();

  if (bundledBackend && fs.existsSync(bundledBackend)) {
    // Production: run bundled executable
    console.log('Starting bundled backend:', bundledBackend);
    pythonProcess = spawn(bundledBackend, [], {
      stdio: 'pipe',
      env: { ...process.env }
    });
  } else {
    // Development: run with Python
    const backendPath = path.join(__dirname, '../../backend');
    console.log('Starting dev backend:', backendPath);
    pythonProcess = spawn('poetry', ['run', 'uvicorn', 'app.main:app', '--port', '8765'], {
      cwd: backendPath,
      stdio: 'pipe',
      shell: true
    });
  }

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Backend: ${data}`);
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
    // Notify renderer if backend crashed unexpectedly
    if (code !== 0 && code !== null && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-error', { message: `Backend crashed (exit code: ${code})` });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, '../public/icons/think-os-agent.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  // Set app name (for dev mode - production uses productName from package.json)
  app.setName('Think');

  // Set dock icon on macOS (for dev mode)
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = path.join(__dirname, '../public/icons/think-os-agent.png');
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(iconPath);
    }
  }

  // Install native messaging host manifests for browser extension
  const resourcesPath = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..');
  const isDev = !app.isPackaged;
  installNativeHost(resourcesPath, undefined, isDev);

  // Start Ollama if installed (don't wait, let it start in background)
  ensureOllamaRunning();

  startPythonBackend();
  createWindow();  // Show window immediately with loading state

  try {
    await waitForBackendReady();
    backendReady = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-ready');
    }
  } catch (err) {
    console.error('Backend startup failed:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-error', { message: err.message });
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // On non-macOS, quit the app (before-quit will kill backend)
    app.quit();
  }
  // On macOS, keep backend running so reopening via dock works
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    // If backend is already ready, notify the new window once it's loaded
    if (backendReady && mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('backend-ready');
      });
    }
  }
});

// IPC handlers
ipcMain.handle('check-ollama', async () => {
  // Check if API is responding (running)
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      return { installed: true, running: true };
    }
  } catch {
    // API not responding
  }

  // Check if installed but not running
  const platform = process.platform;
  let isInstalled = false;

  if (platform === 'darwin') {
    isInstalled = fs.existsSync('/Applications/Ollama.app');
  } else if (platform === 'win32') {
    const ollamaPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
    isInstalled = fs.existsSync(ollamaPath);
  }

  return { installed: isInstalled, running: false };
});

ipcMain.handle('download-ollama', async (_event) => {
  const platform = process.platform;
  const tempDir = app.getPath('temp');

  try {
    if (platform === 'darwin') {
      const ollamaAppPath = '/Applications/Ollama.app';

      // If already installed, just launch it
      if (fs.existsSync(ollamaAppPath)) {
        mainWindow.webContents.send('ollama-download-progress', { progress: 100, stage: 'starting' });
        spawn('open', [ollamaAppPath], { detached: true });
        await new Promise(resolve => setTimeout(resolve, 3000));
        return { success: true };
      }

      // macOS: Download zip, extract, copy to Applications
      const zipPath = path.join(tempDir, 'Ollama-darwin.zip');
      const downloadUrl = 'https://ollama.com/download/Ollama-darwin.zip';

      mainWindow.webContents.send('ollama-download-progress', { progress: 10, stage: 'downloading' });

      // Use curl for reliable redirect handling
      execSync(`curl -L "${downloadUrl}" -o "${zipPath}"`, { stdio: 'pipe' });

      mainWindow.webContents.send('ollama-download-progress', { progress: 80, stage: 'downloading' });

      mainWindow.webContents.send('ollama-download-progress', { progress: 100, stage: 'installing' });

      // Extract and install
      const extractDir = path.join(tempDir, 'ollama-extract');
      fs.mkdirSync(extractDir, { recursive: true });
      execSync(`unzip -o "${zipPath}" -d "${extractDir}"`);
      execSync(`xattr -cr "${extractDir}/Ollama.app"`);
      execSync(`ditto "${extractDir}/Ollama.app" "${ollamaAppPath}"`);

      // Launch Ollama
      spawn('open', [ollamaAppPath], { detached: true });

      // Cleanup
      fs.unlinkSync(zipPath);
      fs.rmSync(extractDir, { recursive: true, force: true });

    } else if (platform === 'win32') {
      const ollamaPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');

      // If already installed, just launch it
      if (fs.existsSync(ollamaPath)) {
        mainWindow.webContents.send('ollama-download-progress', { progress: 100, stage: 'starting' });
        spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore' });
        await new Promise(resolve => setTimeout(resolve, 3000));
        return { success: true };
      }

      // Windows: Download installer and run silently
      const exePath = path.join(tempDir, 'OllamaSetup.exe');
      const downloadUrl = 'https://ollama.com/download/OllamaSetup.exe';

      mainWindow.webContents.send('ollama-download-progress', { progress: 10, stage: 'downloading' });

      // Use curl for reliable redirect handling
      execSync(`curl -L "${downloadUrl}" -o "${exePath}"`, { stdio: 'pipe' });

      mainWindow.webContents.send('ollama-download-progress', { progress: 80, stage: 'downloading' });
      mainWindow.webContents.send('ollama-download-progress', { progress: 100, stage: 'installing' });

      // Run silent install
      execSync(`"${exePath}" /VERYSILENT /NORESTART`, { stdio: 'ignore' });

      // Launch Ollama
      spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore' });

      // Cleanup
      fs.unlinkSync(exePath);
    }

    // Wait for Ollama to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    return { success: true };
  } catch (error) {
    console.error('Ollama install error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pull-model', async (_event, modelName) => {
  try {
    const response = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.total && data.completed) {
            const progress = Math.round((data.completed / data.total) * 100);
            mainWindow.webContents.send('model-pull-progress', { progress, status: data.status });
          } else if (data.status) {
            mainWindow.webContents.send('model-pull-progress', { status: data.status });
          }
        } catch {}
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Model pull error:', error);
    return { success: false, error: error.message };
  }
});
