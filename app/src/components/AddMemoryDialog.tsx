import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Globe, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface Tag {
  id: number;
  name: string;
  usage_count: number;
}

interface AddMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  allTags: Tag[];
}

export function AddMemoryDialog({
  open,
  onOpenChange,
  onSuccess,
  allTags,
}: AddMemoryDialogProps) {
  // Form state
  const [newMemory, setNewMemory] = useState({
    title: "",
    content: "",
    type: "note" as "web" | "note",
    url: "",
  });
  const [adding, setAdding] = useState(false);

  // Tags state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<Tag[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus title input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [open]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Tag input handling
  const handleTagInputChange = (value: string) => {
    setTagInput(value);
    if (value.trim()) {
      const filtered = allTags.filter(
        (tag) =>
          tag.name.toLowerCase().includes(value.toLowerCase()) &&
          !selectedTags.includes(tag.name)
      );
      setTagSuggestions(filtered.slice(0, 5));
      setShowTagSuggestions(filtered.length > 0);
    } else {
      setShowTagSuggestions(false);
    }
  };

  const addTag = (tagName: string) => {
    const normalized = tagName.trim().toLowerCase();
    if (normalized && !selectedTags.includes(normalized)) {
      setSelectedTags((prev) => [...prev, normalized]);
    }
    setTagInput("");
    setShowTagSuggestions(false);
  };

  const removeSelectedTag = (tagName: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tagName));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    }
  };

  // Submit handler
  const handleSubmit = async () => {
    if (!newMemory.title.trim()) return;
    setAdding(true);

    try {
      const payload = {
        title: newMemory.title,
        content: newMemory.content,
        type: newMemory.type,
        url: newMemory.url || null,
        tags: selectedTags.length > 0 ? selectedTags : null,
      };

      const res = await apiFetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        // Reset form
        setNewMemory({ title: "", content: "", type: "note", url: "" });
        setSelectedTags([]);
        onOpenChange(false);
        onSuccess();
      }
    } catch (err) {
      console.error("Failed to add memory:", err);
    } finally {
      setAdding(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog panel */}
      <div className="absolute left-1/2 top-[12%] -translate-x-1/2 w-full max-w-lg px-4">
        <div
          className={cn(
            "bg-background rounded-2xl shadow-2xl border",
            "transform transition-all duration-200"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Add Memory</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Form */}
          <div className="p-6 space-y-4">
            {/* Type toggle */}
            <div className="flex gap-2">
              <Button
                variant={newMemory.type === "note" ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setNewMemory((prev) => ({ ...prev, type: "note" }))
                }
              >
                <FileText className="h-4 w-4 mr-1.5" />
                Note
              </Button>
              <Button
                variant={newMemory.type === "web" ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setNewMemory((prev) => ({ ...prev, type: "web" }))
                }
              >
                <Globe className="h-4 w-4 mr-1.5" />
                Web
              </Button>
            </div>

            {/* Title */}
            <Input
              ref={titleInputRef}
              placeholder="Title"
              value={newMemory.title}
              onChange={(e) =>
                setNewMemory((prev) => ({ ...prev, title: e.target.value }))
              }
            />

            {/* URL (for web type) */}
            {newMemory.type === "web" && (
              <Input
                placeholder="URL (optional)"
                value={newMemory.url}
                onChange={(e) =>
                  setNewMemory((prev) => ({ ...prev, url: e.target.value }))
                }
              />
            )}

            {/* Content */}
            <textarea
              className={cn(
                "w-full min-h-[120px] px-3 py-2 text-sm rounded-lg",
                "border border-input bg-background",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                "resize-none placeholder:text-muted-foreground"
              )}
              placeholder="Content"
              value={newMemory.content}
              onChange={(e) =>
                setNewMemory((prev) => ({ ...prev, content: e.target.value }))
              }
            />

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Tags</label>
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-primary/10 text-primary rounded-full"
                    >
                      {tag}
                      <button
                        onClick={() => removeSelectedTag(tag)}
                        className="hover:text-primary/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <Input
                  placeholder="Add tags (press Enter or comma)"
                  value={tagInput}
                  onChange={(e) => handleTagInputChange(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onFocus={() =>
                    tagInput && setShowTagSuggestions(tagSuggestions.length > 0)
                  }
                  onBlur={() =>
                    setTimeout(() => setShowTagSuggestions(false), 200)
                  }
                />
                {showTagSuggestions && (
                  <div className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg overflow-hidden">
                    {tagSuggestions.map((tag) => (
                      <button
                        key={tag.id}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        onMouseDown={() => addTag(tag.name)}
                      >
                        {tag.name}
                        <span className="text-muted-foreground ml-2">
                          ({tag.usage_count})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSubmit}
                disabled={adding || !newMemory.title.trim()}
              >
                {adding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Memory"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
