import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TokenUsage } from "@/types/chat";

interface ContextUsageIndicatorProps {
  estimatedTokens: number;  // Estimated conversation tokens
  billingUsage: TokenUsage | null;  // Cumulative (for session totals)
  contextWindow: number;
  className?: string;
}

export function ContextUsageIndicator({
  estimatedTokens,
  billingUsage,
  contextWindow,
  className,
}: ContextUsageIndicatorProps) {
  const [showPopover, setShowPopover] = useState(false);

  if (estimatedTokens === 0) return null;

  const percentage = Math.min((estimatedTokens / contextWindow) * 100, 100);

  // Color based on usage level
  const getStrokeColor = () => {
    if (percentage < 50) return "stroke-green-500";
    if (percentage < 75) return "stroke-yellow-500";
    if (percentage < 90) return "stroke-orange-500";
    return "stroke-red-500";
  };

  // SVG circle parameters
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div
      className={cn("relative inline-flex items-center cursor-help", className)}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted-foreground/20"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("transition-all duration-500", getStrokeColor())}
        />
      </svg>

      {/* Percentage text in center */}
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-muted-foreground">
        {Math.round(percentage)}%
      </span>

      {/* Popover */}
      {showPopover && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-popover border rounded-lg shadow-lg z-50 min-w-[220px]">
          <div className="text-xs font-medium mb-2">Context Window</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Conversation:</span>
              <span className="font-mono font-medium">
                ~{estimatedTokens.toLocaleString()} / {contextWindow.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Usage:</span>
              <span className="font-mono">{percentage.toFixed(1)}%</span>
            </div>
          </div>

          {billingUsage && (
            <>
              <div className="border-t my-2" />
              <div className="text-xs font-medium mb-2">Session Totals</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Prompt:</span>
                  <span className="font-mono">
                    {billingUsage.prompt_tokens.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Completion:</span>
                  <span className="font-mono">
                    {billingUsage.completion_tokens.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Total:</span>
                  <span className="font-mono font-medium">
                    {billingUsage.total_tokens.toLocaleString()}
                  </span>
                </div>
              </div>
            </>
          )}
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-popover" />
        </div>
      )}
    </div>
  );
}
