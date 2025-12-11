import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef, useEffect } from "react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Type your message...",
  className,
}: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Auto-focus input after message submission (when loading completes)
  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 p-2 rounded-full",
        // Glassmorphism
        "bg-white/70 dark:bg-white/5 backdrop-blur-xl",
        "border border-white/60 dark:border-white/10",
        // Floating shadow
        "shadow-lg shadow-black/5 dark:shadow-black/20",
        className
      )}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        className={cn(
          "flex-1 bg-transparent px-4 py-2 text-base",
          "placeholder:text-muted-foreground/60",
          "focus:outline-none",
          "disabled:opacity-50"
        )}
      />
      <Button
        size="icon"
        className="h-10 w-10 rounded-full shrink-0"
        onClick={onSubmit}
        disabled={isLoading || !value.trim()}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
