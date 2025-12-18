export type ChatMode = "idle" | "active";

export interface SourceMemory {
  id: number;
  title: string;
  url?: string;
}

export interface AttachedMemory {
  id: number;
  title: string;
  type: "web" | "note";
  url?: string;
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
