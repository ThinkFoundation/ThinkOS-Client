/**
 * Hook for handling document (PDF) upload.
 *
 * Validates file format and size, then uploads to the backend.
 * The backend handles text extraction, thumbnail generation, and AI processing.
 */

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

// Supported document extensions
const DOCUMENT_EXTENSIONS = ["pdf"];

// File size limit (50 MB)
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;

export interface DocumentUploadResult {
  memoryId: number;
  success: boolean;
  error?: string;
}

/**
 * Check if a file is a supported document format.
 */
export function isDocumentFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? DOCUMENT_EXTENSIONS.includes(ext) : false;
}

/**
 * Validate document file size.
 */
export function validateDocumentSize(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_DOCUMENT_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_DOCUMENT_SIZE / (1024 * 1024)} MB.`,
    };
  }
  return { valid: true };
}

export function useDocumentUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadDocument = useCallback(
    async (file: File): Promise<DocumentUploadResult> => {
      // Reset state
      setError(null);

      // Validate file format
      if (!isDocumentFile(file)) {
        const errorMsg = `Unsupported format. Supported: ${DOCUMENT_EXTENSIONS.join(", ")}`;
        setError(errorMsg);
        return { memoryId: 0, success: false, error: errorMsg };
      }

      // Validate file size
      const sizeValidation = validateDocumentSize(file);
      if (!sizeValidation.valid) {
        setError(sizeValidation.error!);
        return { memoryId: 0, success: false, error: sizeValidation.error };
      }

      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await apiFetch("/api/document/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.detail || "Failed to upload document";
          setError(errorMsg);
          return { memoryId: 0, success: false, error: errorMsg };
        }

        const data = await response.json();
        return { memoryId: data.id, success: true };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Upload failed";
        setError(errorMsg);
        return { memoryId: 0, success: false, error: errorMsg };
      } finally {
        setIsUploading(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setError(null);
    setIsUploading(false);
  }, []);

  return {
    uploadDocument,
    isUploading,
    error,
    reset,
  };
}
