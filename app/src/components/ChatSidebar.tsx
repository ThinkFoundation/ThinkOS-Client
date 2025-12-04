import { MessageSquare, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversations } from "@/hooks/useConversations";
import { useConversation } from "@/contexts/ConversationContext";
import { cn } from "@/lib/utils";

export function ChatSidebar() {
  const { conversations, deleteConversation } = useConversations();
  const { currentConversationId, selectConversation, startNewChat } = useConversation();

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const success = await deleteConversation(id);
    if (success && currentConversationId === id) {
      startNewChat();
    }
  };

  return (
    <aside className="w-60 h-full border-r bg-muted/20 flex flex-col">
      {/* Header with New Chat button */}
      <div className="p-3 border-b">
        <Button
          variant="outline"
          size="sm"
          onClick={startNewChat}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            No conversations yet
          </p>
        ) : (
          <div className="space-y-1">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => selectConversation(conversation)}
                className={cn(
                  "group flex items-center gap-2 px-2 py-2 rounded-md text-sm cursor-pointer transition-colors",
                  currentConversationId === conversation.id
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate text-xs">
                  {conversation.title || "New conversation"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => handleDelete(e, conversation.id)}
                  title="Delete conversation"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
