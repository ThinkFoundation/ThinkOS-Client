import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemoryCard } from "@/components/MemoryCard";
import { VoiceMemoCard } from "@/components/VoiceMemoCard";
import { AudioCard } from "@/components/AudioCard";
import { VideoCard } from "@/components/VideoCard";
import { MemoryDetailPanel } from "@/components/MemoryDetailPanel";
import { AudioDropOverlay } from "@/components/AudioDropOverlay";
import { NoteEditor } from "@/components/editor";
import {
  Plus,
  Search,
  Loader2,
  ChevronDown,
  Upload,
  Globe,
  FileText,
  Mic,
  FileAudio,
  Video,
  LayoutGrid,
  Check,
  Calendar,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { useVideoUpload } from "../hooks/useVideoUpload";
import { apiFetch } from "@/lib/api";
import type { TranscriptionStatus, VideoProcessingStatus } from "@/types/chat";

interface MemoryTag {
  id: number;
  name: string;
  source: "ai" | "manual";
}

interface Memory {
  id: number;
  type: "web" | "note" | "voice_memo" | "audio" | "video" | "voice"; // "voice" for backwards compat
  url: string | null;
  title: string;
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
  // Media-specific fields (voice memos and audio uploads)
  audio_duration?: number;
  transcription_status?: TranscriptionStatus;
  media_source?: "recording" | "upload";
  // Video-specific fields
  video_duration?: number;
  video_width?: number;
  video_height?: number;
  thumbnail_path?: string;
  video_processing_status?: VideoProcessingStatus;
}

interface MemoryWithContent extends Memory {
  content?: string;
  transcript?: string;
}

interface Tag {
  id: number;
  name: string;
  usage_count: number;
}

type TypeFilter = "all" | "web" | "note" | "voice_memo" | "audio" | "video";
type DateFilter = "all" | "today" | "week" | "month";

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All", icon: LayoutGrid, iconColor: "text-muted-foreground" },
  { value: "web", label: "Web", icon: Globe, iconColor: "text-muted-foreground" },
  { value: "note", label: "Notes", icon: FileText, iconColor: "text-amber-600" },
  { value: "voice_memo", label: "Voice Memos", icon: Mic, iconColor: "text-orange-600" },
  { value: "audio", label: "Audio", icon: FileAudio, iconColor: "text-blue-600" },
  { value: "video", label: "Video", icon: Video, iconColor: "text-purple-600" },
] as const;

const DATE_FILTER_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
] as const;

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
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
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

  // File upload refs
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // New menu state
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  // Video upload hook
  const { uploadVideo, uploadProgress, isUploading: isUploadingVideo } = useVideoUpload();

  const LIMIT = 20;

  // Supported file extensions
  const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "webm", "ogg", "flac"];
  const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv", "avi"];

  // File size limits (in bytes)
  const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100 MB
  const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB

  // File upload handler (audio and video)
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Separate audio and video files
    const audioFiles = fileArray.filter((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext && AUDIO_EXTENSIONS.includes(ext);
    });

    const videoFiles = fileArray.filter((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext && VIDEO_EXTENSIONS.includes(ext);
    });

    if (audioFiles.length === 0 && videoFiles.length === 0) {
      toast.error("No supported files detected", {
        description: `Audio: ${AUDIO_EXTENSIONS.join(", ")} | Video: ${VIDEO_EXTENSIONS.join(", ")}`,
      });
      return;
    }

    // Validate file sizes
    const oversizedAudio = audioFiles.filter((f) => f.size > MAX_AUDIO_SIZE);
    const oversizedVideo = videoFiles.filter((f) => f.size > MAX_VIDEO_SIZE);

    if (oversizedAudio.length > 0) {
      toast.error(`${oversizedAudio.length} audio file(s) exceed 100 MB limit`, {
        description: oversizedAudio.map((f) => f.name).join(", "),
      });
    }

    if (oversizedVideo.length > 0) {
      toast.error(`${oversizedVideo.length} video file(s) exceed 500 MB limit`, {
        description: oversizedVideo.map((f) => f.name).join(", "),
      });
    }

    // Filter out oversized files
    const validAudioFiles = audioFiles.filter((f) => f.size <= MAX_AUDIO_SIZE);
    const validVideoFiles = videoFiles.filter((f) => f.size <= MAX_VIDEO_SIZE);

    if (validAudioFiles.length === 0 && validVideoFiles.length === 0) {
      return;
    }

    // Upload audio files
    if (validAudioFiles.length > 0) {
      setIsUploading(true);
      try {
        const uploadPromises = validAudioFiles.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);
          const response = await apiFetch("/api/media/upload", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            throw new Error("Upload failed");
          }
          return { success: true, name: file.name };
        });

        const results = await Promise.all(
          uploadPromises.map((p) => p.catch((e) => ({ success: false, error: e })))
        );
        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        if (successful.length > 0) {
          toast.success(
            successful.length === 1
              ? "Audio file uploaded"
              : `${successful.length} audio files uploaded`,
            { description: "Transcription will begin shortly" }
          );
          fetchMemories(true);
        }

        if (failed.length > 0) {
          toast.error(`Failed to upload ${failed.length} audio file(s)`);
        }
      } catch (error) {
        toast.error("Audio upload failed");
      } finally {
        setIsUploading(false);
      }
    }

    // Upload video files (one at a time due to FFmpeg processing)
    for (const videoFile of validVideoFiles) {
      toast.info(`Processing ${videoFile.name}...`, {
        description: "Extracting audio for transcription",
        duration: 5000,
      });

      const result = await uploadVideo(videoFile);

      if (result.success) {
        toast.success(`Video uploaded: ${videoFile.name}`, {
          description: "Transcription will begin shortly",
        });
        fetchMemories(true);
      } else {
        toast.error(`Failed to upload ${videoFile.name}`, {
          description: result.error,
        });
      }
    }

    // Reset file inputs
    if (audioInputRef.current) {
      audioInputRef.current.value = "";
    }
    if (videoInputRef.current) {
      videoInputRef.current.value = "";
    }
  };

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
      const update = data as Partial<Memory>;
      setMemories((prev) => prev.map((m) => (m.id === memoryId ? { ...m, ...update } : m)));
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
        {/* Hidden file inputs */}
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />

        {/* New dropdown */}
        <Popover open={newMenuOpen} onOpenChange={setNewMenuOpen}>
          <PopoverTrigger asChild>
            <Button disabled={isUploading || isUploadingVideo}>
              {isUploading || isUploadingVideo ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              New
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[160px] p-1" align="end">
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted/50 cursor-pointer"
              onClick={() => {
                openNoteEditor();
                setNewMenuOpen(false);
              }}
            >
              <FileText className="h-4 w-4 text-amber-600" />
              <span>Add Note</span>
            </button>
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted/50 cursor-pointer"
              onClick={() => {
                window.electronAPI?.openRecordingWindow();
                setNewMenuOpen(false);
              }}
            >
              <Mic className="h-4 w-4 text-orange-600" />
              <span>Voice Memo</span>
            </button>
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted/50 cursor-pointer"
              onClick={() => {
                audioInputRef.current?.click();
                setNewMenuOpen(false);
              }}
            >
              <FileAudio className="h-4 w-4 text-blue-600" />
              <span>Upload Audio</span>
            </button>
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted/50 cursor-pointer"
              onClick={() => {
                videoInputRef.current?.click();
                setNewMenuOpen(false);
              }}
            >
              <Video className="h-4 w-4 text-purple-600" />
              <span>Upload Video</span>
            </button>
          </PopoverContent>
        </Popover>
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

      {/* Audio Drop Overlay */}
      <AudioDropOverlay onUploadComplete={() => fetchMemories(true)} />

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        {/* Type filter dropdown */}
        <Popover open={typeFilterOpen} onOpenChange={setTypeFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="flex items-center gap-2 min-w-[150px] justify-between"
            >
              <span className="flex items-center gap-2">
                {(() => {
                  const option = TYPE_FILTER_OPTIONS.find(
                    (o) => o.value === typeFilter
                  );
                  const Icon = option?.icon || LayoutGrid;
                  return (
                    <>
                      <Icon className={cn("h-4 w-4", option?.iconColor)} />
                      <span>{option?.label || "All"}</span>
                    </>
                  );
                })()}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  typeFilterOpen && "rotate-180"
                )}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[180px] p-1" align="start">
            {TYPE_FILTER_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = typeFilter === option.value;
              return (
                <button
                  key={option.value}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm",
                    "hover:bg-muted/50 cursor-pointer",
                    isSelected && "bg-muted"
                  )}
                  onClick={() => {
                    setTypeFilter(option.value);
                    setTypeFilterOpen(false);
                  }}
                >
                  <Icon className={cn("h-4 w-4", option.iconColor)} />
                  <span className="flex-1 text-left">{option.label}</span>
                  {isSelected && (
                    <Check className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>

        {/* Date filter dropdown */}
        <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="flex items-center gap-2 min-w-[130px] justify-between"
            >
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>
                  {DATE_FILTER_OPTIONS.find((o) => o.value === dateFilter)
                    ?.label || "All Time"}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  dateFilterOpen && "rotate-180"
                )}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[150px] p-1" align="start">
            {DATE_FILTER_OPTIONS.map((option) => {
              const isSelected = dateFilter === option.value;
              return (
                <button
                  key={option.value}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm",
                    "hover:bg-muted/50 cursor-pointer",
                    isSelected && "bg-muted"
                  )}
                  onClick={() => {
                    setDateFilter(option.value);
                    setDateFilterOpen(false);
                  }}
                >
                  <span className="flex-1 text-left">{option.label}</span>
                  {isSelected && (
                    <Check className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>

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
              {memory.type === "voice_memo" || memory.type === "voice" ? (
                <VoiceMemoCard
                  memory={memory as Memory & { type: "voice_memo" | "voice" }}
                  onRemoveTag={handleRemoveTag}
                  onExpand={handleExpand}
                  formatDate={formatDate}
                />
              ) : memory.type === "audio" ? (
                <AudioCard
                  memory={memory as Memory & { type: "audio" }}
                  onRemoveTag={handleRemoveTag}
                  onExpand={handleExpand}
                  formatDate={formatDate}
                />
              ) : memory.type === "video" ? (
                <VideoCard
                  memory={memory as Memory & { type: "video" }}
                  onRemoveTag={handleRemoveTag}
                  onExpand={handleExpand}
                  formatDate={formatDate}
                />
              ) : (
                <MemoryCard
                  memory={memory as Memory & { type: "web" | "note" }}
                  onRemoveTag={handleRemoveTag}
                  onExpand={handleExpand}
                  onEdit={handleEdit}
                  formatDate={formatDate}
                />
              )}
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
