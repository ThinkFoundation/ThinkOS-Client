/**
 * Video utility functions for client-side metadata extraction and validation.
 *
 * Note: Audio extraction and thumbnail generation are now handled by native FFmpeg
 * in the Electron main process via IPC (see useVideoUpload hook).
 */

/**
 * Video metadata from HTML5 video element.
 */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

// Timeout for video metadata extraction (30 seconds)
const METADATA_TIMEOUT_MS = 30000;

/**
 * Get video metadata using HTML5 video element.
 * This is faster than using FFmpeg for basic metadata.
 *
 * @param videoData - The video file or blob to get metadata from
 * @returns Video metadata (duration, width, height)
 */
export function getVideoMetadata(videoData: File | Blob): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(videoData);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.src = "";
      video.load(); // Release resources
    };

    // Timeout to prevent hanging indefinitely
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("Video metadata extraction timed out"));
      }
    }, METADATA_TIMEOUT_MS);

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        const metadata = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        cleanup();
        resolve(metadata);
      }
    };

    video.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error("Failed to load video metadata"));
      }
    };

    video.src = objectUrl;
  });
}

/**
 * Check if a file is a supported video format.
 */
export function isVideoFile(file: File): boolean {
  const supportedTypes = [
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/x-msvideo",
  ];

  if (supportedTypes.includes(file.type)) {
    return true;
  }

  // Check extension as fallback
  const supportedExtensions = ["mp4", "webm", "mov", "mkv", "avi"];
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? supportedExtensions.includes(ext) : false;
}
