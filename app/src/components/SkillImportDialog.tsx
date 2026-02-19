import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  validateSkillDefinition,
  importSkill,
  getSkillsList,
  type SkillListItem,
  type SkillValidationResult,
} from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { glass } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContent?: string | null;
  onImported: (skill: SkillListItem) => void;
}

type ConflictResolution = "replace" | "copy";

interface CollisionInfo {
  existingSkill: SkillListItem;
  isBuiltin: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillImportDialog({
  open,
  onOpenChange,
  initialContent,
  onImported,
}: SkillImportDialogProps) {
  // ---- State ----
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<SkillValidationResult | null>(null);
  const [collision, setCollision] = useState<CollisionInfo | null>(null);
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>("copy");
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Derived ----
  const content = initialContent ?? fileContent;
  const canImport = validation?.valid === true && !isValidating && !isImporting;

  // ---- Reset on close ----
  const resetState = useCallback(() => {
    setFileContent(null);
    setFileName(null);
    setValidation(null);
    setCollision(null);
    setConflictResolution("copy");
    setIsValidating(false);
    setIsImporting(false);
    setIsDragOver(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  // ---- Validate when content changes ----
  const validate = useCallback(async (raw: string) => {
    setIsValidating(true);
    setValidation(null);
    setCollision(null);
    setConflictResolution("copy");

    try {
      const result = await validateSkillDefinition(raw);
      setValidation(result);

      // Collision check – only if valid and we have a parsed ID
      if (result.valid && result.parsed?.id) {
        try {
          const allSkills = await getSkillsList({ include_hidden: true });
          const existing = allSkills.find((s) => s.id === result.parsed!.id);
          if (existing) {
            const isBuiltin = existing.source === "builtin";
            setCollision({ existingSkill: existing, isBuiltin });
            // Default to "copy" since replace might not be allowed
            setConflictResolution(isBuiltin ? "copy" : "copy");
          }
        } catch {
          // Non-critical – we just skip the collision check
          console.warn("Could not check for skill ID collision");
        }
      }
    } catch (err) {
      setValidation({
        valid: false,
        errors: [err instanceof Error ? err.message : "Validation request failed"],
      });
    } finally {
      setIsValidating(false);
    }
  }, []);

  // Re-validate when initialContent changes while dialog is open
  useEffect(() => {
    if (open && initialContent) {
      validate(initialContent);
    }
  }, [open, initialContent, validate]);

  // Also validate when user picks a file
  useEffect(() => {
    if (open && fileContent) {
      validate(fileContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fileContent]);

  // ---- File reading helpers ----
  const readFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        setFileContent(text);
      }
    };
    reader.onerror = () => {
      toast.error("Failed to read file");
    };
    reader.readAsText(file);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        readFile(file);
      }
    },
    [readFile],
  );

  // ---- Drag & drop handlers ----
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        readFile(file);
      }
    },
    [readFile],
  );

  // ---- Import handler ----
  const handleImport = useCallback(async () => {
    if (!content) return;

    setIsImporting(true);
    try {
      const skill = await importSkill({
        definition: content,
        conflict_resolution: conflictResolution,
      });
      toast.success(`Skill "${skill.name}" imported successfully`);
      onImported(skill);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import skill",
      );
    } finally {
      setIsImporting(false);
    }
  }, [content, conflictResolution, onImported, onOpenChange]);

  // ---- Render helpers ----
  const hasContent = content != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Skill</DialogTitle>
          <DialogDescription>
            Import a <code className="text-xs">.think-skill</code> or JSON file
            to add a new skill.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ---------- File input / drag-and-drop ---------- */}
          {!initialContent && (
            <>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-all duration-200",
                  glass.card,
                  isDragOver
                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10 scale-[1.01]"
                    : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/50",
                )}
              >
                <div
                  className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-200",
                    isDragOver ? "bg-primary/15 scale-110" : "bg-muted/50"
                  )}
                >
                  <Upload
                    className={cn(
                      "h-6 w-6 transition-colors",
                      isDragOver ? "text-primary" : "text-muted-foreground/60",
                    )}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  {fileName ? (
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-4 w-4 inline-block" />
                      {fileName}
                    </span>
                  ) : (
                    <>
                      Drag & drop a{" "}
                      <code className="text-xs">.think-skill</code> file here
                    </>
                  )}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".think-skill,.json"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {!fileName && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-border" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    or
                  </span>
                  <div className="flex-1 border-t border-border" />
                </div>
              )}

              {!fileName && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Choose File
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ---------- Validating spinner ---------- */}
          {isValidating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating skill definition...
            </div>
          )}

          {/* ---------- Validation results ---------- */}
          {validation && !isValidating && (
            <div
              className={cn(
                "rounded-xl border p-4 space-y-2 animate-scale-in",
                glass.card,
                validation.valid
                  ? "border-l-2 border-emerald-500/40"
                  : "border-l-2 border-red-500/40",
              )}
            >
              <p className="text-sm font-medium">Validation Results</p>

              {validation.valid ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm text-green-600 dark:text-green-400">
                    <div className="h-5 w-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    </div>
                    <span>
                      Valid skill definition
                      {validation.parsed?.name && (
                        <>
                          : <strong>{validation.parsed.name}</strong>
                        </>
                      )}
                    </span>
                  </div>

                  {validation.parsed?.id && (
                    <p className="text-xs text-muted-foreground pl-6 font-mono break-all">
                      id: {validation.parsed.id}
                    </p>
                  )}

                  {validation.warnings && validation.warnings.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {validation.warnings.map((warning, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"
                        >
                          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {validation.errors?.map((error, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"
                    >
                      <div className="h-5 w-5 rounded-full bg-red-500/10 flex items-center justify-center">
                        <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      </div>
                      <span>{error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---------- Collision resolution ---------- */}
          {collision && validation?.valid && !isValidating && (
            <div
              className={cn(
                "rounded-xl border border-l-2 border-amber-500/40 p-4 space-y-3 animate-fade-in-up",
                glass.card,
              )}
            >
              <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  A skill with this ID already exists:{" "}
                  <strong>{collision.existingSkill.name}</strong>
                </span>
              </div>

              <fieldset className="space-y-2 pl-6">
                <label
                  className={cn(
                    "flex items-center gap-2.5 text-sm p-2 rounded-lg transition-colors",
                    "hover:bg-white/30 dark:hover:bg-white/[0.03]",
                    collision.isBuiltin && "opacity-50 cursor-not-allowed",
                    conflictResolution === "replace" && "bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="conflict_resolution"
                    value="replace"
                    checked={conflictResolution === "replace"}
                    disabled={collision.isBuiltin}
                    onChange={() => setConflictResolution("replace")}
                    className="accent-primary"
                  />
                  <span>
                    Replace existing
                    {collision.isBuiltin && (
                      <span className="text-xs text-muted-foreground ml-1">
                        (built-in skills cannot be replaced)
                      </span>
                    )}
                  </span>
                </label>

                <label
                  className={cn(
                    "flex items-center gap-2.5 text-sm p-2 rounded-lg transition-colors",
                    "hover:bg-white/30 dark:hover:bg-white/[0.03]",
                    conflictResolution === "copy" && "bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="conflict_resolution"
                    value="copy"
                    checked={conflictResolution === "copy"}
                    onChange={() => setConflictResolution("copy")}
                    className="accent-primary"
                  />
                  <span>Import as copy (new ID)</span>
                </label>
              </fieldset>
            </div>
          )}
        </div>

        {/* ---------- Footer ---------- */}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            disabled={!canImport || !hasContent}
            onClick={handleImport}
            className={cn(
              canImport && hasContent
                ? "shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-200"
                : ""
            )}
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
