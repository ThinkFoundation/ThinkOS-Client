const { contextBridge, ipcRenderer } = require('electron');

// Store the app token when received from main process
let appToken = null;

contextBridge.exposeInMainWorld('electronAPI', {
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  downloadOllama: () => ipcRenderer.invoke('download-ollama'),
  pullModel: (modelName) => ipcRenderer.invoke('pull-model', modelName),
  onOllamaDownloadProgress: (callback) => {
    ipcRenderer.on('ollama-download-progress', (_, data) => callback(data));
  },
  onModelPullProgress: (callback) => {
    ipcRenderer.on('model-pull-progress', (_, data) => callback(data));
  },
  removeOllamaDownloadProgress: () => {
    ipcRenderer.removeAllListeners('ollama-download-progress');
  },
  removeModelPullProgress: () => {
    ipcRenderer.removeAllListeners('model-pull-progress');
  },
  // Backend status handlers
  onBackendReady: (callback) => {
    ipcRenderer.on('backend-ready', (_, data) => {
      // Store the token when backend is ready
      if (data && data.token) {
        appToken = data.token;
      }
      callback(data);
    });
  },
  onBackendError: (callback) => {
    ipcRenderer.on('backend-error', (_, data) => callback(data));
  },
  removeBackendListeners: () => {
    ipcRenderer.removeAllListeners('backend-ready');
    ipcRenderer.removeAllListeners('backend-error');
  },
  // Get the app token for API authentication
  getAppToken: () => appToken,
  // Auto-update handlers
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (_, version) => callback(version));
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-downloaded');
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
