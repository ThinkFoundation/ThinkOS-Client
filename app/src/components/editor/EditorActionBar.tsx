import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { editor as editorTokens } from "@/lib/design-tokens";
import { AlertTriangle, Loader2, Save, Undo2 } from "lucide-react";

interface EditorActionBarProps {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  showCloseWarning: boolean;
  isDistractionFree?: boolean;
  wordCount?: number;
}

export function EditorActionBar({
  isDirty,
  isSaving,
  onSave,
  onDiscard,
  showCloseWarning,
  isDistractionFree = false,
  wordCount,
}: EditorActionBarProps) {
  return (
    <div
      className={cn(
        editorTokens.actionBar,
        "transition-all duration-300",
        isDistractionFree && "opacity-0 hover:opacity-100",
        showCloseWarning && editorTokens.actionBarWarning
      )}
    >
      {showCloseWarning ? (
        // Warning mode - block close
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">
              Save or discard changes before closing
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDiscard}
              className="gap-1.5"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Discard
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={isSaving}
              className="gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      ) : (
        // Normal mode
        <div className="flex items-center gap-4">
          {/* Word count */}
          {wordCount !== undefined && (
            <span className="text-xs text-muted-foreground">
              {wordCount} words
            </span>
          )}

          {/* Unsaved indicator */}
          {isDirty && (
            <div className="flex items-center gap-1.5 text-amber-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs">Unsaved</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDiscard}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Discard
              </Button>
            )}
            <Button
              size="sm"
              onClick={onSave}
              disabled={!isDirty || isSaving}
              className="gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
