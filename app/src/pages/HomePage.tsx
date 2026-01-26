import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Brain,
  MessageSquare,
  Globe,
  FileText,
  Mic,
  FileAudio,
  Video,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { apiFetch } from "@/lib/api";
import { ChatInput } from "@/components/ChatInput";
import { useConversation } from "@/contexts/ConversationContext";
import { useConversations } from "@/hooks/useConversations";
import { useVideoUpload } from "@/hooks/useVideoUpload";
import { useDocumentUpload, isDocumentFile, validateDocumentSize } from "@/hooks/useDocumentUpload";
import { ArrowRight } from "lucide-react";

type MemoryType = "web" | "note" | "voice_memo" | "audio" | "video" | "voice" | "document";

interface Memory {
  id: number;
  type: MemoryType;
  url: string;
  title: string;
  created_at: string;
}

const MEMORY_TYPE_CONFIG: Record<
  MemoryType,
  { icon: typeof Globe; colorClass: string }
> = {
  web: { icon: Globe, colorClass: "text-muted-foreground" },
  note: { icon: FileText, colorClass: "text-amber-600" },
  voice_memo: { icon: Mic, colorClass: "text-orange-600" },
  voice: { icon: Mic, colorClass: "text-orange-600" }, // backwards compat
  audio: { icon: FileAudio, colorClass: "text-blue-600" },
  video: { icon: Video, colorClass: "text-purple-600" },
  document: { icon: FileText, colorClass: "text-red-600" },
};

interface HomePageProps {
  userName?: string | null;
}

function getGreeting(name?: string | null): string {
  const hour = new Date().getHours();
  let greeting: string;
  if (hour < 12) {
    greeting = "Good morning";
  } else if (hour < 18) {
    greeting = "Good afternoon";
  } else {
    greeting = "Good evening";
  }
  return name ? `${greeting}, ${name}` : greeting;
}

const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "webm", "ogg", "flac"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv", "avi"];
const DOCUMENT_EXTENSIONS = ["pdf"];
const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB

export default function HomePage({ userName }: HomePageProps) {
  const [message, setMessage] = useState("");
  const [recentMemories, setRecentMemories] = useState<Memory[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const navigate = useNavigate();

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const { selectConversation, setPendingMessage } = useConversation();

  const { conversations } = useConversations();
  const { uploadVideo, isUploading: isUploadingVideo } = useVideoUpload();
  const { uploadDocument, isUploading: isUploadingDocument } = useDocumentUpload();

  useEffect(() => {
    fetchRecentMemories();
  }, []);

  // Real-time updates via SSE
  useMemoryEvents({
    onMemoryCreated: (_memoryId, data) => {
      const memory = data as Memory;
      setRecentMemories((prev) => {
        if (prev.some((m) => m.id === memory.id)) return prev;
        return [memory, ...prev].slice(0, 5);
      });
    },
    onMemoryUpdated: (memoryId, data) => {
      const memory = data as Memory;
      setRecentMemories((prev) =>
        prev.map((m) => (m.id === memoryId ? memory : m))
      );
    },
    onMemoryDeleted: (memoryId) => {
      setRecentMemories((prev) => prev.filter((m) => m.id !== memoryId));
    },
  });

  const fetchRecentMemories = async () => {
    try {
      const res = await apiFetch("/api/memories");
      if (res.ok) {
        const data = await res.json();
        setRecentMemories((data.memories || []).slice(0, 5));
      }
    } catch (err) {
      console.error("Failed to fetch memories:", err);
    }
  };

  const handleChat = () => {
    if (!message.trim()) return;

    // Navigate to chat page with the message
    setPendingMessage(message);
    navigate("/chat");
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext) {
      toast.error("Could not determine file type");
      return;
    }

    const isAudio = AUDIO_EXTENSIONS.includes(ext);
    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    const isDocument = isDocumentFile(file);

    if (!isAudio && !isVideo && !isDocument) {
      toast.error(`Unsupported format. Use: ${[...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...DOCUMENT_EXTENSIONS].join(", ")}`);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }

    // Validate sizes (document validation is handled by the hook)
    if (isAudio && file.size > MAX_AUDIO_SIZE) {
      toast.error("File too large. Maximum size is 100 MB.");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    if (isVideo && file.size > MAX_VIDEO_SIZE) {
      toast.error("File too large. Maximum size is 500 MB.");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    if (isDocument) {
      const sizeValidation = validateDocumentSize(file);
      if (!sizeValidation.valid) {
        toast.error(sizeValidation.error!);
        if (uploadInputRef.current) uploadInputRef.current.value = "";
        return;
      }
    }

    if (isVideo) {
      // Use the video upload hook for proper FFmpeg processing
      toast.info("Processing video...", { description: "Extracting audio for transcription" });
      const result = await uploadVideo(file);
      if (result.success) {
        toast.success("Video uploaded successfully");
        navigate("/memories");
      } else {
        toast.error(result.error || "Failed to upload video");
      }
    } else if (isDocument) {
      // Upload document (PDF) using the hook
      const result = await uploadDocument(file);
      if (result.success) {
        toast.success("Document uploaded successfully");
        navigate("/memories");
      } else {
        toast.error(result.error || "Failed to upload document");
      }
    } else {
      // Direct upload for audio files
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await apiFetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          toast.success("Audio uploaded successfully");
          navigate("/memories");
        } else {
          const data = await res.json();
          toast.error(data.detail || "Failed to upload audio");
        }
      } catch {
        toast.error("Failed to upload audio");
      } finally {
        setIsUploading(false);
      }
    }

    if (uploadInputRef.current) uploadInputRef.current.value = "";
  };

  const handleVoiceMemo = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openRecordingWindow) {
      electronAPI.openRecordingWindow();
    } else {
      toast.error("Voice recording is only available in the desktop app");
    }
  };

  // Get recent chats (first 5)
  const recentChats = conversations.slice(0, 5);

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-8">
      <div className="w-full max-w-3xl">
        <h1 className="text-4xl font-light text-center mb-8">
          {getGreeting(userName)}
        </h1>

        <div className="mb-10 max-w-2xl mx-auto">
          <ChatInput
            value={message}
            onChange={setMessage}
            onSubmit={handleChat}
            isLoading={false}
            placeholder="Search for or ask anything..."
          />

          {/* Action Chips */}
          <div className="flex items-center justify-center gap-3 mt-5">
            <button
              onClick={() => navigate("/memories?add=true")}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full",
                "text-xs font-medium text-muted-foreground",
                "bg-white/5 backdrop-blur-sm border border-white/10",
                "hover:bg-white/10 hover:text-foreground hover:border-white/20",
                "hover:-translate-y-0.5",
                "transition-all duration-200"
              )}
            >
              <FileText className="h-4 w-4 text-amber-500" />
              Note
            </button>
            <button
              onClick={handleVoiceMemo}
              disabled={isUploading || isUploadingVideo || isUploadingDocument}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full",
                "text-xs font-medium text-muted-foreground",
                "bg-white/5 backdrop-blur-sm border border-white/10",
                "hover:bg-white/10 hover:text-foreground hover:border-white/20",
                "hover:-translate-y-0.5",
                "transition-all duration-200",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              )}
            >
              <Mic className="h-4 w-4 text-orange-500" />
              Voice
            </button>
            <button
              onClick={() => uploadInputRef.current?.click()}
              disabled={isUploading || isUploadingVideo || isUploadingDocument}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full",
                "text-xs font-medium text-muted-foreground",
                "bg-white/5 backdrop-blur-sm border border-white/10",
                "hover:bg-white/10 hover:text-foreground hover:border-white/20",
                "hover:-translate-y-0.5",
                "transition-all duration-200",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              )}
            >
              <Upload className="h-4 w-4 text-blue-500" />
              Upload
            </button>
            <button
              onClick={() => navigate("/chat?new=true")}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full",
                "text-xs font-medium text-muted-foreground",
                "bg-white/5 backdrop-blur-sm border border-white/10",
                "hover:bg-white/10 hover:text-foreground hover:border-white/20",
                "hover:-translate-y-0.5",
                "transition-all duration-200"
              )}
            >
              <MessageSquare className="h-4 w-4 text-primary" />
              Chat
            </button>
          </div>

          {/* Hidden file input for uploads */}
          <input
            ref={uploadInputRef}
            type="file"
            accept={[...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...DOCUMENT_EXTENSIONS].map((e) => `.${e}`).join(",")}
            onChange={handleUpload}
            className="hidden"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Recent Memories */}
          <Card className="relative overflow-hidden hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20 transition-shadow duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            <CardHeader className="pb-3 relative">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Recent Memories
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              {recentMemories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No memories yet</p>
              ) : (
                <ul className="space-y-0.5">
                  {recentMemories.map((memory) => {
                    const config = MEMORY_TYPE_CONFIG[memory.type] || MEMORY_TYPE_CONFIG.web;
                    const TypeIcon = config.icon;
                    return (
                      <li key={memory.id}>
                        <Link
                          to={`/memories?open=${memory.id}`}
                          className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground transition-colors py-2 -mx-2 px-2 rounded-md hover:bg-muted"
                        >
                          <TypeIcon className={cn("h-4 w-4 flex-shrink-0", config.colorClass)} />
                          <span className="truncate">{memory.title || "Untitled"}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link to="/memories" className="block mt-4">
                <span className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  View all
                  <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </CardContent>
          </Card>

          {/* Recent Chats */}
          <Card className="relative overflow-hidden hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20 transition-shadow duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            <CardHeader className="pb-3 relative">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Recent Chats
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              {recentChats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No chats yet</p>
              ) : (
                <ul className="space-y-0.5">
                  {recentChats.map((chat) => (
                    <li
                      key={chat.id}
                      onClick={() => {
                        selectConversation(chat);
                        navigate("/chat");
                      }}
                      className="text-sm truncate text-muted-foreground hover:text-foreground cursor-pointer transition-colors py-2 -mx-2 px-2 rounded-md hover:bg-muted"
                    >
                      {chat.title || "New conversation"}
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/chat" className="block mt-4">
                <span className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  View all
                  <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
