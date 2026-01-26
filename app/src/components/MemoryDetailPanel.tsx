import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  Globe,
  FileText,
  Mic,
  FileAudio,
  Video,
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
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Copy,
  SkipBack,
  SkipForward,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// Set up PDF.js worker - served from public folder (dev) or copied to dist (build)
// Use import.meta.url to resolve relative to the app base, works in both web and Electron
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "/pdf.worker.min.mjs",
  import.meta.url
).href;
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch, getAppToken } from "@/lib/api";
import { API_BASE_URL } from "@/constants";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { useConversation } from "../contexts/ConversationContext";
import type { TranscriptionStatus, TranscriptSegment, VideoProcessingStatus } from "@/types/chat";

interface MemoryTag {
  id: number;
  name: string;
  source: "ai" | "manual";
}

interface Memory {
  id: number;
  type: "web" | "note" | "voice_memo" | "audio" | "video" | "document" | "voice"; // "voice" for backwards compat
  url: string | null;
  title: string;
  content?: string;
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
  // Media-specific fields (voice memos and audio uploads)
  audio_duration?: number;
  transcript?: string;
  transcription_status?: TranscriptionStatus;
  transcript_segments?: TranscriptSegment[];
  media_source?: "recording" | "upload";
  // Video-specific fields
  video_duration?: number;
  video_width?: number;
  video_height?: number;
  thumbnail_path?: string;
  video_processing_status?: VideoProcessingStatus;
  // Document-specific fields
  document_format?: string;
  document_page_count?: number;
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
  onOpenEditor?: (memory: Memory) => void;
}

export function MemoryDetailPanel({
  memoryId,
  isOpen,
  onClose,
  onDelete,
  onMemoryUpdated,
  allTags,
  formatDate,
  onOpenEditor,
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

  // Voice memory state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Video player state
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoThumbnailUrl, setVideoThumbnailUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoBlobUrlRef = useRef<string | null>(null);
  const videoThumbnailUrlRef = useRef<string | null>(null);

  // Document viewer state
  const [documentThumbnailUrl, setDocumentThumbnailUrl] = useState<string | null>(null);
  const [showDocumentContent, setShowDocumentContent] = useState(false);
  const documentThumbnailUrlRef = useRef<string | null>(null);
  // PDF preview state
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const pdfBlobUrlRef = useRef<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { startNewChat, addAttachedMemory } = useConversation();

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

  // Fetch video thumbnail when memory has one
  useEffect(() => {
    if (!memory || memory.type !== "video" || !memory.thumbnail_path) {
      return;
    }

    let isCancelled = false;
    let blobUrl: string | null = null;

    const fetchThumbnail = async () => {
      try {
        const token = getAppToken();
        const response = await fetch(`${API_BASE_URL}/api/video/${memory.id}/thumbnail`, {
          headers: token ? { "X-App-Token": token } : {},
        });

        if (!response.ok) {
          throw new Error("Failed to load thumbnail");
        }

        const blob = await response.blob();

        // Check if component was unmounted during fetch
        if (isCancelled) {
          return;
        }

        blobUrl = URL.createObjectURL(blob);

        // Revoke previous URL if exists
        if (videoThumbnailUrlRef.current) {
          URL.revokeObjectURL(videoThumbnailUrlRef.current);
        }

        videoThumbnailUrlRef.current = blobUrl;
        setVideoThumbnailUrl(blobUrl);
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to load video thumbnail:", error);
        }
      }
    };

    fetchThumbnail();

    return () => {
      isCancelled = true;
      // Revoke both the ref URL and any URL created during this effect
      if (videoThumbnailUrlRef.current) {
        URL.revokeObjectURL(videoThumbnailUrlRef.current);
        videoThumbnailUrlRef.current = null;
      }
      if (blobUrl && blobUrl !== videoThumbnailUrlRef.current) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [memory?.id, memory?.type, memory?.thumbnail_path]);

  // Fetch document thumbnail when memory has one
  useEffect(() => {
    if (!memory || memory.type !== "document" || !memory.thumbnail_path) {
      return;
    }

    let isCancelled = false;
    let blobUrl: string | null = null;

    const fetchThumbnail = async () => {
      try {
        const token = getAppToken();
        const response = await fetch(`${API_BASE_URL}/api/document/${memory.id}/thumbnail`, {
          headers: token ? { "X-App-Token": token } : {},
        });

        if (!response.ok) {
          throw new Error("Failed to load thumbnail");
        }

        const blob = await response.blob();

        // Check if component was unmounted during fetch
        if (isCancelled) {
          return;
        }

        blobUrl = URL.createObjectURL(blob);

        // Revoke previous URL if exists
        if (documentThumbnailUrlRef.current) {
          URL.revokeObjectURL(documentThumbnailUrlRef.current);
        }

        documentThumbnailUrlRef.current = blobUrl;
        setDocumentThumbnailUrl(blobUrl);
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to load document thumbnail:", error);
        }
      }
    };

    fetchThumbnail();

    return () => {
      isCancelled = true;
      // Revoke both the ref URL and any URL created during this effect
      if (documentThumbnailUrlRef.current) {
        URL.revokeObjectURL(documentThumbnailUrlRef.current);
        documentThumbnailUrlRef.current = null;
      }
      if (blobUrl && blobUrl !== documentThumbnailUrlRef.current) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [memory?.id, memory?.type, memory?.thumbnail_path]);

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
    // Clear first, then attach memory (order matters - startNewChat clears attachments)
    startNewChat();
    addAttachedMemory({
      id: memory.id,
      title: memory.title,
      type: memory.type,
      url: memory.url || undefined,
    });
    onClose();
    navigate("/chat");
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

  // Voice/Audio memory functions
  const handlePlayPause = async () => {
    if (!memory || (memory.type !== "voice_memo" && memory.type !== "audio" && memory.type !== "voice")) return;

    if (!audioRef.current) {
      setIsAudioLoading(true);
      let blobUrl: string | null = null;

      try {
        const token = getAppToken();
        const response = await fetch(`${API_BASE_URL}/api/media/${memory.id}/stream`, {
          headers: token ? { "X-App-Token": token } : {},
        });

        if (!response.ok) {
          throw new Error("Failed to load audio");
        }

        const blob = await response.blob();
        blobUrl = URL.createObjectURL(blob);

        const audio = new Audio();
        blobUrlRef.current = blobUrl;
        audio.src = blobUrl;
        audio.onended = () => setIsPlaying(false);
        audio.oncanplay = () => {
          setIsAudioLoading(false);
          setDuration(audio.duration);
        };
        audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
        audio.onloadedmetadata = () => setDuration(audio.duration);
        audioRef.current = audio;
      } catch (error) {
        console.error("Failed to load audio:", error);
        // Clean up blob URL if it was created but setup failed
        if (blobUrl && !blobUrlRef.current) {
          URL.revokeObjectURL(blobUrl);
        }
        setIsAudioLoading(false);
        return;
      }
    }

    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      audioRef.current?.play();
      setIsPlaying(true);
    }
  };

  // Video playback functions
  const handleVideoPlayPause = async () => {
    if (!memory || memory.type !== "video") return;

    // If video not loaded yet, fetch it
    if (!videoSrc) {
      setIsVideoLoading(true);
      let blobUrl: string | null = null;

      try {
        const token = getAppToken();
        const response = await fetch(`${API_BASE_URL}/api/video/${memory.id}/stream`, {
          headers: token ? { "X-App-Token": token } : {},
        });

        if (!response.ok) {
          throw new Error("Failed to load video");
        }

        const blob = await response.blob();
        blobUrl = URL.createObjectURL(blob);
        videoBlobUrlRef.current = blobUrl;
        setVideoSrc(blobUrl);
        setIsVideoLoading(false);
        // Video will auto-play when loaded via onCanPlay handler
        return;
      } catch (error) {
        console.error("Failed to load video:", error);
        // Clean up blob URL if it was created but setup failed
        if (blobUrl && !videoBlobUrlRef.current) {
          URL.revokeObjectURL(blobUrl);
        }
        setIsVideoLoading(false);
        return;
      }
    }

    // Toggle play/pause
    if (isVideoPlaying) {
      videoRef.current?.pause();
      setIsVideoPlaying(false);
    } else {
      videoRef.current?.play();
      setIsVideoPlaying(true);
    }
  };

  const handleVideoSkip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(
        0,
        Math.min(videoRef.current.currentTime + seconds, videoRef.current.duration)
      );
    }
  };

  const handleVideoSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !videoDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = percent * videoDuration;
  };

  const handleVideoPlaybackRateChange = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const currentIndex = rates.indexOf(videoPlaybackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setVideoPlaybackRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
  };

  const handleVideoSeekToTime = async (time: number) => {
    if (!memory || memory.type !== "video") return;

    if (!videoRef.current) {
      setIsVideoLoading(true);
      const video = document.createElement("video");

      const token = getAppToken();
      const response = await fetch(`${API_BASE_URL}/api/video/${memory.id}/stream`, {
        headers: token ? { "X-App-Token": token } : {},
      });

      if (!response.ok) {
        console.error("Failed to load video");
        setIsVideoLoading(false);
        return;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      videoBlobUrlRef.current = blobUrl;
      video.src = blobUrl;
      video.onended = () => setIsVideoPlaying(false);
      video.oncanplay = () => {
        setIsVideoLoading(false);
        setVideoDuration(video.duration);
        video.currentTime = time;
        video.play();
        setIsVideoPlaying(true);
      };
      video.ontimeupdate = () => setVideoCurrentTime(video.currentTime);
      video.onloadedmetadata = () => setVideoDuration(video.duration);
      videoRef.current = video;
    } else {
      videoRef.current.currentTime = time;
      if (!isVideoPlaying) {
        videoRef.current.play();
        setIsVideoPlaying(true);
      }
    }
  };

  const handleSkip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(audioRef.current.currentTime + seconds, audioRef.current.duration)
      );
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = percent * duration;
  };

  const handlePlaybackRateChange = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleCopyTranscript = async () => {
    if (!memory?.transcript) return;
    try {
      await navigator.clipboard.writeText(memory.transcript);
      setCopiedTranscript(true);
      toast.success("Transcript copied to clipboard");
      setTimeout(() => setCopiedTranscript(false), 2000);
    } catch {
      toast.error("Failed to copy transcript");
    }
  };

  const handleSeekToTime = async (time: number) => {
    // For video type, use video seek
    if (memory?.type === "video") {
      handleVideoSeekToTime(time);
      return;
    }

    // Initialize audio if not already loaded
    if (!audioRef.current && (memory?.type === "voice_memo" || memory?.type === "audio" || memory?.type === "voice")) {
      setIsAudioLoading(true);
      const audio = new Audio();

      const token = getAppToken();
      const response = await fetch(
        `${API_BASE_URL}/api/media/${memory.id}/stream`,
        {
          headers: token ? { "X-App-Token": token } : {},
        }
      );

      if (!response.ok) {
        console.error("Failed to load audio");
        setIsAudioLoading(false);
        return;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;
      audio.src = blobUrl;
      audio.onended = () => setIsPlaying(false);
      audio.oncanplay = () => {
        setIsAudioLoading(false);
        setDuration(audio.duration);
        // Seek after audio is ready
        audio.currentTime = time;
        audio.play();
        setIsPlaying(true);
      };
      audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
      audio.onloadedmetadata = () => setDuration(audio.duration);
      audioRef.current = audio;
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleRetryTranscription = async () => {
    if (!memory || (memory.type !== "voice_memo" && memory.type !== "audio" && memory.type !== "voice" && memory.type !== "video")) return;
    setIsRetrying(true);

    try {
      // Use video endpoint for video type
      const endpoint = memory.type === "video"
        ? `/api/video/${memory.id}/retry`
        : `/api/media/${memory.id}/retry`;

      const res = await apiFetch(endpoint, {
        method: "POST",
      });

      if (res.ok) {
        setMemory((prev) =>
          prev ? { ...prev, transcription_status: "pending" } : null
        );
      }
    } catch (err) {
      console.error("Failed to retry transcription:", err);
    } finally {
      setIsRetrying(false);
    }
  };

  const formatDuration = (seconds: number | undefined): string => {
    if (seconds === undefined || seconds === null || !isFinite(seconds)) return "0:00";
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  // Load PDF file for preview
  const loadPdfFile = async (documentId: number) => {
    if (isPdfLoading) return;
    setIsPdfLoading(true);
    try {
      const token = getAppToken();
      const response = await fetch(`${API_BASE_URL}/api/document/${documentId}/file`, {
        headers: token ? { "X-App-Token": token } : {},
      });
      if (!response.ok) {
        throw new Error(`Failed to load PDF: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (pdfBlobUrlRef.current) {
        URL.revokeObjectURL(pdfBlobUrlRef.current);
      }
      pdfBlobUrlRef.current = url;
      setPdfData(url);
    } catch (error) {
      console.error("Failed to load PDF:", error);
      toast.error("Failed to load PDF");
    } finally {
      setIsPdfLoading(false);
    }
  };

  // Reset audio/video player when memory changes and cleanup blob URLs
  useEffect(() => {
    // Audio cleanup
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);
    setShowFullTranscript(false);

    // Video cleanup
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current = null;
    }
    if (videoBlobUrlRef.current) {
      URL.revokeObjectURL(videoBlobUrlRef.current);
      videoBlobUrlRef.current = null;
    }
    if (videoThumbnailUrlRef.current) {
      URL.revokeObjectURL(videoThumbnailUrlRef.current);
      videoThumbnailUrlRef.current = null;
    }
    setVideoSrc(null);
    setVideoThumbnailUrl(null);
    setIsVideoPlaying(false);
    setVideoCurrentTime(0);
    setVideoDuration(0);
    setVideoPlaybackRate(1);

    // Document cleanup
    if (documentThumbnailUrlRef.current) {
      URL.revokeObjectURL(documentThumbnailUrlRef.current);
      documentThumbnailUrlRef.current = null;
    }
    if (pdfBlobUrlRef.current) {
      URL.revokeObjectURL(pdfBlobUrlRef.current);
      pdfBlobUrlRef.current = null;
    }
    setDocumentThumbnailUrl(null);
    setShowDocumentContent(false);
    setPdfData(null);
    setPdfNumPages(0);
    setPdfPageNumber(1);
  }, [memoryId]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      if (videoBlobUrlRef.current) {
        URL.revokeObjectURL(videoBlobUrlRef.current);
      }
      if (videoThumbnailUrlRef.current) {
        URL.revokeObjectURL(videoThumbnailUrlRef.current);
      }
      if (documentThumbnailUrlRef.current) {
        URL.revokeObjectURL(documentThumbnailUrlRef.current);
      }
      if (pdfBlobUrlRef.current) {
        URL.revokeObjectURL(pdfBlobUrlRef.current);
      }
    };
  }, []);

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
                  ) : memory.type === "voice_memo" || memory.type === "voice" ? (
                    <Mic className="h-4 w-4 text-orange-600" />
                  ) : memory.type === "audio" ? (
                    <FileAudio className="h-4 w-4 text-blue-600" />
                  ) : memory.type === "video" ? (
                    <Video className="h-4 w-4 text-purple-600" />
                  ) : memory.type === "document" ? (
                    <FileText className="h-4 w-4 text-red-600" />
                  ) : (
                    <FileText className="h-4 w-4 text-amber-600" />
                  )}
                  <span className="text-sm capitalize">{memory.type === "voice_memo" ? "Voice Memo" : memory.type === "audio" ? "Audio" : memory.type === "voice" ? "Voice Memo" : memory.type === "video" ? "Video" : memory.type === "document" ? "Document" : memory.type}</span>
                  {/* Edit button only shown for web and note types.
                      Media types (voice, audio, video) and documents have immutable source files
                      where the content is extracted/transcribed - editing doesn't make sense. */}
                  {!isEditing && memory.type !== "voice_memo" && memory.type !== "audio" && memory.type !== "voice" && memory.type !== "video" && memory.type !== "document" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (memory.type === "note" && onOpenEditor) {
                          // For notes, open full editor directly
                          onOpenEditor(memory);
                        } else {
                          // For web memories, use inline title edit
                          setIsEditing(true);
                        }
                      }}
                      className="h-6 w-6 ml-auto"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {isEditing ? (
                  <>
                    {/* Title edit - for web memories only (notes use full editor) */}
                    <Input
                      ref={titleInputRef}
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      className="text-lg font-semibold"
                      placeholder="Title"
                    />
                    {/* Save/Cancel buttons */}
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

              {/* Voice Memory: Enhanced Audio Player */}
              {(memory.type === "voice_memo" || memory.type === "audio" || memory.type === "voice") && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-slate-100/50 dark:bg-white/5 space-y-3">
                    {/* Controls Row */}
                    <div className="flex items-center justify-center gap-2">
                      {/* Skip Back */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSkip(-10)}
                        disabled={isAudioLoading || !audioRef.current}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Back 10 seconds"
                      >
                        <SkipBack className="h-4 w-4" />
                      </Button>

                      {/* Play/Pause */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePlayPause}
                        disabled={isAudioLoading || memory.transcription_status === "processing"}
                        className={cn(
                          "h-12 w-12 rounded-full",
                          memory.type === "audio"
                            ? "bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600"
                            : "bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 text-orange-600"
                        )}
                      >
                        {isAudioLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : isPlaying ? (
                          <Pause className="h-5 w-5" />
                        ) : (
                          <Play className="h-5 w-5 ml-0.5" />
                        )}
                      </Button>

                      {/* Skip Forward */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSkip(10)}
                        disabled={isAudioLoading || !audioRef.current}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Forward 10 seconds"
                      >
                        <SkipForward className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Progress Bar */}
                    <div
                      className="relative h-1.5 bg-slate-200 dark:bg-white/10 rounded-full cursor-pointer group"
                      onClick={handleSeek}
                    >
                      <div
                        className="absolute h-full bg-purple-500 rounded-full transition-all"
                        style={{
                          width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                        }}
                      />
                      <div
                        className="absolute h-3 w-3 bg-purple-600 rounded-full -top-[3px] opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                        style={{
                          left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 6px)`,
                        }}
                      />
                    </div>

                    {/* Time Display & Playback Speed */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {formatDuration(currentTime)} /{" "}
                        {formatDuration(
                          duration ||
                            memory.audio_duration ||
                            (memory.transcript_segments?.length
                              ? memory.transcript_segments[
                                  memory.transcript_segments.length - 1
                                ].end
                              : 0)
                        )}
                      </span>
                      <button
                        onClick={handlePlaybackRateChange}
                        className="px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors font-medium"
                      >
                        {playbackRate}x
                      </button>
                    </div>

                    {/* Transcription Status */}
                    {memory.transcription_status &&
                      memory.transcription_status !== "completed" &&
                      (memory.transcription_status === "failed" || !memory.transcript) && (
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full font-medium",
                              memory.transcription_status === "pending" && "bg-muted text-muted-foreground",
                              memory.transcription_status === "processing" && "bg-muted text-muted-foreground",
                              memory.transcription_status === "failed" &&
                                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            )}
                          >
                            {memory.transcription_status === "processing" && (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            {memory.transcription_status === "pending"
                              ? "Pending"
                              : memory.transcription_status === "processing"
                                ? "Transcribing..."
                                : "Failed"}
                          </span>
                          {memory.transcription_status === "failed" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRetryTranscription}
                              disabled={isRetrying}
                            >
                              {isRetrying ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Video Player */}
              {memory.type === "video" && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-slate-100/50 dark:bg-white/5 space-y-3">
                    {/* Video Processing Status */}
                    {memory.video_processing_status && memory.video_processing_status !== "ready" && (
                      <div className="flex items-center justify-center p-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium",
                            memory.video_processing_status === "pending_extraction" &&
                              "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                            memory.video_processing_status === "extracting" &&
                              "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                            memory.video_processing_status === "failed" &&
                              "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}
                        >
                          {(memory.video_processing_status === "pending_extraction" || memory.video_processing_status === "extracting") && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          {memory.video_processing_status === "pending_extraction"
                            ? "Processing video..."
                            : memory.video_processing_status === "extracting"
                              ? "Extracting audio..."
                              : "Processing failed"}
                        </span>
                      </div>
                    )}

                    {/* Video Controls (only when ready) */}
                    {memory.video_processing_status === "ready" && (
                      <>
                        {/* Video/Thumbnail Display */}
                        <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
                          {videoSrc ? (
                            /* Loaded video */
                            <video
                              ref={videoRef}
                              src={videoSrc}
                              className="w-full h-full object-contain"
                              onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                              onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
                              onEnded={() => setIsVideoPlaying(false)}
                              onCanPlay={() => {
                                // Auto-play when first loaded
                                if (!isVideoPlaying && videoRef.current) {
                                  videoRef.current.play();
                                  setIsVideoPlaying(true);
                                }
                              }}
                            />
                          ) : (
                            /* Thumbnail preview with play button */
                            <>
                              {videoThumbnailUrl ? (
                                <img
                                  src={videoThumbnailUrl}
                                  alt={memory.title || "Video thumbnail"}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-800">
                                  <Video className="h-16 w-16 text-slate-600" />
                                </div>
                              )}
                              {/* Play button overlay */}
                              <button
                                onClick={handleVideoPlayPause}
                                disabled={isVideoLoading}
                                className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
                              >
                                {isVideoLoading ? (
                                  <Loader2 className="h-16 w-16 text-white animate-spin" />
                                ) : (
                                  <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                    <Play className="h-8 w-8 text-slate-900 ml-1" />
                                  </div>
                                )}
                              </button>
                            </>
                          )}
                        </div>

                        {/* Controls (only show after video loaded) */}
                        {videoSrc && (
                          <>
                            {/* Controls Row */}
                            <div className="flex items-center justify-center gap-2">
                              {/* Skip Back */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleVideoSkip(-10)}
                                disabled={isVideoLoading || !videoRef.current}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                title="Back 10 seconds"
                              >
                                <SkipBack className="h-4 w-4" />
                              </Button>

                              {/* Play/Pause */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleVideoPlayPause}
                                disabled={isVideoLoading}
                                className="h-12 w-12 rounded-full bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-600"
                              >
                                {isVideoLoading ? (
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                ) : isVideoPlaying ? (
                                  <Pause className="h-5 w-5" />
                                ) : (
                                  <Play className="h-5 w-5 ml-0.5" />
                                )}
                              </Button>

                              {/* Skip Forward */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleVideoSkip(10)}
                                disabled={isVideoLoading || !videoRef.current}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                title="Forward 10 seconds"
                              >
                                <SkipForward className="h-4 w-4" />
                              </Button>
                            </div>

                            {/* Progress Bar */}
                            <div
                              className="relative h-1.5 bg-slate-200 dark:bg-white/10 rounded-full cursor-pointer group"
                              onClick={handleVideoSeek}
                            >
                              <div
                                className="absolute h-full bg-purple-500 rounded-full transition-all"
                                style={{
                                  width: `${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%`,
                                }}
                              />
                              <div
                                className="absolute h-3 w-3 bg-purple-600 rounded-full -top-[3px] opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                                style={{
                                  left: `calc(${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}% - 6px)`,
                                }}
                              />
                            </div>

                            {/* Time Display & Playback Speed */}
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>
                                {formatDuration(videoCurrentTime)} / {formatDuration(videoDuration || memory.video_duration || 0)}
                              </span>
                              <button
                                onClick={handleVideoPlaybackRateChange}
                                className="px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors font-medium"
                              >
                                {videoPlaybackRate}x
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {/* Transcription Status */}
                    {memory.video_processing_status === "ready" && memory.transcription_status && memory.transcription_status !== "completed" && (memory.transcription_status === "failed" || !memory.transcript) && (
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full font-medium",
                            memory.transcription_status === "pending" && "bg-muted text-muted-foreground",
                            memory.transcription_status === "processing" && "bg-muted text-muted-foreground",
                            memory.transcription_status === "failed" &&
                              "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}
                        >
                          {memory.transcription_status === "processing" && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          {memory.transcription_status === "pending"
                            ? "Pending"
                            : memory.transcription_status === "processing"
                              ? "Transcribing..."
                              : "Failed"}
                        </span>
                        {memory.transcription_status === "failed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRetryTranscription}
                            disabled={isRetrying}
                          >
                            {isRetrying ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Document Viewer with PDF Preview */}
              {memory.type === "document" && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-slate-100/50 dark:bg-white/5 space-y-3">
                    {/* PDF Preview */}
                    <div className="relative rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800">
                      {pdfData ? (
                        <div className="flex flex-col items-center">
                          <Document
                            file={pdfData}
                            onLoadSuccess={({ numPages }) => setPdfNumPages(numPages)}
                            loading={
                              <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                              </div>
                            }
                            error={
                              <div className="flex items-center justify-center py-12 text-muted-foreground">
                                Failed to load PDF
                              </div>
                            }
                          >
                            <Page
                              pageNumber={pdfPageNumber}
                              width={350}
                              loading={
                                <div className="flex items-center justify-center py-12">
                                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                              }
                            />
                          </Document>
                        </div>
                      ) : documentThumbnailUrl ? (
                        <div
                          className="aspect-[4/3] cursor-pointer group relative"
                          onClick={() => loadPdfFile(memory.id)}
                        >
                          <img
                            src={documentThumbnailUrl}
                            alt={memory.title || "Document preview"}
                            className="w-full h-full object-contain"
                          />
                          {/* Click to preview overlay */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                            {isPdfLoading ? (
                              <Loader2 className="h-12 w-12 text-white animate-spin" />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                <FileText className="h-6 w-6 text-slate-900" />
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          className="aspect-[4/3] flex items-center justify-center cursor-pointer hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
                          onClick={() => loadPdfFile(memory.id)}
                        >
                          {isPdfLoading ? (
                            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
                          ) : (
                            <div className="text-center">
                              <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-2" />
                              <span className="text-sm text-muted-foreground">Click to preview</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Pagination Controls (shown when PDF is loaded) */}
                    {pdfData && memory.document_page_count && memory.document_page_count > 0 && (
                      <div className="flex items-center justify-center gap-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPdfPageNumber((prev) => Math.max(1, prev - 1))}
                          disabled={pdfPageNumber <= 1}
                          className="h-8 w-8"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {pdfPageNumber} of {memory.document_page_count}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPdfPageNumber((prev) => Math.min(memory.document_page_count!, prev + 1))}
                          disabled={pdfPageNumber >= memory.document_page_count}
                          className="h-8 w-8"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {/* Document Info & Actions */}
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground uppercase">
                        {memory.document_format || "PDF"}
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        title="Open in external app"
                        className="h-8 w-8"
                        onClick={async () => {
                          const filename = `${memory.title || "document"}.${memory.document_format || "pdf"}`;
                          if (window.electronAPI?.openDocumentWithSystem) {
                            const result = await window.electronAPI.openDocumentWithSystem(memory.id, filename);
                            if (!result.success) {
                              toast.error(result.error || "Failed to open document");
                            }
                          } else {
                            // Fallback for non-Electron: download the file
                            const token = getAppToken();
                            const response = await fetch(`${API_BASE_URL}/api/document/${memory.id}/file`, {
                              headers: token ? { "X-App-Token": token } : {},
                            });
                            if (response.ok) {
                              const blob = await response.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = filename;
                              a.click();
                              URL.revokeObjectURL(url);
                            } else {
                              toast.error("Failed to download document");
                            }
                          }
                        }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Extracted Content (collapsible) */}
                  {memory.content && (
                    <div className="space-y-2">
                      <button
                        className="flex items-center gap-2"
                        onClick={() => setShowDocumentContent(!showDocumentContent)}
                      >
                        <span className="text-sm font-medium">Extracted Text</span>
                        {showDocumentContent ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="relative">
                        <div
                          className={cn(
                            "text-sm text-muted-foreground leading-relaxed p-3 rounded-lg bg-slate-50 dark:bg-white/5 whitespace-pre-wrap",
                            showDocumentContent
                              ? "max-h-[300px] overflow-y-auto"
                              : "max-h-[5.5rem] overflow-hidden"
                          )}
                        >
                          {memory.content}
                        </div>
                        {!showDocumentContent && (
                          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-50 dark:from-zinc-900 to-transparent rounded-b-lg pointer-events-none" />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Transcript Section (for audio and video types) */}
              {(memory.type === "voice_memo" || memory.type === "audio" || memory.type === "voice" || memory.type === "video") && memory.transcript && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-2"
                      onClick={() => setShowFullTranscript(!showFullTranscript)}
                    >
                      <span className="text-sm font-medium">Transcript</span>
                      {showFullTranscript ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopyTranscript}
                      className="h-7 w-7"
                      title="Copy transcript"
                    >
                      {copiedTranscript ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  {memory.transcript_segments &&
                  memory.transcript_segments.length > 0 ? (
                    // Transcript with timestamps - show in both collapsed/expanded
                    <div
                      className={cn(
                        "relative text-sm p-3 rounded-lg bg-slate-50 dark:bg-white/5",
                        showFullTranscript
                          ? "max-h-[300px] overflow-y-auto"
                          : "max-h-[5.5rem] overflow-hidden"
                      )}
                    >
                      <div className="space-y-2">
                        {memory.transcript_segments.map((segment, index) => {
                          const playTime = memory.type === "video" ? videoCurrentTime : currentTime;
                          const isActive =
                            playTime >= segment.start &&
                            playTime < segment.end;
                          return (
                            <div
                              key={index}
                              className="group flex gap-2 items-start"
                            >
                              <button
                                onClick={() => handleSeekToTime(segment.start)}
                                className={cn(
                                  "flex-shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded",
                                  "transition-colors",
                                  isActive
                                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                                    : "text-muted-foreground hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/30 dark:hover:text-purple-400"
                                )}
                                title={`Jump to ${formatDuration(segment.start)}`}
                              >
                                {formatDuration(segment.start)}
                              </button>
                              <span
                                className={cn(
                                  "transition-colors",
                                  isActive
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                                )}
                              >
                                {segment.text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Fade gradient when collapsed */}
                      {!showFullTranscript && (
                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-50 dark:from-zinc-900 to-transparent rounded-b-lg pointer-events-none" />
                      )}
                    </div>
                  ) : (
                    // Fallback: plain text for memories without segments
                    <div className="relative">
                      <div
                        className={cn(
                          "text-sm text-muted-foreground leading-relaxed p-3 rounded-lg bg-slate-50 dark:bg-white/5",
                          showFullTranscript
                            ? "max-h-[300px] overflow-y-auto"
                            : "line-clamp-3"
                        )}
                      >
                        {memory.transcript}
                      </div>
                      {!showFullTranscript && (
                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-50 dark:from-zinc-900 to-transparent rounded-b-lg pointer-events-none" />
                      )}
                    </div>
                  )}
                </div>
              )}

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
