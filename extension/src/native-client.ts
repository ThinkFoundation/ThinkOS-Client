/**
 * Native messaging client for secure communication with Think backend.
 *
 * Uses Chrome's native messaging API to communicate with the desktop app
 * via a native host process, bypassing HTTP entirely for improved security.
 */

const NATIVE_HOST_NAME = "com.think.native";

interface NativeRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface NativeResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class NativeClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, PendingRequest>();
  private connectionError: string | null = null;

  /**
   * Connect to the native host.
   * Returns true if connected successfully, false otherwise.
   */
  connect(): boolean {
    if (this.port) {
      return true;
    }

    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.connectionError = null;

      this.port.onMessage.addListener((response: NativeResponse) => {
        const pending = this.pending.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
          this.pending.delete(response.id);
        }
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || "Native host disconnected";
        this.connectionError = error;
        this.port = null;

        // Reject all pending requests
        for (const [_id, { reject, timeout }] of this.pending) {
          clearTimeout(timeout);
          reject(new Error(error));
        }
        this.pending.clear();
      });

      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown connection error";
      this.connectionError = message;
      return false;
    }
  }

  /**
   * Send a request to the native host and wait for response.
   */
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    // Try to connect if not connected
    if (!this.port) {
      if (!this.connect()) {
        throw new Error(this.connectionError || "Failed to connect to Think app");
      }
    }

    // Double check connection after connect()
    if (!this.port) {
      throw new Error(this.connectionError || "Not connected to Think app");
    }

    const id = crypto.randomUUID();
    const request: NativeRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 30000);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      try {
        this.port!.postMessage(request);
      } catch (e) {
        clearTimeout(timeout);
        this.pending.delete(id);
        const message = e instanceof Error ? e.message : "Failed to send message";
        reject(new Error(message));
      }
    });
  }

  /**
   * Check if native messaging is available and the app is running.
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try a simple connection
      if (!this.connect()) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the last connection error, if any.
   */
  getLastError(): string | null {
    return this.connectionError;
  }

  /**
   * Disconnect from native host.
   */
  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }
}

// Export singleton instance
export const nativeClient = new NativeClient();

// Convenience methods matching the API endpoints

export interface MemoryData {
  url?: string;
  title: string;
  content: string;
  type?: string;
}

export interface MemoryResult {
  id: number;
  title: string;
  content: string;
  url?: string;
  created_at: string;
}

export interface DuplicateResult {
  duplicate: true;
  existing_memory: MemoryResult;
}

export interface CreateResult {
  id: number;
  title: string;
  created_at: string;
}

export type SaveMemoryResult = CreateResult | DuplicateResult;

/**
 * Save a new memory via native messaging.
 */
export async function saveMemory(data: MemoryData): Promise<SaveMemoryResult> {
  return nativeClient.request<SaveMemoryResult>("memories.create", { ...data });
}

/**
 * Update an existing memory via native messaging.
 */
export async function updateMemory(
  id: number,
  data: MemoryData
): Promise<MemoryResult> {
  return nativeClient.request<MemoryResult>("memories.update", { id, ...data });
}

/**
 * Chat message data for page chat.
 */
export interface ChatMessageData {
  message: string;
  page_content?: string;
  page_url?: string;
  page_title?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Source memory reference returned with chat responses.
 */
export interface SourceMemory {
  id: number;
  title: string;
  url?: string;
}

/**
 * Chat response from the backend.
 */
export interface ChatResponse {
  response: string;
  sources?: SourceMemory[];
}

/**
 * Send a chat message with page context via native messaging.
 */
export async function sendChatMessage(data: ChatMessageData): Promise<ChatResponse> {
  return nativeClient.request<ChatResponse>("chat.message", { ...data });
}

/**
 * Save conversation to app data.
 */
export interface SaveConversationData {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  page_title?: string;
  page_url?: string;
}

export interface SaveConversationResult {
  conversation_id: number;
  title: string;
}

export async function saveConversation(data: SaveConversationData): Promise<SaveConversationResult> {
  return nativeClient.request<SaveConversationResult>("conversations.save", { ...data });
}

/**
 * Generate AI summary of chat and save as memory.
 */
export interface SummarizeChatData {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  page_title?: string;
  page_url?: string;
}

export interface SummarizeChatResult {
  memory_id: number;
  title: string;
  summary: string;
}

export async function summarizeChat(data: SummarizeChatData): Promise<SummarizeChatResult> {
  return nativeClient.request<SummarizeChatResult>("chat.summarize", { ...data });
}
