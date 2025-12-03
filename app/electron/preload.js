const { contextBridge, ipcRenderer } = require('electron');

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
    ipcRenderer.on('backend-ready', () => callback());
  },
  onBackendError: (callback) => {
    ipcRenderer.on('backend-error', (_, data) => callback(data));
  },
  removeBackendListeners: () => {
    ipcRenderer.removeAllListeners('backend-ready');
    ipcRenderer.removeAllListeners('backend-error');
  },
});
