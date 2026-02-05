import { useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import changelog from "@/data/changelog.json";

interface ChangelogEntry {
  version: string;
  changes: {
    type: "minor" | "patch" | "major";
    description: string;
  }[];
}

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const entries = changelog as ChangelogEntry[];

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog panel */}
      <div className="absolute left-1/2 top-[10%] -translate-x-1/2 w-full max-w-lg px-4">
        <div
          className={cn(
            "bg-background rounded-2xl shadow-2xl border flex flex-col",
            "transform transition-all duration-200",
            "max-h-[80vh]"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <h2 className="text-lg font-semibold">Changelog</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto p-6 space-y-6 min-h-0">
            {entries.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No changelog entries found
              </p>
            )}
            {entries.map((entry) => (
              <div key={entry.version} className="space-y-3">
                {/* Version header */}
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">v{entry.version}</span>
                  {entry.changes.some((c) => c.type === "major") && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                      Major
                    </span>
                  )}
                  {entry.changes.some((c) => c.type === "minor") && !entry.changes.some((c) => c.type === "major") && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      Minor
                    </span>
                  )}
                  {entry.changes.every((c) => c.type === "patch") && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-500/10 text-gray-600 dark:text-gray-400">
                      Patch
                    </span>
                  )}
                </div>

                {/* Changes */}
                <div className="space-y-2 pl-1">
                  {entry.changes.map((change, idx) => (
                    <div key={idx} className="changelog-prose text-sm text-muted-foreground">
                      <ReactMarkdown>{change.description}</ReactMarkdown>
                    </div>
                  ))}
                </div>

                {/* Divider (except for last entry) */}
                {entry !== entries[entries.length - 1] && (
                  <div className="border-b border-border/50 pt-2" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
