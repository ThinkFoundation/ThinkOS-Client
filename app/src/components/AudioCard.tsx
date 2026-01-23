import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  FileAudio,
  X,
  PanelRight,
  Play,
  Pause,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAppToken } from "@/lib/api";
import { API_BASE_URL } from "@/constants";
import type { TranscriptionStatus } from "@/types/chat";

interface MemoryTag {
  id: number;
  name: string;
  source: "ai" | "manual";
}

interface AudioMemory {
  id: number;
  type: "audio";
  title: string;
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
  audio_duration?: number;
  transcription_status?: TranscriptionStatus;
}

interface AudioCardProps {
  memory: AudioMemory;
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

function TranscriptionStatusBadge({ status }: { status?: TranscriptionStatus }) {
  if (!status || status === "completed") return null;

  const statusConfig = {
    pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
    processing: { label: "Transcribing...", className: "bg-muted text-muted-foreground" },
    failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full font-medium",
      config.className
    )}>
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {config.label}
    </span>
  );
}

export function AudioCard({
  memory,
  onRemoveTag,
  onExpand,
  formatDate,
}: AudioCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Cleanup audio element and blob URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Pause and clean up audio element
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      // Revoke blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const handlePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!audioRef.current) {
      // Create audio element on first play
      setIsLoading(true);
      const audio = new Audio();

      // Fetch audio with auth token
      const token = getAppToken();
      const response = await fetch(`${API_BASE_URL}/api/media/${memory.id}/stream`, {
        headers: token ? { "X-App-Token": token } : {},
      });

      if (!response.ok) {
        console.error("Failed to load audio");
        setIsLoading(false);
        return;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;
      audio.src = blobUrl;
      audio.onended = () => setIsPlaying(false);
      audio.oncanplay = () => setIsLoading(false);
      audioRef.current = audio;
    }

    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      audioRef.current?.play();
      setIsPlaying(true);
    }
  };

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
          "absolute top-3 right-3 flex gap-0.5",
          "opacity-0 group-hover:opacity-100",
          "transition-opacity duration-200"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onExpand(memory.id)}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="View Details"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Header: Audio icon + Title */}
      <div className="flex items-start gap-2.5 mb-3 pr-14">
        <div className="mt-0.5">
          <FileAudio className="h-4 w-4 text-blue-600" />
        </div>
        <h3 className="font-medium text-[15px] leading-snug line-clamp-2">
          {memory.title || "Audio File"}
        </h3>
      </div>

      {/* Audio Player */}
      <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-slate-100/50 dark:bg-white/5">
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePlayPause}
          disabled={isLoading || memory.transcription_status === "processing"}
          className="h-9 w-9 rounded-full bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </Button>
        <div className="flex-1">
          <div className="text-sm font-medium">
            {formatDuration(memory.audio_duration)}
          </div>
          <TranscriptionStatusBadge status={memory.transcription_status} />
        </div>
      </div>

      {/* Summary */}
      {memory.summary ? (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-3">
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
      <p className="text-[11px] text-muted-foreground/70">
        {formatDate(memory.created_at)}
      </p>
    </div>
  );
}
