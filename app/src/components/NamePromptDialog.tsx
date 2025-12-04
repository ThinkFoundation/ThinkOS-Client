import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE_URL } from "../constants";

interface NamePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNameSaved: (name: string) => void;
}

export function NamePromptDialog({
  open,
  onOpenChange,
  onNameSaved,
}: NamePromptDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

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

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (res.ok) {
        onNameSaved(name.trim());
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Failed to save name:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem("think_name_prompt_dismissed", "true");
    onOpenChange(false);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog panel */}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-md px-4">
        <div
          className={cn(
            "bg-background rounded-2xl shadow-2xl border",
            "transform transition-all duration-200"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">What should we call you?</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Form */}
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Add your name to personalize your Think experience.
            </p>

            <Input
              ref={inputRef}
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={handleSkip}>
                Maybe later
              </Button>
              <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
