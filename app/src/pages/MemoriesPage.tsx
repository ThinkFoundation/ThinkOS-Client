import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemoryCard } from "@/components/MemoryCard";
import { MemoryDetailPanel } from "@/components/MemoryDetailPanel";
import { NoteEditor } from "@/components/editor";
import { Plus, Search, Loader2, ChevronDown } from "lucide-react";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { apiFetch } from "@/lib/api";

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
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
}

interface MemoryWithContent extends Memory {
  content?: string;
}

interface Tag {
  id: number;
  name: string;
  usage_count: number;
}

type TypeFilter = "all" | "web" | "note";
type DateFilter = "all" | "today" | "week" | "month";

export default function MemoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Memories state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // Filter state
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Semantic search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tags state (for autocomplete)
  const [allTags, setAllTags] = useState<Tag[]>([]);

  // Detail panel state
  const [selectedMemoryId, setSelectedMemoryId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Note editor state
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryWithContent | null>(null);

  // Refs for infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const LIMIT = 20;

  // Helper to check if a memory matches current filters
  const matchesFilters = useCallback(
    (memory: Memory) => {
      // Type filter
      if (typeFilter !== "all" && memory.type !== typeFilter) {
        return false;
      }
      // Date filter - check if memory was created within the filter period
      if (dateFilter !== "all") {
        const memoryDate = new Date(memory.created_at);
        const now = new Date();
        if (dateFilter === "today") {
          const startOfDay = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
          );
          if (memoryDate < startOfDay) return false;
        } else if (dateFilter === "week") {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (memoryDate < weekAgo) return false;
        } else if (dateFilter === "month") {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (memoryDate < monthAgo) return false;
        }
      }
      return true;
    },
    [typeFilter, dateFilter]
  );

  // Real-time updates via SSE
  useMemoryEvents({
    onMemoryCreated: (memoryId, data) => {
      const memory = data as Memory;
      // Only add if it matches current filters and isn't already in list
      if (matchesFilters(memory)) {
        setMemories((prev) => {
          if (prev.some((m) => m.id === memoryId)) return prev;
          return [memory, ...prev];
        });
        setTotal((prev) => prev + 1);
      }
    },
    onMemoryUpdated: (memoryId, data) => {
      const memory = data as Memory;
      setMemories((prev) => prev.map((m) => (m.id === memoryId ? memory : m)));
    },
    onMemoryDeleted: (memoryId) => {
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      setTotal((prev) => prev - 1);
    },
  });

  // Fetch all tags for autocomplete
  const fetchTags = async () => {
    try {
      const res = await apiFetch("/api/tags");
      if (res.ok) {
        const data = await res.json();
        setAllTags(data.tags || []);
      }
    } catch (err) {
      console.error("Failed to fetch tags:", err);
    }
  };

  // Fetch memories with pagination and filters
  const fetchMemories = useCallback(
    async (reset = false) => {
      if (loading) return;
      setLoading(true);

      const newOffset = reset ? 0 : offset;
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(newOffset),
      });

      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }
      if (dateFilter !== "all") {
        params.set("date_range", dateFilter);
      }

      try {
        const res = await apiFetch(`/api/memories?${params}`);
        if (res.ok) {
          const data = await res.json();
          const newMemories = data.memories || [];

          if (reset) {
            setMemories(newMemories);
            setOffset(newMemories.length);
          } else {
            setMemories((prev) => [...prev, ...newMemories]);
            setOffset((prev) => prev + newMemories.length);
          }

          setTotal(data.total || 0);
          setHasMore(data.has_more || false);
        }
      } catch (err) {
        console.error("Failed to fetch memories:", err);
      } finally {
        setLoading(false);
      }
    },
    [loading, offset, typeFilter, dateFilter]
  );

  // Initial load
  useEffect(() => {
    fetchTags();
    fetchMemories(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when filters change
  useEffect(() => {
    setOffset(0);
    setMemories([]);
    setHasMore(true);
    fetchMemories(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, dateFilter]);

  // Handle search params for add form
  useEffect(() => {
    if (searchParams.get("add") === "true") {
      openNoteEditor();
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Handle search params for opening a specific memory
  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId) {
      const memoryId = parseInt(openId, 10);
      if (!isNaN(memoryId)) {
        handleExpand(memoryId);
        setSearchParams({});
      }
    }
  }, [searchParams, setSearchParams]);

  // Setup intersection observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          fetchMemories(false);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, fetchMemories]);

  // Delete memory
  const handleDelete = async (id: number) => {
    try {
      const res = await apiFetch(`/api/memories/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        setTotal((prev) => prev - 1);
      }
    } catch (err) {
      console.error("Failed to delete memory:", err);
    }
  };

  // Remove tag from memory
  const handleRemoveTag = async (memoryId: number, tagId: number) => {
    try {
      const res = await apiFetch(`/api/memories/${memoryId}/tags/${tagId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMemories((prev) =>
          prev.map((m) =>
            m.id === memoryId
              ? { ...m, tags: m.tags.filter((t) => t.id !== tagId) }
              : m
          )
        );
      }
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  // Callback when dialog successfully adds a memory
  const handleAddSuccess = () => {
    fetchMemories(true);
    fetchTags();
  };

  // Open detail panel
  const handleExpand = (id: number) => {
    setSelectedMemoryId(id);
    setIsPanelOpen(true);
  };

  // Open note editor directly from card
  const handleEdit = (id: number) => {
    const memory = memories.find((m) => m.id === id);
    if (memory) {
      openNoteEditor(memory);
    }
  };

  // Close detail panel
  const closePanel = () => {
    setIsPanelOpen(false);
    // Delay clearing ID to allow close animation
    setTimeout(() => setSelectedMemoryId(null), 300);
  };

  // Update memory in list when edited in panel
  const handleMemoryUpdated = (updatedMemory: Memory) => {
    setMemories((prev) =>
      prev.map((m) =>
        m.id === updatedMemory.id ? { ...m, ...updatedMemory } : m
      )
    );
  };

  // Open note editor for new or existing memory
  const openNoteEditor = async (memory?: Memory) => {
    if (memory) {
      // Fetch full memory details including content
      try {
        const res = await apiFetch(`/api/memories/${memory.id}`);
        if (res.ok) {
          const fullMemory = await res.json();
          setEditingMemory({
            ...memory,
            content: fullMemory.content || "",
          });
        } else {
          setEditingMemory(memory);
        }
      } catch {
        setEditingMemory(memory);
      }
    } else {
      setEditingMemory(null);
    }
    setShowNoteEditor(true);
  };

  // Handle note editor save
  const handleEditorSave = (saved: {
    id: number;
    title: string;
    content: string;
  }) => {
    // Refresh memories list to get updated data
    fetchMemories(true);
    fetchTags();
  };

  // Perform semantic search
  const performSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const res = await apiFetch(
        `/api/memories/search?q=${encodeURIComponent(query)}&limit=50`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.memories || []);
      }
    } catch (err) {
      console.error("Semantic search failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced semantic search when query changes
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      performSemanticSearch(searchQuery);
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery, performSemanticSearch]);

  // Determine which memories to display
  const displayMemories = searchResults !== null ? searchResults : memories;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Memories</h1>
          <p className="text-sm text-muted-foreground">{total} total</p>
        </div>
        <Button onClick={() => openNoteEditor()}>
          <Plus className="h-4 w-4 mr-2" />
          Add Note
        </Button>
      </div>

      {/* Memory Detail Panel */}
      <MemoryDetailPanel
        memoryId={selectedMemoryId}
        isOpen={isPanelOpen}
        onClose={closePanel}
        onDelete={handleDelete}
        onMemoryUpdated={handleMemoryUpdated}
        allTags={allTags}
        formatDate={formatDate}
        onOpenEditor={(memory) => {
          closePanel();
          openNoteEditor(memory);
        }}
      />

      {/* Note Editor */}
      <NoteEditor
        memoryId={editingMemory?.id ?? null}
        isOpen={showNoteEditor}
        onOpenChange={setShowNoteEditor}
        onSave={handleEditorSave}
        initialData={
          editingMemory
            ? {
                title: editingMemory.title,
                content: editingMemory.content || "",
              }
            : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        {/* Type filter */}
        <div className="flex rounded-md border">
          {(["all", "web", "note"] as TypeFilter[]).map((type) => (
            <button
              key={type}
              className={`px-3 py-1.5 text-sm capitalize ${
                typeFilter === type
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              } ${type === "all" ? "rounded-l-md" : ""} ${
                type === "note" ? "rounded-r-md" : ""
              }`}
              onClick={() => setTypeFilter(type)}
            >
              {type === "all" ? "All" : type === "web" ? "Web" : "Notes"}
            </button>
          ))}
        </div>

        {/* Date filter */}
        <div className="relative">
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
            onClick={() => {
              const select = document.getElementById("date-select");
              if (select) (select as HTMLSelectElement).click();
            }}
          >
            {dateFilter === "all"
              ? "All Time"
              : dateFilter === "today"
              ? "Today"
              : dateFilter === "week"
              ? "This Week"
              : "This Month"}
            <ChevronDown className="h-4 w-4" />
          </button>
          <select
            id="date-select"
            className="absolute inset-0 opacity-0 cursor-pointer"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search memories (AI-powered)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Memory Grid - Masonry layout */}
      {displayMemories.length === 0 && !loading && !isSearching ? (
        <p className="text-muted-foreground text-center py-8">
          {memories.length === 0
            ? "No memories yet. Save some content via the browser extension or add a note!"
            : searchQuery
            ? "No memories found for your search."
            : "No memories match your filters."}
        </p>
      ) : (
        <div className="columns-1 sm:columns-2 gap-4">
          {displayMemories.map((memory) => (
            <div key={memory.id} className="break-inside-avoid mb-4">
              <MemoryCard
                memory={memory}
                onRemoveTag={handleRemoveTag}
                onExpand={handleExpand}
                onEdit={handleEdit}
                formatDate={formatDate}
              />
            </div>
          ))}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={loadMoreRef} className="h-1" />
    </div>
  );
}
