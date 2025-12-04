export type ChatMode = "idle" | "active";

export interface ChatMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  created_at?: string;
  error?: boolean;
}

export interface Conversation {
  id: number;
  title: string;
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
}
