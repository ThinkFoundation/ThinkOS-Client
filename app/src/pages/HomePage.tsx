import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Plus, Brain, MessageSquare } from "lucide-react";
import { useMemoryEvents } from "../hooks/useMemoryEvents";
import { apiFetch } from "@/lib/api";
import { ChatInput } from "@/components/ChatInput";
import { useConversation } from "@/contexts/ConversationContext";
import { useConversations } from "@/hooks/useConversations";

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
  const navigate = useNavigate();

  const {
    selectConversation,
    setPendingMessage,
  } = useConversation();

  const { conversations } = useConversations();

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

  // Get recent chats (first 5)
  const recentChats = conversations.slice(0, 5);

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
            isLoading={false}
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
                <ul className="space-y-1">
                  {recentMemories.map((memory) => (
                    <li key={memory.id}>
                      <Link
                        to={`/memories?open=${memory.id}`}
                        className="block text-sm truncate text-muted-foreground hover:text-foreground transition-colors py-1 -mx-2 px-2 rounded hover:bg-muted"
                      >
                        {memory.title || "Untitled"}
                      </Link>
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
                      onClick={() => {
                        selectConversation(chat);
                        navigate("/chat");
                      }}
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
