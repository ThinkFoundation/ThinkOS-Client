import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  Globe,
  FileText,
  Loader2,
  Pencil,
  Check,
  RefreshCw,
  MessageSquarePlus,
  Trash2,
  Link as LinkIcon,
  Sparkles,
  Lightbulb,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { useConversation } from "../contexts/ConversationContext";

interface MemoryTag {
  id: number;
  name: string;
  source: "ai" | "manual";
}

interface Memory {
  id: number;
  type: "web" | "note";
  url: string | null;
  title: string;
  content?: string;
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
}

interface Tag {
  id: number;
  name: string;
  usage_count: number;
}

interface MemoryDetailPanelProps {
  memoryId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: number) => void;
  onMemoryUpdated: (memory: Memory) => void;
  allTags: Tag[];
  formatDate: (date: string) => string;
}

export function MemoryDetailPanel({
  memoryId,
  isOpen,
  onClose,
  onDelete,
  onMemoryUpdated,
  allTags,
  formatDate,
}: MemoryDetailPanelProps) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Tag input state
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<Tag[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { startNewChat, setPendingMessage } = useConversation();

  // Listen for SSE updates to refresh memory data (e.g., after summary regeneration)
  useMemoryEvents({
    onMemoryUpdated: (updatedMemoryId, data) => {
      if (updatedMemoryId === memoryId && data) {
        const updatedMemory = data as Memory;
        setMemory(updatedMemory);
        setIsRegenerating(false);
        if (!isEditing) {
          setEditedTitle(updatedMemory.title || "");
          setEditedContent(updatedMemory.content || "");
        }
      }
    },
    enabled: isOpen && memoryId !== null,
  });

  // Fetch memory details when memoryId changes
  useEffect(() => {
    if (memoryId && isOpen) {
      fetchMemory(memoryId);
    }
  }, [memoryId, isOpen]);

  // Reset editing state when panel closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setTagInput("");
      setShowTagSuggestions(false);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isEditing, onClose]);

  // Prevent body scroll when panel is open
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

  // Focus title input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [isEditing]);

  const fetchMemory = async (id: number) => {
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/memories/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMemory(data);
        setEditedTitle(data.title || "");
        setEditedContent(data.content || "");
      }
    } catch (err) {
      console.error("Failed to fetch memory:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!memory || !editedTitle.trim()) return;
    setIsSaving(true);

    try {
      const res = await apiFetch(`/api/memories/${memory.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editedTitle,
          content: editedContent,
          type: memory.type,
        }),
      });

      if (res.ok) {
        const updatedMemory = {
          ...memory,
          title: editedTitle,
          content: editedContent,
        };
        setMemory(updatedMemory);
        onMemoryUpdated(updatedMemory);
        setIsEditing(false);
      }
    } catch (err) {
      console.error("Failed to save memory:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerateSummary = async () => {
    if (!memory) return;
    setIsRegenerating(true);

    try {
      const res = await apiFetch(
        `/api/memories/${memory.id}/regenerate-summary`,
        { method: "POST" }
      );

      if (res.ok) {
        // Clear summary to show "Generating..." state
        // SSE will update when ready and set isRegenerating to false
        setMemory((prev) =>
          prev ? { ...prev, summary: null } : null
        );
      } else {
        setIsRegenerating(false);
      }
    } catch (err) {
      console.error("Failed to regenerate summary:", err);
      setIsRegenerating(false);
    }
  };

  const handleAddToConversation = () => {
    if (!memory) return;
    // Set pending message and navigate to home
    const prompt = `Tell me about "${memory.title}"`;
    setPendingMessage(prompt);
    startNewChat();
    onClose();
    navigate("/");
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!memory) return;

    try {
      const res = await apiFetch(
        `/api/memories/${memory.id}/tags/${tagId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setMemory((prev) =>
          prev
            ? { ...prev, tags: prev.tags.filter((t) => t.id !== tagId) }
            : null
        );
      }
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  const handleAddTag = async (tagName: string) => {
    if (!memory) return;
    const normalized = tagName.trim().toLowerCase();
    if (!normalized) return;

    // Check if tag already exists
    if (memory.tags.some((t) => t.name.toLowerCase() === normalized)) {
      setTagInput("");
      setShowTagSuggestions(false);
      return;
    }

    try {
      const res = await apiFetch(
        `/api/memories/${memory.id}/tags?tag_name=${encodeURIComponent(normalized)}`,
        { method: "POST" }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.added && data.tag) {
          setMemory((prev) =>
            prev ? { ...prev, tags: [...prev.tags, data.tag] } : null
          );
        }
      }
    } catch (err) {
      console.error("Failed to add tag:", err);
    }

    setTagInput("");
    setShowTagSuggestions(false);
  };

  const handleTagInputChange = (value: string) => {
    setTagInput(value);
    if (value.trim()) {
      const currentTagNames = memory?.tags.map((t) => t.name.toLowerCase()) || [];
      const filtered = allTags.filter(
        (tag) =>
          tag.name.toLowerCase().includes(value.toLowerCase()) &&
          !currentTagNames.includes(tag.name.toLowerCase())
      );
      setTagSuggestions(filtered.slice(0, 5));
      setShowTagSuggestions(filtered.length > 0);
    } else {
      setShowTagSuggestions(false);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (tagInput.trim()) {
        handleAddTag(tagInput);
      }
    }
  };

  const handleDelete = () => {
    if (!memory) return;
    if (confirm("Are you sure you want to delete this memory?")) {
      onDelete(memory.id);
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/20 backdrop-blur-sm",
          "transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-full max-w-md",
          "bg-background/95 backdrop-blur-xl",
          "border-l border-border/50",
          "shadow-2xl",
          "transform transition-transform duration-300 ease-out",
          "flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Close button */}
        <div className="flex justify-end px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <div className="animate-pulse space-y-4">
                <div className="h-6 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-full" />
                <div className="h-4 bg-muted rounded w-5/6" />
                <div className="h-20 bg-muted rounded w-full" />
              </div>
            </div>
          ) : memory ? (
            <div className="p-6 space-y-6">
              {/* Type + Title Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  {memory.type === "web" ? (
                    <Globe className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4 text-amber-600" />
                  )}
                  <span className="text-sm capitalize">{memory.type}</span>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsEditing(true)}
                      className="h-6 w-6 ml-auto"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {isEditing ? (
                  <>
                    <Input
                      ref={titleInputRef}
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      className="text-lg font-semibold"
                      placeholder="Title"
                    />
                    {/* Content textarea - grouped with title in edit mode */}
                    <div className="space-y-2 mt-3">
                      <label className="text-sm font-medium">Content</label>
                      <textarea
                        className={cn(
                          "w-full min-h-[120px] px-3 py-2 text-sm rounded-lg",
                          "border border-input bg-background",
                          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                          "resize-none"
                        )}
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        placeholder="Content"
                      />
                    </div>
                    {/* Save/Cancel buttons - right below content */}
                    <div className="flex gap-2 mt-3">
                      <Button
                        onClick={handleSave}
                        disabled={isSaving || !editedTitle.trim()}
                        size="sm"
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-1.5" />
                            Save
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsEditing(false);
                          setEditedTitle(memory.title || "");
                          setEditedContent(memory.content || "");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <h3 className="text-lg font-semibold">
                    {memory.title || "Untitled"}
                  </h3>
                )}

                {memory.url && (
                  <a
                    href={memory.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full",
                      "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300",
                      "hover:bg-slate-200 dark:hover:bg-white/15",
                      "transition-colors"
                    )}
                  >
                    <LinkIcon className="h-3 w-3" />
                    {new URL(memory.url).hostname.replace(/^www\./, "")}
                  </a>
                )}

                <p className="text-xs text-muted-foreground">
                  {formatDate(memory.created_at)}
                </p>
              </div>

              {/* Summary Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Summary</span>
                </div>
                {memory.summary ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {memory.summary}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/50 italic">
                    {isRegenerating ? "Generating summary..." : "No summary available"}
                  </p>
                )}
              </div>

              {/* Tags Section */}
              <div className="space-y-3">
                <span className="text-sm font-medium">Tags</span>
                {memory.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {memory.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full",
                          "transition-colors",
                          tag.source === "ai"
                            ? "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {tag.name}
                        <button
                          onClick={() => handleRemoveTag(tag.id)}
                          className="hover:opacity-70 -mr-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Input
                    placeholder="Add tag (press Enter)"
                    value={tagInput}
                    onChange={(e) => handleTagInputChange(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onFocus={() =>
                      tagInput && setShowTagSuggestions(tagSuggestions.length > 0)
                    }
                    onBlur={() =>
                      setTimeout(() => setShowTagSuggestions(false), 200)
                    }
                    className="text-sm"
                  />
                  {showTagSuggestions && (
                    <div className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg overflow-hidden">
                      {tagSuggestions.map((tag) => (
                        <button
                          key={tag.id}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                          onMouseDown={() => handleAddTag(tag.name)}
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

              {/* AI Actions Section */}
              <div className="space-y-3">
                <span className="text-sm font-medium">Actions</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateSummary}
                    disabled={isRegenerating || !memory.content}
                  >
                    {isRegenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        Regenerating...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        Regenerate Summary
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddToConversation}
                  >
                    <MessageSquarePlus className="h-4 w-4 mr-1.5" />
                    Add to Chat
                  </Button>
                </div>
              </div>

              {/* Future Sections (Placeholders) */}
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <Lightbulb className="h-4 w-4" />
                  <span className="text-sm">Insights</span>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full ml-auto">
                    Coming Soon
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <Network className="h-4 w-4" />
                  <span className="text-sm">Similar Memories</span>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full ml-auto">
                    Coming Soon
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground">
              Memory not found
            </div>
          )}
        </div>

        {/* Footer */}
        {memory && (
          <div className="border-t px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete Memory
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
