import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Code,
  Eye,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Smile,
  X,
  Upload,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { glass, chips } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getSkillWithPrompt,
  createSkill,
  updateSkill,
  type SkillCreateRequest,
  type SkillParameter,
} from "@/lib/api";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParameterForm {
  id: string;
  label: string;
  description: string;
  type: "select" | "boolean" | "string" | "number";
  options: string[];
  default: string;
}

interface SkillFormState {
  name: string;
  description: string;
  icon: string;
  logo: string | null;
  category: string;
  tags: string[];
  input_accepts: string[] | null;
  parameters: ParameterForm[];
  prompt_system: string;
  prompt_user_template: string;
  author_name: string;
  author_url: string;
  output_format: string;
}

interface ValidationErrors {
  name?: string;
  description?: string;
  icon?: string;
  prompt_system?: string;
  prompt_user_template?: string;
  parameters?: Record<number, { id?: string; options?: string; default?: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "productivity",
  "analysis",
  "export",
  "writing",
  "research",
  "custom",
] as const;

const MEMORY_TYPES = [
  { value: "web", label: "Web" },
  { value: "note", label: "Note" },
  { value: "voice_memo", label: "Voice Memo" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "document", label: "Document" },
] as const;

const VARIABLE_HINTS = [
  "{{content}}",
  "{{memory_title}}",
  "{{memory_url}}",
  "{{memory_date}}",
  "{{memory_type}}",
  "{{memory_tags}}",
] as const;

const OUTPUT_FORMATS = ["markdown", "plain", "json", "html"] as const;

const MAX_LOGO_BYTES = 32 * 1024;

const EMPTY_FORM: SkillFormState = {
  name: "",
  description: "",
  icon: "",
  logo: null,
  category: "custom",
  tags: [],
  input_accepts: null,
  parameters: [],
  prompt_system: "",
  prompt_user_template: "",
  author_name: "",
  author_url: "",
  output_format: "markdown",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function formToCreateRequest(form: SkillFormState): SkillCreateRequest {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    icon: form.icon,
    logo: form.logo || null,
    category: form.category,
    tags: form.tags,
    input_type: "memory",
    input_accepts: form.input_accepts,
    parameters: form.parameters.map((p): SkillParameter => {
      let defaultValue: unknown = p.default;
      if (p.type === "boolean") {
        defaultValue = p.default === "true";
      } else if (p.type === "number") {
        defaultValue = parseFloat(p.default) || 0;
      }
      return {
        id: p.id,
        label: p.label,
        description: p.description || undefined,
        type: p.type,
        options: p.type === "select" ? p.options : undefined,
        default: defaultValue,
      };
    }),
    prompt_system: form.prompt_system,
    prompt_user_template: form.prompt_user_template,
    author_name: form.author_name.trim() || null,
    author_url: form.author_url.trim() || null,
    output_format: form.output_format,
  };
}

function skillToFormState(skill: Awaited<ReturnType<typeof getSkillWithPrompt>>): SkillFormState {
  return {
    name: skill.name,
    description: skill.description,
    icon: skill.icon,
    logo: skill.logo ?? null,
    category: skill.category,
    tags: skill.tags ?? [],
    input_accepts: skill.input?.accepts ?? null,
    parameters: (skill.parameters ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description ?? "",
      type: p.type,
      options: p.options ?? [],
      default: String(p.default ?? ""),
    })),
    prompt_system: skill.prompt?.system ?? "",
    prompt_user_template: skill.prompt?.user_template ?? "",
    author_name: skill.author_name ?? "",
    author_url: skill.author_url ?? "",
    output_format: skill.output_format ?? "markdown",
  };
}

function formToJson(form: SkillFormState): string {
  const obj: Record<string, unknown> = {
    name: form.name,
    description: form.description,
    icon: form.icon,
    version: "1.0.0",
    category: form.category,
    tags: form.tags,
    input: {
      type: "memory",
      accepts: form.input_accepts,
    },
    output: {
      format: form.output_format,
    },
    parameters: form.parameters.map((p) => {
      const param: Record<string, unknown> = {
        id: p.id,
        label: p.label,
        type: p.type,
        default: p.type === "boolean" ? p.default === "true" : p.type === "number" ? (parseFloat(p.default) || 0) : p.default,
      };
      if (p.description) param.description = p.description;
      if (p.type === "select") param.options = p.options;
      return param;
    }),
    prompt: {
      system: form.prompt_system,
      user_template: form.prompt_user_template,
    },
  };
  if (form.logo) {
    obj.logo = form.logo;
  }
  if (form.author_name || form.author_url) {
    obj.author = {
      name: form.author_name || undefined,
      url: form.author_url || undefined,
    };
  }
  return JSON.stringify(obj, null, 2);
}

function jsonToForm(json: string): SkillFormState {
  const obj = JSON.parse(json);
  return {
    name: obj.name ?? "",
    description: obj.description ?? "",
    icon: obj.icon ?? "",
    logo: obj.logo ?? null,
    category: obj.category ?? "custom",
    tags: obj.tags ?? [],
    input_accepts: obj.input?.accepts ?? null,
    parameters: (obj.parameters ?? []).map((p: Record<string, unknown>) => ({
      id: (p.id as string) ?? "",
      label: (p.label as string) ?? "",
      description: (p.description as string) ?? "",
      type: (p.type as ParameterForm["type"]) ?? "string",
      options: (p.options as string[]) ?? [],
      default: String(p.default ?? ""),
    })),
    prompt_system: obj.prompt?.system ?? "",
    prompt_user_template: obj.prompt?.user_template ?? "",
    author_name: obj.author?.name ?? "",
    author_url: obj.author?.url ?? "",
    output_format: obj.output?.format ?? "markdown",
  };
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SkillEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = Boolean(id);

  const [formState, setFormState] = useState<SkillFormState>(EMPTY_FORM);
  const [initialFormState, setInitialFormState] = useState<SkillFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [jsonView, setJsonView] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const templateRef = useRef<HTMLTextAreaElement>(null);
  const systemRef = useRef<HTMLTextAreaElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ---- Dirty tracking ----
  const isDirty = JSON.stringify(formState) !== JSON.stringify(initialFormState);

  // ---- Navigation guard (browser/Electron close + in-app via hashchange) ----
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    };
    const hashChange = (e: HashChangeEvent) => {
      if (isDirtyRef.current) {
        const confirmed = window.confirm(
          "You have unsaved changes. Are you sure you want to leave?"
        );
        if (!confirmed) {
          e.preventDefault();
          // Restore the previous hash
          window.location.hash = new URL(e.oldURL).hash;
        }
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("hashchange", hashChange);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("hashchange", hashChange);
    };
  }, []);

  // ---- Load existing skill for edit mode ----
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setIsLoading(true);
    getSkillWithPrompt(id)
      .then((skill) => {
        if (cancelled) return;
        const form = skillToFormState(skill);
        setFormState(form);
        setInitialFormState(form);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Failed to load skill");
        navigate("/skills");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  // ---- Field updaters ----
  const updateField = useCallback(
    <K extends keyof SkillFormState>(key: K, value: SkillFormState[K]) => {
      setFormState((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof ValidationErrors];
        return next;
      });
    },
    []
  );

  const updateParameter = useCallback(
    (index: number, patch: Partial<ParameterForm>) => {
      setFormState((prev) => {
        const params = [...prev.parameters];
        params[index] = { ...params[index], ...patch };
        // Auto-generate ID from label if label changed and ID was auto-generated
        if (patch.label !== undefined && !patch.id) {
          const slug = slugify(patch.label);
          if (slug) params[index].id = slug;
        }
        return { ...prev, parameters: params };
      });
      // Clear parameter-level errors
      setErrors((prev) => {
        if (!prev.parameters) return prev;
        const paramsCopy = { ...prev.parameters };
        const { [index]: _, ...rest } = paramsCopy;
        return {
          ...prev,
          parameters: Object.keys(rest).length > 0 ? rest : undefined,
        };
      });
    },
    []
  );

  const addParameter = useCallback(() => {
    const newParam: ParameterForm = {
      id: "",
      label: "",
      description: "",
      type: "string",
      options: [],
      default: "",
    };
    setFormState((prev) => ({
      ...prev,
      parameters: [...prev.parameters, newParam],
    }));
  }, []);

  const removeParameter = useCallback((index: number) => {
    setFormState((prev) => ({
      ...prev,
      parameters: prev.parameters.filter((_, i) => i !== index),
    }));
  }, []);

  // ---- Tag management ----
  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed) return;
      if (formState.tags.includes(trimmed)) return;
      updateField("tags", [...formState.tags, trimmed]);
    },
    [formState.tags, updateField]
  );

  const removeTag = useCallback(
    (tag: string) => {
      updateField(
        "tags",
        formState.tags.filter((t) => t !== tag)
      );
    },
    [formState.tags, updateField]
  );

  // ---- Input types management ----
  const allTypesChecked = formState.input_accepts === null;

  const toggleMemoryType = useCallback(
    (type: string) => {
      if (formState.input_accepts === null) {
        const remaining = MEMORY_TYPES.map((t) => t.value).filter(
          (t) => t !== type
        );
        updateField("input_accepts", remaining);
      } else if (formState.input_accepts.includes(type)) {
        const remaining = formState.input_accepts.filter((t) => t !== type);
        updateField("input_accepts", remaining.length === 0 ? [type] : remaining);
      } else {
        const next = [...formState.input_accepts, type];
        if (next.length === MEMORY_TYPES.length) {
          updateField("input_accepts", null);
        } else {
          updateField("input_accepts", next);
        }
      }
    },
    [formState.input_accepts, updateField]
  );

  const toggleAllTypes = useCallback(() => {
    if (allTypesChecked) {
      updateField("input_accepts", ["web"]);
    } else {
      updateField("input_accepts", null);
    }
  }, [allTypesChecked, updateField]);

  const isTypeChecked = (type: string) =>
    formState.input_accepts === null || formState.input_accepts.includes(type);

  // ---- Logo handlers ----
  const handleLogoSelect = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSize = 128;
      let w = img.width;
      let h = img.height;
      if (w > maxSize || h > maxSize) {
        const ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      for (const quality of [0.8, 0.6, 0.4, 0.2]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= MAX_LOGO_BYTES) {
          setFormState((prev) => ({ ...prev, logo: dataUrl }));
          return;
        }
      }
      setFormState((prev) => ({ ...prev, logo: canvas.toDataURL("image/jpeg", 0.2) }));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Failed to load image");
    };
    img.src = url;
  }, []);

  const handleLogoFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLogoSelect(file);
    e.target.value = "";
  }, [handleLogoSelect]);

  const handleLogoRemove = useCallback(() => {
    setFormState((prev) => ({ ...prev, logo: null }));
  }, []);

  // ---- Variable hint insertion ----
  const insertVariable = useCallback((variable: string) => {
    const el = templateRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const newVal = val.substring(0, start) + variable + val.substring(end);
    setFormState((prev) => ({ ...prev, prompt_user_template: newVal }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + variable.length, start + variable.length);
    });
  }, []);

  // ---- JSON toggle ----
  const handleToggleJsonView = useCallback(() => {
    if (!jsonView) {
      setJsonText(formToJson(formState));
      setJsonError(null);
      setJsonView(true);
    } else {
      try {
        const parsed = jsonToForm(jsonText);
        setFormState(parsed);
        setJsonError(null);
        setJsonView(false);
      } catch {
        setJsonError("Invalid JSON. Fix errors before switching back to form view.");
      }
    }
  }, [jsonView, formState, jsonText]);

  // ---- Validation ----
  const validate = useCallback((): boolean => {
    const errs: ValidationErrors = {};

    if (!formState.name.trim()) {
      errs.name = "Name is required";
    } else if (formState.name.length > 60) {
      errs.name = "Name must be 60 characters or less";
    }

    if (!formState.description.trim()) {
      errs.description = "Description is required";
    } else if (formState.description.length > 200) {
      errs.description = "Description must be 200 characters or less";
    }

    if (!formState.icon) {
      errs.icon = "Icon is required";
    }

    if (!formState.prompt_system.trim()) {
      errs.prompt_system = "System prompt is required";
    }

    if (!formState.prompt_user_template.includes("{{content}}")) {
      errs.prompt_user_template = "Template must contain {{content}}";
    }

    const paramErrors: Record<number, { id?: string; options?: string; default?: string }> = {};
    const seenIds = new Set<string>();

    formState.parameters.forEach((p, i) => {
      const pErr: { id?: string; options?: string; default?: string } = {};

      if (!p.id.trim()) {
        pErr.id = "ID is required";
      } else if (seenIds.has(p.id)) {
        pErr.id = "Duplicate parameter ID";
      }
      seenIds.add(p.id);

      if (p.type === "select") {
        if (p.options.length === 0) {
          pErr.options = "At least one option is required";
        }
        if (p.default && p.options.length > 0 && !p.options.includes(p.default)) {
          pErr.default = "Default must be one of the options";
        }
      }

      if (Object.keys(pErr).length > 0) {
        paramErrors[i] = pErr;
      }
    });

    if (Object.keys(paramErrors).length > 0) {
      errs.parameters = paramErrors;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [formState]);

  // ---- Save ----
  const handleSave = useCallback(async () => {
    if (!validate()) {
      toast.error("Please fix the validation errors");
      return;
    }

    setIsSaving(true);
    try {
      const payload = formToCreateRequest(formState);

      if (isEditMode && id) {
        await updateSkill(id, payload);
        toast.success("Skill updated");
      } else {
        await createSkill(payload);
        toast.success("Skill created");
      }

      setInitialFormState(formState);
      navigate("/skills");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to save skill";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [formState, isEditMode, id, navigate, validate]);

  // ---- Parameter variable hints ----
  const parameterVariables = formState.parameters
    .filter((p) => p.id.trim())
    .map((p) => `{{${p.id}}}`);

  // ---- Loading state ----
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/skills")}
            className="shrink-0 hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold font-heading truncate">
              {isEditMode
                ? `Edit: ${formState.name || "Untitled"}`
                : "New Skill"}
            </h1>
            <p className="text-xs text-muted-foreground/50 mt-0.5">
              {isEditMode ? "Modify your skill definition" : "Create a new custom skill"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleJsonView}
            className="gap-1.5"
          >
            {jsonView ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                View Form
              </>
            ) : (
              <>
                <Code className="h-3.5 w-3.5" />
                View JSON
              </>
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="gap-1.5 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-200"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Skill
          </Button>
        </div>
      </div>

      {/* JSON View */}
      {jsonView ? (
        <div className="space-y-3">
          {jsonError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {jsonError}
            </div>
          )}
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            className={cn(
              "w-full min-h-[60vh] rounded-xl p-4 font-mono text-sm resize-y",
              "border border-white/40 dark:border-white/[0.06]",
              "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
              "focus:outline-none focus:ring-1 focus:ring-primary/30",
              "focus:shadow-sm focus:shadow-primary/10 transition-shadow duration-200",
              jsonError && "border-destructive/50"
            )}
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          {/* ============================================================= */}
          {/* Two-column grid: Left (Basics + Input Types), Right (Params)  */}
          {/* ============================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

            {/* LEFT COLUMN */}
            <div className="space-y-4">
              {/* Section 1: Basics */}
              <section className={cn("rounded-2xl p-4 space-y-3", glass.elevated)}>
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-2 pb-2 border-b border-white/30 dark:border-white/[0.04]">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                  Basics
                </h2>

                {/* Name + Icon inline */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <div className="flex items-center gap-2">
                    <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "h-9 w-9 rounded-md flex items-center justify-center text-lg shrink-0 transition-all",
                            "border border-white/50 dark:border-white/[0.08]",
                            "bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm",
                            "hover:shadow-md hover:shadow-primary/10 hover:border-primary/30",
                            formState.icon && "ring-1 ring-primary/20",
                            errors.icon && "border-red-500/50 ring-1 ring-red-500/20"
                          )}
                          title="Pick icon"
                        >
                          {formState.icon || <Smile className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto p-0 border-0 bg-transparent shadow-none"
                        align="start"
                        sideOffset={8}
                      >
                        <Picker
                          data={data}
                          onEmojiSelect={(emoji: { native: string }) => {
                            updateField("icon", emoji.native);
                            setEmojiOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <Input
                      value={formState.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      maxLength={60}
                      placeholder="My Skill"
                      className={cn("flex-1", errors.name && "border-destructive/50")}
                    />
                  </div>
                  <div className="flex justify-between">
                    <div className="space-y-0.5">
                      {errors.icon && (
                        <p className="text-xs text-destructive">{errors.icon}</p>
                      )}
                      {errors.name && (
                        <p className="text-xs text-destructive">{errors.name}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/50 ml-auto">
                      {formState.name.length}/60
                    </p>
                  </div>
                </div>

                {/* Logo */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Logo</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className={cn(
                        "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden",
                        "border border-white/50 dark:border-white/[0.08]",
                        "bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm",
                        "hover:shadow-md hover:shadow-primary/10 hover:border-primary/30 transition-all"
                      )}
                      title="Upload logo image"
                    >
                      {formState.logo ? (
                        <img
                          src={formState.logo}
                          alt="Skill logo"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
                      )}
                    </button>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => logoInputRef.current?.click()}
                        className="gap-1.5 h-7 text-xs px-2.5"
                      >
                        <Upload className="h-3 w-3" />
                        {formState.logo ? "Replace" : "Upload"}
                      </Button>
                      {formState.logo && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleLogoRemove}
                          className="gap-1.5 h-7 text-xs px-2.5 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                          Remove
                        </Button>
                      )}
                      <span className="text-[11px] text-muted-foreground/50">
                        {formState.logo
                          ? "Shown instead of icon"
                          : "Optional — falls back to icon"}
                      </span>
                    </div>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      className="hidden"
                      onChange={handleLogoFileChange}
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={formState.description}
                    onChange={(e) => updateField("description", e.target.value)}
                    maxLength={200}
                    placeholder="What does this skill do?"
                    className={cn(errors.description && "border-destructive/50")}
                  />
                  <div className="flex justify-between">
                    {errors.description && (
                      <p className="text-xs text-destructive">
                        {errors.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/50 ml-auto">
                      {formState.description.length}/200
                    </p>
                  </div>
                </div>

                {/* Category + Output Format side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Category</label>
                    <select
                      value={formState.category}
                      onChange={(e) => updateField("category", e.target.value)}
                      className={cn(
                        "flex h-9 w-full rounded-md px-3 py-1 text-sm",
                        "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm border border-white/40 dark:border-white/[0.06]",
                        "shadow-sm transition-colors",
                        "focus:outline-none focus:ring-1 focus:ring-primary/30 focus:shadow-sm focus:shadow-primary/10"
                      )}
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Output Format</label>
                    <select
                      value={formState.output_format}
                      onChange={(e) => updateField("output_format", e.target.value)}
                      className={cn(
                        "flex h-9 w-full rounded-md px-3 py-1 text-sm",
                        "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm border border-white/40 dark:border-white/[0.06]",
                        "shadow-sm transition-colors",
                        "focus:outline-none focus:ring-1 focus:ring-primary/30 focus:shadow-sm focus:shadow-primary/10"
                      )}
                    >
                      {OUTPUT_FORMATS.map((fmt) => (
                        <option key={fmt} value={fmt}>
                          {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tags</label>
                  {formState.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {formState.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            chips.base,
                            chips.primary,
                            "inline-flex items-center gap-1"
                          )}
                        >
                          {tag}
                          <button
                            onClick={() => removeTag(tag)}
                            className="hover:text-destructive transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(tagInput);
                        setTagInput("");
                      }
                    }}
                    placeholder="Type a tag and press Enter"
                  />
                </div>

                {/* Author */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Author</label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      value={formState.author_name}
                      onChange={(e) => updateField("author_name", e.target.value)}
                      placeholder="Name"
                    />
                    <Input
                      value={formState.author_url}
                      onChange={(e) => updateField("author_url", e.target.value)}
                      placeholder="URL (optional)"
                    />
                  </div>
                </div>
              </section>

              {/* Section 2: Input Types */}
              <section className={cn("rounded-2xl p-4 space-y-3", glass.card)}>
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-2 pb-2 border-b border-white/30 dark:border-white/[0.04]">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                  Input Types
                </h2>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allTypesChecked}
                    onChange={toggleAllTypes}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="text-sm font-medium">Accept all types</span>
                </label>

                <div className="grid grid-cols-2 gap-2.5">
                  {MEMORY_TYPES.map((mt) => (
                    <label
                      key={mt.value}
                      className="flex items-center gap-2.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isTypeChecked(mt.value)}
                        onChange={() => toggleMemoryType(mt.value)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <span className="text-sm">{mt.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN: Parameters */}
            <div>
              <section className={cn("rounded-2xl p-4 space-y-3", glass.card)}>
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-2 pb-2 border-b border-white/30 dark:border-white/[0.04]">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                    Parameters ({formState.parameters.length})
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addParameter}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>

                {formState.parameters.length === 0 && (
                  <p className="text-sm text-muted-foreground/50 text-center py-4">
                    No parameters defined.
                  </p>
                )}

                {formState.parameters.map((param, index) => {
                  const pErr = errors.parameters?.[index];
                  return (
                    <div
                      key={index}
                      className={cn("rounded-xl p-3 space-y-2 transition-all duration-200 hover:shadow-sm", glass.panel)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                          <div className="h-4 w-4 rounded bg-primary/10 flex items-center justify-center">
                            <span className="text-[9px] font-bold text-primary">{index + 1}</span>
                          </div>
                          Parameter
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeParameter(index)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Label</label>
                          <Input
                            value={param.label}
                            onChange={(e) =>
                              updateParameter(index, { label: e.target.value })
                            }
                            placeholder="Output Format"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">ID</label>
                          <Input
                            value={param.id}
                            onChange={(e) =>
                              updateParameter(index, { id: e.target.value })
                            }
                            placeholder="output_format"
                            className={cn(
                              "font-mono text-xs",
                              pErr?.id && "border-destructive/50"
                            )}
                          />
                          {pErr?.id && (
                            <p className="text-xs text-destructive">{pErr.id}</p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Type</label>
                          <select
                            value={param.type}
                            onChange={(e) =>
                              updateParameter(index, {
                                type: e.target.value as ParameterForm["type"],
                              })
                            }
                            className={cn(
                              "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm",
                              "shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            )}
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                            <option value="select">Select</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Default</label>
                          {param.type === "boolean" ? (
                            <label className="flex items-center gap-2 h-9 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={param.default === "true"}
                                onChange={(e) =>
                                  updateParameter(index, {
                                    default: e.target.checked ? "true" : "false",
                                  })
                                }
                                className="h-4 w-4 rounded border-input accent-primary"
                              />
                              <span className="text-sm">
                                {param.default === "true" ? "True" : "False"}
                              </span>
                            </label>
                          ) : (
                            <>
                              <Input
                                value={param.default}
                                onChange={(e) =>
                                  updateParameter(index, {
                                    default: e.target.value,
                                  })
                                }
                                placeholder="Default value"
                                className={cn(
                                  pErr?.default && "border-destructive/50"
                                )}
                              />
                              {pErr?.default && (
                                <p className="text-xs text-destructive">
                                  {pErr.default}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {param.type === "select" && (
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            Options (comma-separated)
                          </label>
                          <Input
                            value={param.options.join(", ")}
                            onChange={(e) =>
                              updateParameter(index, {
                                options: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="bullet_points, paragraph, table"
                            className={cn(
                              pErr?.options && "border-destructive/50"
                            )}
                          />
                          {pErr?.options && (
                            <p className="text-xs text-destructive">
                              {pErr.options}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Description</label>
                        <Input
                          value={param.description}
                          onChange={(e) =>
                            updateParameter(index, {
                              description: e.target.value,
                            })
                          }
                          placeholder="Optional description"
                        />
                      </div>
                    </div>
                  );
                })}
              </section>
            </div>
          </div>

          {/* ============================================================= */}
          {/* Full-width sections: Prompt + Test                            */}
          {/* ============================================================= */}

          {/* Section: Prompt */}
          <section className={cn("rounded-2xl p-4 space-y-3", glass.elevated)}>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-2 pb-2 border-b border-white/30 dark:border-white/[0.04]">
              <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
              Prompt
            </h2>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">System Prompt</label>
              <textarea
                ref={systemRef}
                value={formState.prompt_system}
                onChange={(e) => updateField("prompt_system", e.target.value)}
                placeholder="You are a helpful assistant that..."
                className={cn(
                  "w-full min-h-24 rounded-xl p-3 font-mono text-sm resize-y",
                  "border border-white/40 dark:border-white/[0.06]",
                  "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
                  "focus:outline-none focus:ring-1 focus:ring-primary/30",
                  "focus:shadow-sm focus:shadow-primary/10 transition-shadow duration-200",
                  "placeholder:text-muted-foreground/50",
                  errors.prompt_system && "border-destructive/50"
                )}
                spellCheck={false}
              />
              {errors.prompt_system && (
                <p className="text-xs text-destructive">
                  {errors.prompt_system}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground/70">
                Variable Hints — click to insert into template
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[...VARIABLE_HINTS, ...parameterVariables].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className={cn(
                      chips.base,
                      chips.glass,
                      "font-mono text-[11px] cursor-pointer hover:bg-primary/10",
                      "hover:text-primary hover:border-primary/20 hover:shadow-sm hover:shadow-primary/10 active:scale-95 transition-all duration-150"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">User Template</label>
              <textarea
                ref={templateRef}
                value={formState.prompt_user_template}
                onChange={(e) =>
                  updateField("prompt_user_template", e.target.value)
                }
                placeholder={"Analyze the following content:\n\n{{content}}"}
                className={cn(
                  "w-full min-h-28 rounded-xl p-3 font-mono text-sm resize-y",
                  "border border-white/40 dark:border-white/[0.06]",
                  "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
                  "focus:outline-none focus:ring-1 focus:ring-primary/30",
                  "focus:shadow-sm focus:shadow-primary/10 transition-shadow duration-200",
                  "placeholder:text-muted-foreground/50",
                  errors.prompt_user_template && "border-destructive/50"
                )}
                spellCheck={false}
              />
              {errors.prompt_user_template && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.prompt_user_template}
                </p>
              )}
            </div>
          </section>

          {/* Section: Test */}
          <section className={cn("rounded-2xl p-4 space-y-3", glass.panel)}>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-2 pb-2 border-b border-white/30 dark:border-white/[0.04]">
              <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
              Test
            </h2>
            <SkillTestRunnerLazy formState={formState} />
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lazy wrapper for SkillTestRunner — gracefully handle if not yet implemented
// ---------------------------------------------------------------------------

function SkillTestRunnerLazy({ formState }: { formState: SkillFormState }) {
  try {
    const [Component, setComponent] = useState<React.ComponentType<{
      formState: SkillFormState;
    }> | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      import("@/components/SkillTestRunner")
        .then((mod: Record<string, unknown>) => {
          const Comp = (mod.default || mod.SkillTestRunner) as React.ComponentType<{
            formState: SkillFormState;
          }>;
          setComponent(() => Comp);
        })
        .catch(() => {
          setFailed(true);
        });
    }, []);

    if (failed) {
      return (
        <p className="text-sm text-muted-foreground/50 text-center py-6">
          Test runner not available yet. Create the SkillTestRunner component to enable testing.
        </p>
      );
    }

    if (!Component) {
      return (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return <Component formState={formState} />;
  } catch {
    return (
      <p className="text-sm text-muted-foreground/50 text-center py-6">
        Test runner not available yet.
      </p>
    );
  }
}
