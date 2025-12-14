import { cn } from "@/lib/utils";
import { chips } from "@/lib/design-tokens";

interface PromptChipsProps {
  prompts: string[];
  onSelect: (prompt: string) => void;
  variant?: "glass" | "primary";
  className?: string;
}

export function PromptChips({
  prompts,
  onSelect,
  variant = "primary",
  className,
}: PromptChipsProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {prompts.map((prompt) => (
        <button
          key={prompt}
          onClick={() => onSelect(prompt)}
          className={cn(
            chips.base,
            variant === "glass" ? chips.glass : chips.primary
          )}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
