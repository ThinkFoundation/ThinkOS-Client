import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { actions } from "@/lib/design-tokens";
import type { ChatMessage } from "@/types/chat";

interface ChatMessageActionsProps {
  message: ChatMessage;
}

export function ChatMessageActions({ message }: ChatMessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  // Don't show actions while streaming
  if (message.isStreaming) {
    return null;
  }

  return (
    <div
      className={cn(
        "absolute -top-3 right-0 flex gap-0.5 z-10",
        actions.container
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className={cn(actions.button, "bg-background/80 backdrop-blur-sm")}
        title="Copy message"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
