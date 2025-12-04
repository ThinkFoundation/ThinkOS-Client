import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Plus, Brain, MessageSquare } from "lucide-react";
import { API_BASE_URL } from "../constants";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { ChatInput } from "@/components/ChatInput";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useConversation } from "@/contexts/ConversationContext";
import { useConversations } from "@/hooks/useConversations";
import type { ChatMode, ChatMessage } from "@/types/chat";

interface Memory {
  id: number;
  url: string;
  title: string;
  created_at: string;
}

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

export default function HomePage({ userName }: HomePageProps) {
  const [message, setMessage] = useState("");
  const [recentMemories, setRecentMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const {
    currentConversationId,
    messages,
    isLoadingMessages,
    setCurrentConversationId,
    addMessage,
    selectConversation,
  } = useConversation();

  const { conversations } = useConversations();

  // Determine chat mode based on whether we have messages or a conversation
  const chatMode: ChatMode = messages.length > 0 || currentConversationId ? "active" : "idle";

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
      const res = await fetch(`${API_BASE_URL}/api/memories`);
      if (res.ok) {
        const data = await res.json();
        setRecentMemories((data.memories || []).slice(0, 5));
      }
    } catch (err) {
      console.error("Failed to fetch memories:", err);
    }
  };

  const handleChat = async () => {
    if (!message.trim()) return;

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message.trim(),
      timestamp: new Date(),
    };

    addMessage(userMessage);
    setMessage("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          conversation_id: currentConversationId,
        }),
      });

      const data = await res.json();

      // Update conversation ID if this was a new conversation
      if (data.conversation_id && !currentConversationId) {
        setCurrentConversationId(data.conversation_id);
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.error || data.response || "No response",
        timestamp: new Date(),
        error: !!data.error,
      };

      addMessage(assistantMessage);
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Failed to connect to the server",
        timestamp: new Date(),
        error: true,
      };
      addMessage(errorMessage);
      console.error("Chat failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Get recent chats (first 5)
  const recentChats = conversations.slice(0, 5);

  // Active chat mode layout
  if (chatMode === "active") {
    return (
      <div className="flex h-full">
        {/* Chat history sidebar */}
        <ChatSidebar />

        {/* Chat content */}
        <div className="flex-1 flex flex-col">
          {/* Messages area */}
          {isLoadingMessages ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground">Loading messages...</p>
            </div>
          ) : (
            <ChatMessageList messages={messages} isLoading={isLoading} />
          )}

          {/* Input at bottom */}
          <div className="flex-none p-4 border-t bg-background">
            <div className="max-w-2xl mx-auto">
              <ChatInput
                value={message}
                onChange={setMessage}
                onSubmit={handleChat}
                isLoading={isLoading}
                placeholder="Type your message..."
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Idle mode layout (original design with Recent Chats card)
  return (
    <div className="flex flex-col items-center justify-center min-h-full p-8">
      <div className="w-full max-w-3xl">
        <h1 className="text-4xl font-light text-center mb-8">
          {getGreeting(userName)}
        </h1>

        <div className="mb-8 max-w-2xl mx-auto">
          <ChatInput
            value={message}
            onChange={setMessage}
            onSubmit={handleChat}
            isLoading={isLoading}
            placeholder="Search for or ask anything..."
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Recent Memories */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Recent Memories
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentMemories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No memories yet
                </p>
              ) : (
                <ul className="space-y-2">
                  {recentMemories.map((memory) => (
                    <li
                      key={memory.id}
                      className="text-sm truncate text-muted-foreground"
                    >
                      {memory.title || "Untitled"}
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/memories">
                <Button variant="ghost" size="sm" className="mt-2 w-full">
                  View all
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Recent Chats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Recent Chats
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentChats.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No chats yet
                </p>
              ) : (
                <ul className="space-y-2">
                  {recentChats.map((chat) => (
                    <li
                      key={chat.id}
                      onClick={() => selectConversation(chat)}
                      className="text-sm truncate text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    >
                      {chat.title || "New conversation"}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Quick Add */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Quick Add
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Save a new memory manually
              </p>
              <Link to="/memories?add=true">
                <Button variant="outline" size="sm" className="w-full">
                  Add Memory
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
