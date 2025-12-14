import { useState, useMemo } from "react";
import { MessageSquare, Trash2, Plus, Pin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversations } from "@/hooks/useConversations";
import { useConversation } from "@/contexts/ConversationContext";
import { cn } from "@/lib/utils";
import {
  groupConversations,
  filterConversations,
  GROUP_LABELS,
  type TimeGroup,
} from "@/lib/conversationUtils";
import type { Conversation } from "@/types/chat";

interface ChatSidebarProps {
  onNewChat: () => void;
}

export function ChatSidebar({ onNewChat }: ChatSidebarProps) {
  const { conversations, deleteConversation, togglePinConversation } =
    useConversations();
  const { currentConversationId, selectConversation } = useConversation();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and group conversations
  const filteredConversations = useMemo(
    () => filterConversations(conversations, searchQuery),
    [conversations, searchQuery]
  );

  const groupedConversations = useMemo(
    () => groupConversations(filteredConversations),
    [filteredConversations]
  );

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const success = await deleteConversation(id);
    if (success && currentConversationId === id) {
      onNewChat();
    }
  };

  const handleTogglePin = async (e: React.MouseEvent, conversation: Conversation) => {
    e.stopPropagation();
    await togglePinConversation(conversation.id, !conversation.pinned);
  };

  const renderConversationItem = (conversation: Conversation) => (
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
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => handleTogglePin(e, conversation)}
          title={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
        >
          <Pin
            className={cn(
              "h-3 w-3",
              conversation.pinned
                ? "text-primary fill-primary"
                : "text-muted-foreground"
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => handleDelete(e, conversation.id)}
          title="Delete conversation"
        >
          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    </div>
  );

  const renderGroup = (groupKey: TimeGroup, groupConversations: Conversation[]) => {
    if (groupConversations.length === 0) return null;

    return (
      <div key={groupKey} className="mb-3">
        <h3 className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {GROUP_LABELS[groupKey]}
        </h3>
        <div className="space-y-0.5">
          {groupConversations.map(renderConversationItem)}
        </div>
      </div>
    );
  };

  const groupOrder: TimeGroup[] = [
    "pinned",
    "today",
    "yesterday",
    "previous_7_days",
    "previous_30_days",
    "older",
  ];

  return (
    <aside className="w-60 h-full border-r bg-muted/20 flex flex-col">
      {/* Header with New Chat button */}
      <div className="p-3 border-b">
        <Button
          variant="outline"
          size="sm"
          onClick={onNewChat}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Search input */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 pr-7 h-7 text-xs"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredConversations.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            {searchQuery ? "No matching conversations" : "No conversations yet"}
          </p>
        ) : (
          groupOrder.map((group) =>
            renderGroup(group, groupedConversations[group])
          )
        )}
      </div>
    </aside>
  );
}
