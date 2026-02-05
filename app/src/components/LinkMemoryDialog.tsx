import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Search, Loader2, Globe, FileText, Mic, FileAudio, Video, File, Check } from "lucide-react";
import { createPortal } from "react-dom";
import { apiFetch, deleteLink } from "@/lib/api";
import { toast } from "sonner";

interface Memory {
  id: number;
  type: string;
  title: string;
  summary: string | null;
  created_at: string;
}

interface LinkMemoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentMemoryId: number;
  onLinkCreated: () => void;
  existingLinks: number[];
}

const MEMORY_TYPE_ICONS = {
  web: Globe,
  note: FileText,
  voice_memo: Mic,
  voice: Mic,
  audio: FileAudio,
  video: Video,
  document: File,
};

export function LinkMemoryDialog({
  isOpen,
  onClose,
  currentMemoryId,
  onLinkCreated,
  existingLinks,
}: LinkMemoryDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Memory[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<number>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  // Initialize selected state with existing links when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMemoryIds(new Set(existingLinks));
    }
  }, [isOpen, existingLinks]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const performSearch = async (query: string) => {
    setIsSearching(true);
    try {
      const response = await apiFetch(`/api/memories/search?q=${encodeURIComponent(query)}&limit=10`);
      if (!response.ok) throw new Error("Search failed");

      const data = await response.json();
      // Filter out current memory and limit results
      const filtered = data.memories
        .filter((m: Memory) => m.id !== currentMemoryId)
        .slice(0, 8);
      setSearchResults(filtered);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Failed to search memories");
    } finally {
      setIsSearching(false);
    }
  };

  const handleLink = async () => {
    setIsLinking(true);

    try {
      // Calculate which links to delete (in existingLinks but not in selectedMemoryIds)
      const linksToDelete = existingLinks.filter(id => !selectedMemoryIds.has(id));

      // Calculate which links to create (in selectedMemoryIds but not in existingLinks)
      const linksToCreate = Array.from(selectedMemoryIds).filter(id => !existingLinks.includes(id));

      // Create all operations in parallel
      const operations: Promise<{ type: 'create' | 'delete', success: boolean }>[] = [];

      // Add delete operations
      linksToDelete.forEach(targetId => {
        operations.push(
          deleteLink(currentMemoryId, targetId)
            .then(() => ({ type: 'delete' as const, success: true }))
            .catch(() => ({ type: 'delete' as const, success: false }))
        );
      });

      // Add create operations
      linksToCreate.forEach(targetId => {
        operations.push(
          apiFetch(`/api/memories/${currentMemoryId}/links`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target_memory_id: targetId,
              link_type: "manual",
            }),
          })
            .then(response => {
              if (!response.ok) throw new Error();
              return { type: 'create' as const, success: true };
            })
            .catch(() => ({ type: 'create' as const, success: false }))
        );
      });

      // Execute all operations in parallel
      if (operations.length > 0) {
        const results = await Promise.all(operations);

        const createResults = results.filter(r => r.type === 'create');
        const deleteResults = results.filter(r => r.type === 'delete');

        const createdCount = createResults.filter(r => r.success).length;
        const deletedCount = deleteResults.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;

        // Show appropriate success messages
        const messages: string[] = [];
        if (createdCount > 0) {
          messages.push(`Linked ${createdCount} ${createdCount === 1 ? 'memory' : 'memories'}`);
        }
        if (deletedCount > 0) {
          messages.push(`Unlinked ${deletedCount} ${deletedCount === 1 ? 'memory' : 'memories'}`);
        }

        if (messages.length > 0) {
          toast.success(messages.join(', '));
        }

        if (failedCount > 0) {
          toast.error(`Failed ${failedCount} ${failedCount === 1 ? 'operation' : 'operations'}`);
        }
      }

      onLinkCreated();
      onClose();
    } catch (error) {
      console.error("Link management error:", error);
      toast.error("Failed to update links");
    } finally {
      setIsLinking(false);
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedMemoryIds(new Set());
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Link Memory</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search Input */}
        <div className="px-6 py-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search memories to link..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isSearching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : searchResults.length > 0 ? (
            <div className="space-y-2">
              {searchResults.map((memory) => {
                const Icon = MEMORY_TYPE_ICONS[memory.type as keyof typeof MEMORY_TYPE_ICONS] || FileText;
                const isExistingLink = existingLinks.includes(memory.id);
                const isSelected = selectedMemoryIds.has(memory.id);

                return (
                  <button
                    key={memory.id}
                    onClick={() => {
                      setSelectedMemoryIds(prev => {
                        const next = new Set(prev);
                        if (next.has(memory.id)) {
                          next.delete(memory.id);
                        } else {
                          next.add(memory.id);
                        }
                        return next;
                      });
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{memory.title}</div>
                        {memory.summary && (
                          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {memory.summary}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isExistingLink && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                            Linked
                          </span>
                        )}
                        <div className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                          isSelected
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground'
                        }`}>
                          {isSelected && (
                            <Check className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : searchQuery ? (
            <div className="text-center py-12 text-muted-foreground">
              No memories found
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Start typing to search for memories to link
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={selectedMemoryIds.size === 0 || isLinking}
          >
            {isLinking ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Linking...
              </>
            ) : (
              `Link Selected (${selectedMemoryIds.size})`
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
