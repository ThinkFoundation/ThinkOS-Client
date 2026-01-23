import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Mic, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
];

const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "webm", "ogg", "flac"];

interface AudioDropOverlayProps {
  onUploadComplete?: () => void;
}

export function AudioDropOverlay({ onUploadComplete }: AudioDropOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const isAudioFile = useCallback((file: File): boolean => {
    // Check MIME type
    if (SUPPORTED_AUDIO_TYPES.includes(file.type)) {
      return true;
    }
    // Check extension as fallback
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext ? SUPPORTED_EXTENSIONS.includes(ext) : false;
  }, []);

  const hasAudioFiles = useCallback((dataTransfer: DataTransfer): boolean => {
    if (dataTransfer.types.includes("Files")) {
      // Check items if available
      if (dataTransfer.items) {
        for (let i = 0; i < dataTransfer.items.length; i++) {
          const item = dataTransfer.items[i];
          if (item.kind === "file") {
            const type = item.type;
            if (SUPPORTED_AUDIO_TYPES.includes(type)) {
              return true;
            }
          }
        }
      }
      // Fall back to checking files
      if (dataTransfer.files.length > 0) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
          if (isAudioFile(dataTransfer.files[i])) {
            return true;
          }
        }
      }
      // If we have files but can't determine type, show the overlay
      return true;
    }
    return false;
  }, [isAudioFile]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await apiFetch("/api/media/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(error.detail || "Upload failed");
    }

    return response.json();
  };

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!e.dataTransfer?.files.length) return;

    const audioFiles = Array.from(e.dataTransfer.files).filter(isAudioFile);

    if (audioFiles.length === 0) {
      toast.error("No audio files detected", {
        description: `Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}`,
      });
      return;
    }

    setIsUploading(true);

    try {
      // Upload files in parallel
      const uploadPromises = audioFiles.map(async (file) => {
        try {
          await uploadFile(file);
          return { success: true, name: file.name };
        } catch (error) {
          return { success: false, name: file.name, error };
        }
      });

      const results = await Promise.all(uploadPromises);

      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      if (successful.length > 0) {
        toast.success(
          successful.length === 1
            ? "Audio file uploaded"
            : `${successful.length} audio files uploaded`,
          {
            description: "Transcription will begin shortly",
          }
        );
        onUploadComplete?.();
      }

      if (failed.length > 0) {
        toast.error(
          `Failed to upload ${failed.length} file${failed.length > 1 ? "s" : ""}`,
          {
            description: failed.map((f) => f.name).join(", "),
          }
        );
      }
    } catch (error) {
      toast.error("Upload failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsUploading(false);
    }
  }, [isAudioFile, onUploadComplete]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer && hasAudioFiles(e.dataTransfer)) {
      setIsDragging(true);
    }
  }, [hasAudioFiles]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only hide if leaving the window entirely
    if (e.relatedTarget === null || !document.body.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  useEffect(() => {
    const handleWindowDragEnter = (e: DragEvent) => handleDragEnter(e);
    const handleWindowDragOver = (e: DragEvent) => handleDragOver(e);
    const handleWindowDragLeave = (e: DragEvent) => handleDragLeave(e);
    const handleWindowDrop = (e: DragEvent) => handleDrop(e);

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  if (!isDragging && !isUploading) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center",
        "bg-background/80 backdrop-blur-md",
        "transition-opacity duration-200",
        isDragging ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center gap-4 p-12 rounded-3xl",
          "bg-purple-50/50 dark:bg-purple-950/30",
          "border-2 border-dashed border-purple-300 dark:border-purple-700",
          "transition-transform duration-200",
          isDragging ? "scale-100" : "scale-95"
        )}
      >
        <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
          {isUploading ? (
            <Upload className="h-8 w-8 text-purple-600 animate-bounce" />
          ) : (
            <Mic className="h-8 w-8 text-purple-600" />
          )}
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100">
            {isUploading ? "Uploading..." : "Drop audio files"}
          </h3>
          <p className="text-sm text-purple-600 dark:text-purple-400 mt-1">
            {isUploading
              ? "Creating voice memories"
              : `Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
