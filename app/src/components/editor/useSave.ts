import { useState, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface UseSaveOptions {
  memoryId: number | null;
  title: string;
  content: string;
  enabled: boolean;
  onSaveComplete?: (savedId: number) => void;
  onSaveError?: (error: Error) => void;
}

interface UseSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  isDirty: boolean;
  save: () => Promise<number | null>;
  discard: () => { title: string; content: string };
  savedMemoryId: number | null;
  reset: (initialValues: { title: string; content: string }, newMemoryId: number | null) => void;
}

// Helper to check if content is effectively empty
// TipTap converts empty content to <p></p>, so we need to treat these as equivalent
function isEmptyContent(content: string): boolean {
  if (!content) return true;
  const trimmed = content.trim();
  return !trimmed || trimmed === '<p></p>' || trimmed === '<p><br></p>';
}

export function useSave({
  memoryId,
  title,
  content,
  enabled,
  onSaveComplete,
  onSaveError,
}: UseSaveOptions): UseSaveReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [savedMemoryId, setSavedMemoryId] = useState<number | null>(memoryId);

  const lastSavedValuesRef = useRef({ title, content });
  const isInitializedRef = useRef(false);

  // Reset function called by parent when editor opens with new data
  const reset = useCallback((initialValues: { title: string; content: string }, newMemoryId: number | null) => {
    lastSavedValuesRef.current = { ...initialValues };
    isInitializedRef.current = true;
    setSavedMemoryId(newMemoryId);
    setLastSaved(null);
  }, []);

  // Discard function - returns last saved values for parent to reset state
  const discard = useCallback(() => {
    return { ...lastSavedValuesRef.current };
  }, []);

  // Compute dirty state (derived, not stored)
  // Only consider dirty after reset() has been called with correct initial values
  // For content, treat all "empty" formats as equal (TipTap converts "" to "<p></p>")
  const contentDirty = isEmptyContent(content) && isEmptyContent(lastSavedValuesRef.current.content)
    ? false
    : content !== lastSavedValuesRef.current.content;

  const isDirty =
    enabled &&
    isInitializedRef.current &&
    (title !== lastSavedValuesRef.current.title || contentDirty);

  // Save function
  const save = useCallback(async (): Promise<number | null> => {
    if (!title.trim()) return null;

    // Never save empty content to an existing memory
    if ((memoryId || savedMemoryId) && !content.trim()) {
      console.warn("useSave: Refusing to save empty content to existing memory", memoryId || savedMemoryId);
      return null;
    }

    setIsSaving(true);

    try {
      let responseId: number;

      if (savedMemoryId) {
        // Update existing memory
        const res = await apiFetch(`/api/memories/${savedMemoryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            type: "note",
          }),
        });

        if (!res.ok) throw new Error("Failed to update memory");
        responseId = savedMemoryId;
      } else {
        // Create new memory
        const res = await apiFetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            type: "note",
          }),
        });

        if (!res.ok) throw new Error("Failed to create memory");
        const data = await res.json();
        responseId = data.id;
        setSavedMemoryId(responseId);
      }

      lastSavedValuesRef.current = { title, content };
      setLastSaved(new Date());
      onSaveComplete?.(responseId);
      return responseId;
    } catch (err) {
      onSaveError?.(err instanceof Error ? err : new Error("Save failed"));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [title, content, memoryId, savedMemoryId, onSaveComplete, onSaveError]);

  return {
    isSaving,
    lastSaved,
    isDirty,
    save,
    discard,
    savedMemoryId,
    reset,
  };
}
