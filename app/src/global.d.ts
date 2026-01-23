/**
 * Global TypeScript declarations for Electron IPC APIs.
 */

export {};

declare global {
  interface Window {
    electronAPI?: {
      // Ollama management
      checkOllama: () => Promise<{ installed: boolean; running: boolean }>;
      downloadOllama: () => Promise<{ success: boolean; error?: string }>;
      pullModel: (model: string) => Promise<{ success: boolean; error?: string }>;
      onOllamaDownloadProgress: (callback: (data: { progress: number; stage: string }) => void) => void;
      onModelPullProgress: (callback: (data: { progress?: number; status: string }) => void) => void;
      removeOllamaDownloadProgress: () => void;
      removeModelPullProgress: () => void;
      // Backend status handlers
      onBackendReady: (callback: (data?: { token?: string }) => void) => void;
      onBackendError: (callback: (data: { message: string }) => void) => void;
      removeBackendListeners: () => void;
      // App token for API authentication
      getAppToken: () => string | null;
      // Auto-update handlers
      onUpdateDownloaded: (callback: (version: string) => void) => void;
      removeUpdateListeners: () => void;
      installUpdate: () => Promise<void>;
      // Main window management
      openMainWindow: () => Promise<void>;
      // Recording window management
      openRecordingWindow: () => Promise<void>;
      setRecordingState: (isRecording: boolean) => void;
      // Video processing (native FFmpeg)
      // Note: Buffer objects from Node.js serialize to Uint8Array over IPC
      writeTempFile: (data: ArrayBuffer, filename: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      processVideo: (videoPath: string) => Promise<{ success: boolean; audio?: Uint8Array; thumbnail?: Uint8Array | null; error?: string }>;
      deleteTempFile: (path: string) => Promise<{ success: boolean; error?: string }>;
      onVideoProcessProgress: (callback: (data: { progress: number; stage: string }) => void) => void;
      removeVideoProcessListeners: () => void;
    };
  }
}
