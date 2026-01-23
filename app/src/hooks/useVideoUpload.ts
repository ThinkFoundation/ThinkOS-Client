/**
 * Hook for handling video upload with native FFmpeg audio extraction.
 *
 * Pipeline:
 * 1. Get metadata (duration, dimensions) via HTML5 video
 * 2. Write video to temp file via IPC (for native FFmpeg)
 * 3. Upload video to POST /api/video/upload (in parallel with processing)
 * 4. Process video via native FFmpeg (extract audio + thumbnail)
 * 5. Upload audio to POST /api/video/{id}/audio
 * 6. Upload thumbnail to POST /api/video/{id}/thumbnail
 * 7. Cleanup temp file
 */

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { getVideoMetadata, isVideoFile } from "@/lib/ffmpeg";

export type VideoUploadStatus =
  | "idle"
  | "getting_metadata"
  | "uploading_video"
  | "processing_video"
  | "extracting_audio"
  | "generating_thumbnail"
  | "uploading_audio"
  | "uploading_thumbnail"
  | "done"
  | "error";

export interface VideoUploadProgress {
  status: VideoUploadStatus;
  progress: number; // 0-100
  message: string;
  error?: string;
}

export interface VideoUploadResult {
  memoryId: number;
  success: boolean;
  error?: string;
}

export function useVideoUpload() {
  const [uploadProgress, setUploadProgress] = useState<VideoUploadProgress>({
    status: "idle",
    progress: 0,
    message: "",
  });

  const updateProgress = useCallback(
    (status: VideoUploadStatus, progress: number, message: string, error?: string) => {
      setUploadProgress({ status, progress, message, error });
    },
    []
  );

  // Set up progress listener for native FFmpeg processing
  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    electronAPI.onVideoProcessProgress((data) => {
      const stageMessages: Record<string, string> = {
        extracting_audio: "Extracting audio...",
        generating_thumbnail: "Generating thumbnail...",
        done: "Processing complete",
      };

      const message = stageMessages[data.stage] || "Processing video...";
      const status = data.stage === "extracting_audio" ? "extracting_audio" :
                     data.stage === "generating_thumbnail" ? "generating_thumbnail" :
                     "processing_video";

      // Map FFmpeg progress (0-100) to overall progress (30-70%)
      const overallProgress = 30 + Math.round(data.progress * 0.4);
      setUploadProgress(prev => {
        // Only update if we're in a processing state
        if (prev.status === "processing_video" || prev.status === "extracting_audio" || prev.status === "generating_thumbnail") {
          return { status, progress: overallProgress, message };
        }
        return prev;
      });
    });

    return () => {
      electronAPI.removeVideoProcessListeners();
    };
  }, []);

  const uploadVideo = useCallback(
    async (file: File): Promise<VideoUploadResult> => {
      const electronAPI = window.electronAPI;
      if (!electronAPI) {
        const error = "Video upload requires Electron environment";
        updateProgress("error", 0, error, error);
        return { memoryId: 0, success: false, error };
      }

      if (!isVideoFile(file)) {
        const error = "Unsupported video format";
        updateProgress("error", 0, error, error);
        return { memoryId: 0, success: false, error };
      }

      let tempPath: string | null = null;

      try {
        // 1. Read file and get metadata
        updateProgress("getting_metadata", 5, "Reading video file...");
        const videoArrayBuffer = await file.arrayBuffer();
        const videoBlob = new Blob([videoArrayBuffer], { type: file.type });
        const metadata = await getVideoMetadata(videoBlob);

        // 2. Write video to temp file for native FFmpeg processing
        updateProgress("getting_metadata", 10, "Preparing video for processing...");
        const writeResult = await electronAPI.writeTempFile(videoArrayBuffer, file.name);
        if (!writeResult.success || !writeResult.path) {
          throw new Error(writeResult.error || "Failed to write temp file");
        }
        tempPath = writeResult.path;

        // 3. Upload video to backend (run this while processing starts)
        updateProgress("uploading_video", 15, "Uploading video...");
        const videoFormData = new FormData();
        videoFormData.append("file", new File([videoArrayBuffer], file.name, { type: file.type }));
        videoFormData.append("duration", String(metadata.duration));
        videoFormData.append("width", String(metadata.width));
        videoFormData.append("height", String(metadata.height));

        const videoResponse = await apiFetch("/api/video/upload", {
          method: "POST",
          body: videoFormData,
        });

        if (!videoResponse.ok) {
          const errorData = await videoResponse.json().catch(() => ({}));
          throw new Error(errorData.detail || "Failed to upload video");
        }

        const videoData = await videoResponse.json();
        const memoryId = videoData.id;

        // 4. Process video with native FFmpeg (extract audio + thumbnail)
        updateProgress("processing_video", 30, "Processing video with FFmpeg...");
        const processResult = await electronAPI.processVideo(tempPath);

        if (!processResult.success) {
          throw new Error(processResult.error || "Failed to process video");
        }

        // 5. Upload audio
        updateProgress("uploading_audio", 75, "Uploading audio...");
        if (processResult.audio) {
          const audioFormData = new FormData();
          audioFormData.append("file", new File([processResult.audio], "audio.m4a", { type: "audio/mp4" }));

          const audioResponse = await apiFetch(`/api/video/${memoryId}/audio`, {
            method: "POST",
            body: audioFormData,
          });

          if (!audioResponse.ok) {
            const errorData = await audioResponse.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to upload audio");
          }
        }

        // 6. Upload thumbnail (only if generation succeeded)
        if (processResult.thumbnail) {
          updateProgress("uploading_thumbnail", 90, "Uploading thumbnail...");
          const thumbnailFormData = new FormData();
          thumbnailFormData.append(
            "file",
            new File([processResult.thumbnail], "thumbnail.jpg", { type: "image/jpeg" })
          );

          const thumbnailResponse = await apiFetch(`/api/video/${memoryId}/thumbnail`, {
            method: "POST",
            body: thumbnailFormData,
          });

          if (!thumbnailResponse.ok) {
            // Thumbnail upload failure is non-critical
            console.warn("Failed to upload thumbnail:", await thumbnailResponse.text());
          }
        } else {
          console.warn("Skipping thumbnail upload - generation failed");
        }

        // 7. Cleanup temp file
        if (tempPath) {
          await electronAPI.deleteTempFile(tempPath).catch(console.warn);
        }

        // Done!
        updateProgress("done", 100, "Video uploaded successfully");
        return { memoryId, success: true };
      } catch (error) {
        // Cleanup on error
        if (tempPath && electronAPI) {
          await electronAPI.deleteTempFile(tempPath).catch(console.warn);
        }

        const errorMessage = error instanceof Error ? error.message : "Upload failed";
        updateProgress("error", 0, errorMessage, errorMessage);
        return { memoryId: 0, success: false, error: errorMessage };
      }
    },
    [updateProgress]
  );

  const reset = useCallback(() => {
    setUploadProgress({
      status: "idle",
      progress: 0,
      message: "",
    });
  }, []);

  return {
    uploadVideo,
    uploadProgress,
    reset,
    isUploading:
      uploadProgress.status !== "idle" &&
      uploadProgress.status !== "done" &&
      uploadProgress.status !== "error",
  };
}
