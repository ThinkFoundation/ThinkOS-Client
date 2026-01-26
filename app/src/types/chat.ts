export type ChatMode = "idle" | "active";

export interface SourceMemory {
  id: number;
  title: string;
  url?: string;
}

export interface AttachedMemory {
  id: number;
  title: string;
  type: "web" | "note" | "voice_memo" | "audio" | "video" | "document" | "voice"; // "voice" for backwards compat
  url?: string;
}

export type MemoryType = "web" | "note" | "voice_memo" | "audio" | "video" | "document" | "voice"; // "voice" for backwards compat

export type MediaSource = "recording" | "upload";

export type TranscriptionStatus = "pending" | "processing" | "completed" | "failed";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface MediaMemoryFields {
  audio_duration?: number;
  transcription_status?: TranscriptionStatus;
  transcript?: string;
  transcript_segments?: TranscriptSegment[];
  media_source?: MediaSource;
}

// Alias for backwards compatibility
export type VoiceMemoryFields = MediaMemoryFields;

export type VideoProcessingStatus = "pending_extraction" | "extracting" | "ready" | "failed";

export interface VideoMemoryFields extends MediaMemoryFields {
  video_duration?: number;
  video_width?: number;
  video_height?: number;
  thumbnail_path?: string;
  video_processing_status?: VideoProcessingStatus;
}

export interface DocumentMemoryFields {
  document_format?: string;
  document_page_count?: number;
  thumbnail_path?: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  created_at?: string;
  error?: boolean;
  sources?: SourceMemory[];
  searched?: boolean;
  isStreaming?: boolean;
  // Token usage (for assistant messages)
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface Conversation {
  id: number;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
}

export interface ConversationDetail {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
  context_window?: number;
}
