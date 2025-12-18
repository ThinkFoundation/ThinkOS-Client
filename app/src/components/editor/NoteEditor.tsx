import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { editor as editorTokens } from "@/lib/design-tokens";
import { EditorContent } from "./EditorContent";
import { EditorToolbar, type EditorMode } from "./EditorToolbar";
import { EditorActionBar } from "./EditorActionBar";
import { useSave } from "./useSave";
import { apiFetch } from "@/lib/api";
import { X } from "lucide-react";

interface NoteEditorProps {
  memoryId: number | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (memory: { id: number; title: string; content: string }) => void;
  initialData?: {
    title: string;
    content: string;
  };
}

// Normalize plain text content to HTML for the editor
function normalizeContent(content: string): string {
  if (!content || content.trim() === "") return "";
  // If content starts with < tag, assume HTML
  if (content.trim().startsWith("<")) return content;
  // Otherwise, wrap plain text in paragraphs
  return content
    .split("\n\n")
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Get word count from HTML content
function getWordCount(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(" ").length;
}

export function NoteEditor({
  memoryId,
  isOpen,
  onOpenChange,
  onSave,
  initialData,
}: NoteEditorProps) {
  // Core editor state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("edit");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [showCloseWarning, setShowCloseWarning] = useState(false);

  // Ref for focus
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Track initial content for regeneration check on close
  const initialContentRef = useRef("");

  // Save hook (manual save, no auto-trigger)
  const { isSaving, isDirty, save, discard, savedMemoryId, reset } = useSave({
    memoryId,
    title,
    content,
    enabled: isOpen,
  });

  // Initialize state when editor opens, reset when it closes
  // Depends on isOpen AND memoryId to handle switching between memories
  useEffect(() => {
    if (isOpen) {
      const newTitle = initialData?.title || "";
      const newContent = normalizeContent(initialData?.content || "");

      setTitle(newTitle);
      setContent(newContent);
      setMode("edit");
      setShowCloseWarning(false);
      setEditorKey((k) => k + 1);
      initialContentRef.current = newContent;
      // Pass memoryId explicitly to avoid stale closure issues
      reset({ title: newTitle, content: newContent }, memoryId);
      setTimeout(() => titleInputRef.current?.focus(), 100);
    } else {
      // Reset state on close to prevent stale content when reopening for different memory
      setTitle("");
      setContent("");
      setShowCloseWarning(false);
    }
  }, [isOpen, memoryId, initialData?.title, initialData?.content]); // Include initialData to handle late-arriving data

  // Handle escape key and keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (mode === "distraction-free") {
          setMode("edit");
        } else if (isDirty) {
          // Block ESC close when dirty, show warning
          setShowCloseWarning(true);
        } else {
          handleClose();
        }
      }

      // Cmd+S / Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && isOpen) {
        e.preventDefault();
        if (isDirty && title.trim()) {
          handleSave();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, mode, isDirty, title]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle save - triggers regeneration on successful save
  const handleSave = useCallback(async () => {
    const finalId = await save();

    if (finalId) {
      // Trigger embedding/summary regeneration on successful save
      try {
        await apiFetch(`/api/memories/${finalId}/regenerate-summary`, {
          method: "POST",
        });
      } catch (err) {
        console.error("Failed to trigger regeneration:", err);
      }

      // Notify parent
      onSave({ id: finalId, title, content });

      // Clear close warning if showing
      setShowCloseWarning(false);
    }
  }, [save, title, content, onSave]);

  // Handle discard - reset to last saved state
  const handleDiscard = useCallback(() => {
    const savedValues = discard();
    setTitle(savedValues.title);
    setContent(savedValues.content);
    setEditorKey((k) => k + 1); // Force editor remount
    setShowCloseWarning(false);
  }, [discard]);

  // Handle close - block if dirty
  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowCloseWarning(true);
      return; // Block close
    }

    // Not dirty - close normally
    if (savedMemoryId) {
      onSave({ id: savedMemoryId, title, content });
    }
    onOpenChange(false);
  }, [isDirty, savedMemoryId, title, content, onSave, onOpenChange]);

  if (!isOpen) return null;

  const wordCount = getWordCount(content);
  const isDistractionFree = mode === "distraction-free";

  return createPortal(
    <div className={cn(editorTokens.container, "flex flex-col")}>
      {/* Header - hidden in distraction-free mode */}
      <div
        className={cn(
          "flex items-center justify-between px-6 py-4 border-b border-border/30",
          "transition-opacity duration-300",
          isDistractionFree && "opacity-0 hover:opacity-100"
        )}
      >
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {memoryId ? "Edit Note" : "New Note"}
          </span>
        </div>
      </div>

      {/* Toolbar - hidden in distraction-free, shown on hover */}
      <div
        className={cn(
          "flex justify-center py-3",
          "transition-opacity duration-300",
          isDistractionFree && "opacity-0 hover:opacity-100"
        )}
      >
        <EditorToolbar editor={editor} mode={mode} onModeChange={setMode} />
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto">
        <div className={editorTokens.content}>
          {/* Title */}
          <input
            ref={titleInputRef}
            type="text"
            placeholder="Untitled"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={cn(editorTokens.title, "mb-6")}
          />

          {/* Editor */}
          <EditorContent
            key={editorKey}
            content={
              isOpen && initialData?.content
                ? normalizeContent(initialData.content)
                : content
            }
            onChange={setContent}
            placeholder="Start writing..."
            onEditorReady={setEditor}
          />
        </div>
      </div>

      {/* Action bar */}
      <EditorActionBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        showCloseWarning={showCloseWarning}
        isDistractionFree={isDistractionFree}
        wordCount={wordCount}
      />
    </div>,
    document.body
  );
}

export type { NoteEditorProps };
