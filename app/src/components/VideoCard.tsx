import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Video,
  X,
  PanelRight,
  Play,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAppToken } from "@/lib/api";
import { API_BASE_URL } from "@/constants";
import type { TranscriptionStatus, VideoProcessingStatus } from "@/types/chat";

interface MemoryTag {
  id: number;
  name: string;
  source: "ai" | "manual";
}

interface VideoMemory {
  id: number;
  type: "video";
  title: string;
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
  video_duration?: number;
  video_width?: number;
  video_height?: number;
  thumbnail_path?: string;
  video_processing_status?: VideoProcessingStatus;
  transcription_status?: TranscriptionStatus;
}

interface VideoCardProps {
  memory: VideoMemory;
  onRemoveTag: (memoryId: number, tagId: number) => void;
  onExpand: (id: number) => void;
  formatDate: (date: string) => string;
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function ProcessingStatusBadge({
  videoStatus,
  transcriptionStatus,
}: {
  videoStatus?: VideoProcessingStatus;
  transcriptionStatus?: TranscriptionStatus;
}) {
  // Show video processing status if not ready
  if (videoStatus && videoStatus !== "ready") {
    const statusConfig = {
      pending_extraction: {
        label: "Processing...",
        className: "bg-muted text-muted-foreground",
      },
      extracting: {
        label: "Extracting Audio...",
        className: "bg-muted text-muted-foreground",
      },
      failed: {
        label: "Processing Failed",
        className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      },
    };
    const config = statusConfig[videoStatus] || statusConfig.pending_extraction;

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full font-medium",
          config.className
        )}
      >
        {(videoStatus === "pending_extraction" || videoStatus === "extracting") && (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
        {config.label}
      </span>
    );
  }

  // Show transcription status if video is ready
  if (!transcriptionStatus || transcriptionStatus === "completed") return null;

  const statusConfig = {
    pending: {
      label: "Pending Transcription",
      className: "bg-muted text-muted-foreground",
    },
    processing: {
      label: "Transcribing...",
      className: "bg-muted text-muted-foreground",
    },
    failed: {
      label: "Transcription Failed",
      className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
  };

  const config = statusConfig[transcriptionStatus] || statusConfig.pending;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full font-medium",
        config.className
      )}
    >
      {transcriptionStatus === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {config.label}
    </span>
  );
}

export function VideoCard({ memory, onRemoveTag, onExpand, formatDate }: VideoCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoadingThumbnail, setIsLoadingThumbnail] = useState(false);
  const thumbnailLoadedRef = useRef(false);

  // Load thumbnail on mount
  useEffect(() => {
    if (!memory.thumbnail_path || thumbnailLoadedRef.current) return;

    thumbnailLoadedRef.current = true;
    setIsLoadingThumbnail(true);

    const token = getAppToken();
    fetch(`${API_BASE_URL}/api/video/${memory.id}/thumbnail`, {
      headers: token ? { "X-App-Token": token } : {},
    })
      .then((response) => {
        if (response.ok) return response.blob();
        throw new Error("Failed to load thumbnail");
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        setThumbnailUrl(url);
      })
      .catch((error) => {
        console.error("Failed to load thumbnail:", error);
      })
      .finally(() => {
        setIsLoadingThumbnail(false);
      });

    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [memory.id, memory.thumbnail_path]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [thumbnailUrl]);

  return (
    <div
      className={cn(
        "group relative p-5 rounded-2xl",
        // Glassmorphism - light mode
        "bg-white/70 dark:bg-white/5 backdrop-blur-md",
        "border border-white/60 dark:border-white/10",
        "shadow-sm shadow-black/5 dark:shadow-black/20",
        // Hover lift effect
        "hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30",
        "hover:-translate-y-0.5",
        "transition-all duration-200"
      )}
    >
      {/* Hover actions - top right */}
      <div
        className={cn(
          "absolute top-3 right-3 flex gap-0.5 z-10",
          "opacity-0 group-hover:opacity-100",
          "transition-opacity duration-200"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onExpand(memory.id)}
          className="h-7 w-7 text-muted-foreground hover:text-foreground bg-background/80 backdrop-blur-sm"
          title="View Details"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Thumbnail */}
      <div
        className="relative aspect-video rounded-lg overflow-hidden mb-3 bg-slate-100 dark:bg-slate-800 cursor-pointer"
        onClick={() => onExpand(memory.id)}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={memory.title}
            className="w-full h-full object-cover"
          />
        ) : isLoadingThumbnail ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Video className="h-12 w-12 text-muted-foreground/50" />
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-6 w-6 text-slate-900 ml-0.5" />
          </div>
        </div>

        {/* Duration badge */}
        {memory.video_duration !== undefined && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs font-medium">
            {formatDuration(memory.video_duration)}
          </div>
        )}
      </div>

      {/* Header: Video icon + Title */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className="mt-0.5">
          <Video className="h-4 w-4 text-purple-600" />
        </div>
        <h3 className="font-medium text-[15px] leading-snug line-clamp-2">
          {memory.title || "Video"}
        </h3>
      </div>

      {/* Processing status */}
      <div className="mb-2">
        <ProcessingStatusBadge
          videoStatus={memory.video_processing_status}
          transcriptionStatus={memory.transcription_status}
        />
      </div>

      {/* Summary */}
      {memory.summary ? (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-2">
          {memory.summary}
        </p>
      ) : memory.transcription_status === "completed" ? (
        <p className="text-sm text-muted-foreground/50 italic mb-4">
          Generating summary...
        </p>
      ) : null}

      {/* Tags */}
      {memory.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {memory.tags.map((tag) => (
            <span
              key={tag.id}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full",
                "transition-colors",
                tag.source === "ai"
                  ? "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
                  : "bg-primary/10 text-primary"
              )}
            >
              {tag.name}
              {tag.source === "manual" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTag(memory.id, tag.id);
                  }}
                  className="hover:text-primary/70 -mr-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Date */}
      <p className="text-[11px] text-muted-foreground/70">{formatDate(memory.created_at)}</p>
    </div>
  );
}
