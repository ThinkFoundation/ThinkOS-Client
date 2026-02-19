import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  Play,
  Search,
  Loader2,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { glass, chips } from "@/lib/design-tokens";
import { apiFetch } from "@/lib/api";
import { useSkillTest } from "@/hooks/useSkills";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillParameterDef {
  id: string;
  label: string;
  description: string;
  type: "select" | "boolean" | "string" | "number";
  options: string[];
  default: string;
}

interface SkillTestRunnerProps {
  formState: {
    name: string;
    description: string;
    icon: string;
    category: string;
    tags: string[];
    input_accepts: string[] | null;
    parameters: SkillParameterDef[];
    prompt_system: string;
    prompt_user_template: string;
    output_format: string;
  };
}

interface MemoryItem {
  id: number;
  title: string;
  type: string;
  created_at: string;
}

interface MemoryListResponse {
  memories: MemoryItem[];
  total: number;
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// Memory Selector
// ---------------------------------------------------------------------------

function MemorySelector({
  selectedMemory,
  onSelect,
}: {
  selectedMemory: MemoryItem | null;
  onSelect: (memory: MemoryItem | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch default memories on mount
  useEffect(() => {
    fetchMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchMemories = useCallback(async (searchQuery?: string) => {
    setIsLoading(true);
    try {
      const endpoint = searchQuery
        ? `/api/memories/search?q=${encodeURIComponent(searchQuery)}&limit=20`
        : `/api/memories?limit=20&offset=0`;
      const res = await apiFetch(endpoint);
      if (!res.ok) throw new Error("Failed to fetch memories");
      const data: MemoryListResponse = await res.json();
      setMemories(data.memories);
    } catch {
      setMemories([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchMemories(value || undefined);
    }, 300);
  };

  const handleSelect = (memory: MemoryItem) => {
    onSelect(memory);
    setQuery(memory.title || `Memory #${memory.id}`);
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setQuery("");
    fetchMemories();
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
        Target Memory
      </label>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Search memories..."
          className={cn(
            "pl-9 pr-3 rounded-xl",
            "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
            "border-white/40 dark:border-white/[0.06]",
            "focus-visible:ring-primary/30"
          )}
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Selected indicator */}
      {selectedMemory && (
        <div
          className={cn(
            "mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-sm",
            glass.card
          )}
        >
          <div className="flex-1 min-w-0">
            <span className="font-medium truncate block">
              {selectedMemory.title || `Memory #${selectedMemory.id}`}
            </span>
          </div>
          <MemoryTypeBadge type={selectedMemory.type} />
          <button
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            Clear
          </button>
        </div>
      )}

      {/* Dropdown */}
      {isOpen && memories.length > 0 && (
        <div
          className={cn(
            "absolute z-50 mt-1.5 w-full max-h-60 overflow-y-auto rounded-xl animate-scale-in",
            "bg-white dark:bg-neutral-900 border border-white/50 dark:border-white/[0.08] shadow-large"
          )}
        >
          {memories.map((memory) => (
            <button
              key={memory.id}
              onClick={() => handleSelect(memory)}
              className={cn(
                "w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-all duration-150",
                "hover:bg-primary/5 dark:hover:bg-primary/10 hover:pl-4",
                "first:rounded-t-xl last:rounded-b-xl",
                selectedMemory?.id === memory.id && "bg-primary/5"
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {memory.title || `Memory #${memory.id}`}
                </p>
              </div>
              <MemoryTypeBadge type={memory.type} />
            </button>
          ))}
        </div>
      )}

      {isOpen && !isLoading && memories.length === 0 && query && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full rounded-xl shadow-lg p-4 text-center",
            "bg-white dark:bg-neutral-900 border border-white/50 dark:border-white/[0.08]"
          )}
        >
          <p className="text-sm text-muted-foreground">No memories found</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory Type Badge
// ---------------------------------------------------------------------------

function MemoryTypeBadge({ type }: { type: string }) {
  const label =
    type === "voice_memo"
      ? "Voice"
      : type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <span
      className={cn(
        chips.base,
        chips.glass,
        "text-[10px] flex-shrink-0"
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Parameter Controls
// ---------------------------------------------------------------------------

function ParameterControls({
  parameters,
  values,
  onChange,
}: {
  parameters: SkillParameterDef[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  if (parameters.length === 0) return null;

  const updateValue = (id: string, value: unknown) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Parameters
      </h4>
      {parameters.map((param) => (
        <div
          key={param.id}
          className={cn("p-3 rounded-xl space-y-2", glass.card)}
        >
          <div>
            <label className="text-sm font-medium">{param.label}</label>
            {param.description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {param.description}
              </p>
            )}
          </div>

          {/* Select: chip buttons */}
          {param.type === "select" && param.options && (
            <div className="flex flex-wrap gap-1.5">
              {param.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => updateValue(param.id, opt)}
                  className={cn(
                    chips.base,
                    "transition-all duration-200",
                    values[param.id] === opt
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : cn(chips.glass, "hover:bg-primary/10")
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {/* Boolean: Yes/No toggle */}
          {param.type === "boolean" && (
            <div className="flex gap-1.5">
              {(["Yes", "No"] as const).map((label) => {
                const val = label === "Yes";
                return (
                  <button
                    key={label}
                    onClick={() => updateValue(param.id, val)}
                    className={cn(
                      chips.base,
                      "transition-all duration-200",
                      values[param.id] === val
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : cn(chips.glass, "hover:bg-primary/10")
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* String input */}
          {param.type === "string" && (
            <input
              type="text"
              value={(values[param.id] as string) || ""}
              onChange={(e) => updateValue(param.id, e.target.value)}
              className={cn(
                "w-full px-3 py-1.5 text-sm rounded-xl border border-white/40 dark:border-white/[0.06]",
                "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
                "focus:outline-none focus:ring-1 focus:ring-primary/30"
              )}
            />
          )}

          {/* Number input */}
          {param.type === "number" && (
            <input
              type="number"
              value={(values[param.id] as number) ?? ""}
              onChange={(e) =>
                updateValue(param.id, parseFloat(e.target.value) || 0)
              }
              className={cn(
                "w-full px-3 py-1.5 text-sm rounded-xl border border-white/40 dark:border-white/[0.06]",
                "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
                "focus:outline-none focus:ring-1 focus:ring-primary/30"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result Area
// ---------------------------------------------------------------------------

function tryPrettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function highlightHtml(html: string) {
  const parts: React.ReactNode[] = [];
  const tagRegex = /(<\/?[\w-]+)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?>)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      parts.push(html.slice(lastIndex, match.index));
    }
    const [, tagName, attrs, close] = match;
    const attrParts: React.ReactNode[] = [];
    if (attrs) {
      const attrRegex = /([\w-]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        const [, name, valueWithEq] = attrMatch;
        attrParts.push(" ");
        attrParts.push(<span key={`a-${match.index}-${attrMatch.index}`} className="text-amber-600 dark:text-amber-400">{name}</span>);
        if (valueWithEq) {
          const eqIdx = valueWithEq.indexOf("=");
          const eq = valueWithEq.slice(0, eqIdx + 1);
          const val = valueWithEq.slice(eqIdx + 1);
          attrParts.push(eq);
          attrParts.push(<span key={`v-${match.index}-${attrMatch.index}`} className="text-emerald-600 dark:text-emerald-400">{val}</span>);
        }
      }
    }
    parts.push(
      <span key={`t-${match.index}`}>
        <span className="text-rose-600 dark:text-rose-400">{tagName}</span>
        {attrParts}
        <span className="text-rose-600 dark:text-rose-400">{close}</span>
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) {
    parts.push(html.slice(lastIndex));
  }
  return parts;
}

function TestResultArea({
  state,
  result,
  error,
  contentWarning,
  outputFormat,
}: {
  state: "idle" | "running" | "done" | "error";
  result: string;
  error: string | null;
  contentWarning: string | null;
  outputFormat?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  // Idle: hint text
  if (state === "idle") {
    return (
      <div className="flex flex-col items-center justify-center py-5 text-muted-foreground">
        <Play className="h-6 w-6 mb-2 opacity-20" />
        <p className="text-xs">
          Select a memory and click Test Run to preview the output.
        </p>
      </div>
    );
  }

  // Error
  if (state === "error") {
    return (
      <div
        className={cn(
          "flex items-start gap-2.5 p-4 rounded-2xl text-sm",
          "bg-red-500/10 dark:bg-red-500/15 border border-red-500/20 dark:border-red-500/25"
        )}
      >
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <span className="text-red-700 dark:text-red-400">{error || "An error occurred"}</span>
      </div>
    );
  }

  // Running or Done
  return (
    <div className="space-y-3">
      {/* Content warning */}
      {contentWarning === "summary_only" && (
        <div
          className={cn(
            "flex items-center gap-2.5 p-3 rounded-2xl text-xs",
            glass.card,
            "border-l-2 border-amber-500"
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="text-amber-700 dark:text-amber-400">
            Only summary available for this memory — result may be limited.
          </span>
        </div>
      )}

      {/* Streaming indicator before first token */}
      {state === "running" && !result && (
        <div className={cn("flex items-center gap-3 py-5 justify-center rounded-2xl", glass.card)}>
          <div className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full bg-primary animate-pulse"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="h-2 w-2 rounded-full bg-primary animate-pulse"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="h-2 w-2 rounded-full bg-primary animate-pulse"
              style={{ animationDelay: "300ms" }}
            />
          </div>
          <span className="text-sm text-muted-foreground/70">
            Generating test output...
          </span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={cn("rounded-2xl p-4 border-l-2 border-primary/30 animate-fade-in-up", glass.card)}>
          {(!outputFormat || outputFormat === "markdown") ? (
            <div className="chat-prose text-sm">
              <ReactMarkdown>{result}</ReactMarkdown>
              {state === "running" && (
                <span className="inline-block w-0.5 h-4 ml-0.5 bg-primary animate-pulse align-text-bottom" />
              )}
            </div>
          ) : outputFormat === "json" ? (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto">
              <code>{tryPrettyJson(result)}</code>
              {state === "running" && (
                <span className="inline-block w-0.5 h-4 ml-0.5 bg-primary animate-pulse align-text-bottom" />
              )}
            </pre>
          ) : outputFormat === "html" ? (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto">
              <code>{highlightHtml(result)}</code>
              {state === "running" && (
                <span className="inline-block w-0.5 h-4 ml-0.5 bg-primary animate-pulse align-text-bottom" />
              )}
            </pre>
          ) : (
            <div className="text-sm whitespace-pre-wrap">
              {result}
              {state === "running" && (
                <span className="inline-block w-0.5 h-4 ml-0.5 bg-primary animate-pulse align-text-bottom" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Copy button when done */}
      {state === "done" && result && (
        <div className={cn("flex items-center gap-2 p-3 rounded-2xl animate-fade-in-up", glass.overlay)}>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl transition-all duration-200",
              glass.card,
              "hover:shadow-md hover:scale-[1.02] hover:text-primary active:scale-95"
            )}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-primary" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SkillTestRunner({ formState }: SkillTestRunnerProps) {
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});

  const { state, result, error, contentWarning, execute, reset } =
    useSkillTest();

  // Initialize parameter defaults when formState.parameters changes
  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    for (const p of formState.parameters) {
      if (p.type === "boolean") {
        defaults[p.id] = p.default === "true" || p.default === "yes";
      } else if (p.type === "number") {
        defaults[p.id] = parseFloat(p.default) || 0;
      } else {
        defaults[p.id] = p.default || "";
      }
    }
    setParamValues(defaults);
  }, [formState.parameters]);

  // Reset test result when prompts change
  useEffect(() => {
    if (state === "done" || state === "error") {
      reset();
    }
    // Only reset when prompts change, not when state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formState.prompt_system, formState.prompt_user_template]);

  const canRun =
    selectedMemory !== null &&
    formState.prompt_system.trim() !== "" &&
    formState.prompt_user_template.trim() !== "" &&
    state !== "running";

  const handleTestRun = async () => {
    if (!selectedMemory) return;

    // Map parameters to API format
    const apiParameters = formState.parameters.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      type: p.type,
      options: p.type === "select" ? p.options : undefined,
      default: p.default as unknown,
    }));

    await execute({
      memory_id: selectedMemory.id,
      prompt_system: formState.prompt_system,
      prompt_user_template: formState.prompt_user_template,
      parameters: apiParameters.length > 0 ? apiParameters : null,
      parameter_values: paramValues,
      input_accepts: formState.input_accepts,
      output_format: formState.output_format,
    });
  };

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Play className="h-4 w-4 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium">Test Run</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Preview the skill output against a real memory.
          </p>
        </div>
      </div>

      {/* Memory Selector */}
      <MemorySelector
        selectedMemory={selectedMemory}
        onSelect={setSelectedMemory}
      />

      {/* Parameter Controls */}
      <ParameterControls
        parameters={formState.parameters}
        values={paramValues}
        onChange={setParamValues}
      />

      {/* Test Run Button */}
      <Button
        onClick={handleTestRun}
        disabled={!canRun}
        className={cn(
          "w-full h-11 gap-2 transition-all duration-200",
          canRun
            ? "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.005]"
            : "opacity-60"
        )}
      >
        {state === "running" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Test Run
          </>
        )}
      </Button>

      {/* Validation hints */}
      {!canRun && state !== "running" && (
        <div className="space-y-1">
          {!selectedMemory && (
            <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              Select a memory to test against
            </p>
          )}
          {formState.prompt_system.trim() === "" && (
            <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              System prompt is empty
            </p>
          )}
          {formState.prompt_user_template.trim() === "" && (
            <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              User template is empty
            </p>
          )}
        </div>
      )}

      {/* Result Area */}
      <TestResultArea
        state={state}
        result={result}
        error={error}
        contentWarning={contentWarning}
        outputFormat={formState.output_format}
      />
    </div>
  );
}
