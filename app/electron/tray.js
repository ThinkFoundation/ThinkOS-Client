const { Tray, Menu, BrowserWindow, nativeImage, app, ipcMain } = require('electron');
const path = require('path');

let tray = null;
let recordingWindow = null;
let isRecording = false;

// Listen for recording state changes from renderer
ipcMain.on('recording-state-changed', (event, recording) => {
  isRecording = recording;
});

/**
 * Create the system tray with context menu
 */
function createTray(mainWindow, appToken, isDev) {
  let icon;

  try {
    if (process.platform === 'darwin') {
      // macOS: use template icon (auto-adapts to light/dark menu bar)
      const templatePath = path.join(__dirname, '../public/icons/tray-iconTemplate.png');
      icon = nativeImage.createFromPath(templatePath);
      icon.setTemplateImage(true);
    } else {
      // Windows/Linux: use colored icon at 32x32
      const iconPath = path.join(__dirname, '../public/icons/think-os-agent.png');
      icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    }
  } catch (err) {
    console.error('Failed to load tray icon:', err);
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const isMac = process.platform === 'darwin';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Record Voice Note',
      accelerator: isMac ? 'Cmd+Shift+R' : 'Ctrl+Shift+R',
      click: () => openRecordingWindow(mainWindow, appToken, isDev),
    },
    {
      label: 'Open Think',
      accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
      click: () => {
        const win = BrowserWindow.getAllWindows().find(w => w !== recordingWindow);
        if (win) {
          win.show();
          win.focus();
        } else {
          app.emit('activate');
        }
      },
    },
    { type: 'separator' },
    {
      label: isMac ? 'Quit Think' : 'Exit',
      accelerator: isMac ? 'Cmd+Q' : undefined,
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip('Think');
  tray.setContextMenu(contextMenu);

  // On macOS, clicking the tray icon opens the context menu
  // On Windows, single-click opens recording, double-click opens app
  if (process.platform !== 'darwin') {
    tray.on('click', () => openRecordingWindow(mainWindow, appToken, isDev));
    tray.on('double-click', () => {
      const win = BrowserWindow.getAllWindows().find(w => w !== recordingWindow);
      if (win) {
        win.show();
        win.focus();
      } else {
        app.emit('activate');
      }
    });
  }
}

/**
 * Open the compact recording popup window
 */
function openRecordingWindow(mainWindow, appToken, isDev) {
  // If recording window already exists and is visible, focus it
  if (recordingWindow && !recordingWindow.isDestroyed()) {
    recordingWindow.focus();
    return;
  }

  // Get the position for the popup (near tray on macOS, center on Windows)
  let x, y;
  if (tray) {
    const trayBounds = tray.getBounds();
    const windowWidth = 320;
    const windowHeight = 240;

    if (process.platform === 'darwin') {
      // Position below the tray icon on macOS
      x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowWidth / 2));
      y = Math.round(trayBounds.y + trayBounds.height + 4);
    } else {
      // Position above the tray icon on Windows (taskbar is at bottom)
      x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowWidth / 2));
      y = Math.round(trayBounds.y - windowHeight - 4);
    }
  }

  recordingWindow = new BrowserWindow({
    width: 320,
    height: 240,
    x,
    y,
    frame: false,
    transparent: false,
    backgroundColor: '#1c1c1e',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the recording page
  if (isDev) {
    recordingWindow.loadURL('http://localhost:5173/#/recording');
  } else {
    recordingWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/recording',
    });
  }

  // Send the app token to the recording window once loaded
  recordingWindow.webContents.once('did-finish-load', () => {
    if (appToken) {
      recordingWindow.webContents.send('backend-ready', { token: appToken });
    }
  });

  // Close when clicking outside (blur event)
  recordingWindow.on('blur', () => {
    // Small delay to allow for click handling
    setTimeout(() => {
      if (recordingWindow && !recordingWindow.isDestroyed()) {
        // Don't close if user is actively recording (state tracked via IPC)
        if (!isRecording) {
          recordingWindow.close();
        }
      }
    }, 100);
  });

  recordingWindow.on('closed', () => {
    recordingWindow = null;
    isRecording = false; // Reset state when window closes
  });
}

/**
 * Close the recording window
 */
function closeRecordingWindow() {
  if (recordingWindow && !recordingWindow.isDestroyed()) {
    recordingWindow.close();
    recordingWindow = null;
  }
}

/**
 * Destroy the tray icon
 */
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  openRecordingWindow,
  closeRecordingWindow,
  destroyTray,
};
