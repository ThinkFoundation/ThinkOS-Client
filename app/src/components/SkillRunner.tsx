import React, { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  ChevronLeft,
  X,
  Zap,
  Copy,
  RefreshCw,
  Loader2,
  Eye,
  AlertTriangle,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  Globe,
  FileText,
  Mic,
  FileAudio,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { glass, chips, getMemoryTypeColor } from "@/lib/design-tokens";
import { getSkillWithPrompt, type Skill, type SkillExecution } from "@/lib/api";
import { useSkills, useSkillExecution, useSkillHistory } from "@/hooks/useSkills";
import { toast } from "sonner";

// --- Types ---

interface SkillRunnerMemory {
  id: number;
  type: string;
  title: string;
  content?: string;
  transcript?: string;
  summary: string | null;
}

interface SkillRunnerProps {
  memoryId: number;
  memory: SkillRunnerMemory;
  onClose: () => void;
  formatDate: (date: string) => string;
  initialExecutionId?: number | null;
}

type SkillRunnerView =
  | { screen: "selection" }
  | { screen: "skill"; skillId: string; tab: "configure" | "result" | "history"; viewingExecution?: SkillExecution | null };

// --- Helper: Memory type icon ---

function MemoryTypeIcon({ type, className }: { type: string; className?: string }) {
  const base = className || "h-3.5 w-3.5";
  switch (type) {
    case "web": return <Globe className={base} />;
    case "voice_memo":
    case "voice": return <Mic className={base} />;
    case "audio": return <FileAudio className={base} />;
    case "video": return <Video className={base} />;
    case "document": return <FileText className={base} />;
    default: return <FileText className={base} />;
  }
}

function memoryTypeLabel(type: string): string {
  switch (type) {
    case "voice_memo":
    case "voice": return "Voice Memo";
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

// --- Main Component ---

export function SkillRunner({
  memoryId,
  memory,
  onClose,
  formatDate,
  initialExecutionId,
}: SkillRunnerProps) {
  const [view, setView] = useState<SkillRunnerView>({ screen: "selection" });
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const { skills, isLoading: isLoadingSkills } = useSkills();
  const skillExecution = useSkillExecution();
  const { executions, refresh: refreshHistory } = useSkillHistory(memoryId);
  const [params, setParams] = useState<Record<string, unknown>>({});

  // Handle initial execution view (from Skill Results section)
  useEffect(() => {
    if (initialExecutionId && executions.length > 0) {
      const execution = executions.find((e) => e.id === initialExecutionId);
      if (execution) {
        const skill = skills.find((s) => s.id === execution.skill_id);
        if (skill) {
          setSelectedSkill(skill);
          setView({
            screen: "skill",
            skillId: skill.id,
            tab: "result",
            viewingExecution: execution,
          });
        }
      }
    }
  }, [initialExecutionId, executions, skills]);

  const handleSelectSkill = (skill: Skill) => {
    setSelectedSkill(skill);
    const defaults: Record<string, unknown> = {};
    for (const p of skill.parameters) {
      defaults[p.id] = p.default;
    }
    setParams(defaults);
    skillExecution.reset();
    setView({ screen: "skill", skillId: skill.id, tab: "configure" });
  };

  const handleBack = () => {
    if (view.screen === "skill") {
      skillExecution.reset();
      setSelectedSkill(null);
      setView({ screen: "selection" });
    } else {
      onClose();
    }
  };

  const handleRun = async () => {
    if (!selectedSkill) return;
    setView({ screen: "skill", skillId: selectedSkill.id, tab: "result", viewingExecution: null });
    await skillExecution.execute({
      skill_id: selectedSkill.id,
      memory_id: memoryId,
      parameters: params,
    });
    refreshHistory();
  };

  const handleRerun = () => {
    if (!selectedSkill) return;
    setView({ screen: "skill", skillId: selectedSkill.id, tab: "configure" });
  };

  const handleViewExecution = (execution: SkillExecution) => {
    const skill = skills.find((s) => s.id === execution.skill_id);
    if (skill) {
      setSelectedSkill(skill);
      setView({
        screen: "skill",
        skillId: skill.id,
        tab: "result",
        viewingExecution: execution,
      });
    }
  };

  const isSkillCompatible = (skill: Skill) => {
    if (!skill.input.accepts) return true;
    return skill.input.accepts.includes(memory.type);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleBack}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded-xl transition-all duration-200",
              glass.card,
              "hover:shadow-md hover:scale-[1.02]"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {view.screen === "skill" && selectedSkill ? (
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none">
                {selectedSkill.logo ? (
                  <img src={selectedSkill.logo} alt="" className="h-5 w-5 rounded" />
                ) : (
                  selectedSkill.icon
                )}
              </span>
              <span className="text-sm font-medium">{selectedSkill.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Skills</span>
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view.screen === "selection" && (
          <SkillSelectionView
            skills={skills}
            isLoading={isLoadingSkills}
            memory={memory}
            isSkillCompatible={isSkillCompatible}
            onSelect={handleSelectSkill}
          />
        )}

        {view.screen === "skill" && selectedSkill && (
          <SkillDetailView
            skill={selectedSkill}
            memory={memory}
            params={params}
            setParams={setParams}
            tab={view.tab}
            setTab={(tab) =>
              setView((prev) =>
                prev.screen === "skill" ? { ...prev, tab } : prev
              )
            }
            viewingExecution={view.viewingExecution ?? null}
            execution={skillExecution}
            executions={executions}
            formatDate={formatDate}
            onRun={handleRun}
            onRerun={handleRerun}
            onViewExecution={handleViewExecution}
          />
        )}
      </div>
    </div>
  );
}

// --- Skill Selection View ---

function SkillSelectionView({
  skills,
  isLoading,
  memory,
  isSkillCompatible,
  onSelect,
}: {
  skills: Skill[];
  isLoading: boolean;
  memory: SkillRunnerMemory;
  isSkillCompatible: (skill: Skill) => boolean;
  onSelect: (skill: Skill) => void;
}) {
  const typeColor = getMemoryTypeColor(memory.type);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {/* Target memory card */}
      <div className={cn("px-4 py-3 rounded-2xl flex items-center gap-3", glass.card)}>
        <div
          className="flex items-center justify-center h-8 w-8 rounded-xl"
          style={{ backgroundColor: `${typeColor.hex}15` }}
        >
          <MemoryTypeIcon type={memory.type} className={cn("h-4 w-4", typeColor.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{memoryTypeLabel(memory.type)}</p>
          <p className="text-sm font-medium truncate">{memory.title || "Untitled"}</p>
        </div>
      </div>

      {/* Skill cards */}
      {skills.filter(isSkillCompatible).map((skill, index) => (
        <button
          key={skill.id}
          onClick={() => onSelect(skill)}
          className={cn(
            "w-full text-left p-4 rounded-2xl transition-all duration-200 animate-fade-in-up",
            glass.base,
            glass.hover,
            "cursor-pointer"
          )}
          style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
        >
          <div className="flex items-start gap-3.5">
            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/5 text-xl leading-none shrink-0">
              {skill.logo ? (
                <img src={skill.logo} alt="" className="h-6 w-6 rounded" />
              ) : (
                skill.icon
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{skill.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {skill.description}
              </div>
              <span className={cn(chips.base, chips.primary, "mt-2 inline-block")}>
                {skill.category}
              </span>
            </div>
          </div>
        </button>
      ))}

      {skills.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Zap className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">No skills available</p>
        </div>
      )}
    </div>
  );
}

// --- Skill Detail View (Tabs) ---

function SkillDetailView({
  skill,
  memory,
  params,
  setParams,
  tab,
  setTab,
  viewingExecution,
  execution,
  executions,
  formatDate,
  onRun,
  onRerun,
  onViewExecution,
}: {
  skill: Skill;
  memory: SkillRunnerMemory;
  params: Record<string, unknown>;
  setParams: (p: Record<string, unknown>) => void;
  tab: "configure" | "result" | "history";
  setTab: (tab: "configure" | "result" | "history") => void;
  viewingExecution: SkillExecution | null;
  execution: ReturnType<typeof useSkillExecution>;
  executions: SkillExecution[];
  formatDate: (date: string) => string;
  onRun: () => void;
  onRerun: () => void;
  onViewExecution: (execution: SkillExecution) => void;
}) {
  const showResultTab = execution.state !== "idle" || viewingExecution !== null;

  return (
    <div className="flex flex-col">
      {/* Segmented Control Tabs */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex bg-muted/30 rounded-xl p-1">
          <button
            onClick={() => setTab("configure")}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200",
              tab === "configure"
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Configure
          </button>
          {showResultTab && (
            <button
              onClick={() => setTab("result")}
              className={cn(
                "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5",
                tab === "result"
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Result
              {execution.state === "running" && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              )}
            </button>
          )}
          <button
            onClick={() => setTab("history")}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200",
              tab === "history"
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            History
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="p-5">
        {tab === "configure" && (
          <SkillConfigureTab
            skill={skill}
            memory={memory}
            params={params}
            setParams={setParams}
            onRun={onRun}
            isRunning={execution.state === "running"}
          />
        )}
        {tab === "result" && (
          <SkillResultTab
            execution={execution}
            viewingExecution={viewingExecution}
            skillName={skill.name}
            onRerun={onRerun}
            outputFormat={skill.output_format}
          />
        )}
        {tab === "history" && (
          <SkillHistoryTab
            executions={executions}
            formatDate={formatDate}
            onView={onViewExecution}
          />
        )}
      </div>
    </div>
  );
}

// --- Configure Tab ---

function SkillConfigureTab({
  skill,
  memory,
  params,
  setParams,
  onRun,
  isRunning,
}: {
  skill: Skill;
  memory: SkillRunnerMemory;
  params: Record<string, unknown>;
  setParams: (p: Record<string, unknown>) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptData, setPromptData] = useState<{ system: string; user_template: string } | null>(null);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);

  const typeColor = getMemoryTypeColor(memory.type);

  const handleViewPrompt = async () => {
    if (showPrompt) {
      setShowPrompt(false);
      return;
    }
    if (!promptData) {
      setIsLoadingPrompt(true);
      try {
        const data = await getSkillWithPrompt(skill.id);
        if (data.prompt) {
          setPromptData(data.prompt);
        }
      } catch {
        toast.error("Failed to load prompt");
      } finally {
        setIsLoadingPrompt(false);
      }
    }
    setShowPrompt(true);
  };

  const updateParam = (id: string, value: unknown) => {
    setParams({ ...params, [id]: value });
  };

  return (
    <div className="space-y-5">
      {/* Target memory card */}
      <div className={cn("px-4 py-3 rounded-2xl flex items-center gap-3", glass.card)}>
        <div
          className="flex items-center justify-center h-8 w-8 rounded-xl"
          style={{ backgroundColor: `${typeColor.hex}15` }}
        >
          <MemoryTypeIcon type={memory.type} className={cn("h-4 w-4", typeColor.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{memoryTypeLabel(memory.type)}</p>
          <p className="text-sm font-medium truncate">{memory.title || "Untitled"}</p>
        </div>
      </div>

      {/* Parameters */}
      {skill.parameters.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Parameters
          </h4>
          {skill.parameters.map((param) => (
            <div key={param.id} className={cn("p-4 rounded-2xl space-y-2.5", glass.card)}>
              <div>
                <label className="text-sm font-medium">{param.label}</label>
                {param.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{param.description}</p>
                )}
              </div>

              {param.type === "select" && param.options && (
                <div className="flex flex-wrap gap-1.5">
                  {param.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => updateParam(param.id, opt)}
                      className={cn(
                        chips.base,
                        "transition-all duration-200",
                        params[param.id] === opt
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : cn(chips.glass, "hover:bg-primary/10")
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {param.type === "boolean" && (
                <div className="flex gap-1.5">
                  {["Yes", "No"].map((label) => {
                    const val = label === "Yes";
                    return (
                      <button
                        key={label}
                        onClick={() => updateParam(param.id, val)}
                        className={cn(
                          chips.base,
                          "transition-all duration-200",
                          params[param.id] === val
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

              {param.type === "string" && (
                <input
                  type="text"
                  value={(params[param.id] as string) || ""}
                  onChange={(e) => updateParam(param.id, e.target.value)}
                  className={cn(
                    "w-full px-3 py-1.5 text-sm rounded-xl border border-white/40 dark:border-white/[0.06]",
                    "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                  )}
                />
              )}

              {param.type === "number" && (
                <input
                  type="number"
                  value={(params[param.id] as number) ?? ""}
                  onChange={(e) => updateParam(param.id, parseFloat(e.target.value) || 0)}
                  className={cn(
                    "w-full px-3 py-1.5 text-sm rounded-xl border border-white/40 dark:border-white/[0.06]",
                    "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                  )}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Run button */}
      <Button
        onClick={onRun}
        disabled={isRunning}
        className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all duration-200"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Zap className="h-4 w-4 mr-2" />
            Run Skill
          </>
        )}
      </Button>

      {/* View Prompt */}
      <button
        onClick={handleViewPrompt}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isLoadingPrompt ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
        View Prompt
        {showPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {showPrompt && promptData && (
        <div className="space-y-2">
          <div className={cn("rounded-2xl p-4", glass.overlay)}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">System</p>
            <pre className="font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{promptData.system}</pre>
          </div>
          <div className={cn("rounded-2xl p-4", glass.overlay)}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">User Template</p>
            <pre className="font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{promptData.user_template}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Result Tab ---

function tryPrettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function highlightHtml(html: string) {
  // Tokenize HTML into tags and text segments
  const parts: React.ReactNode[] = [];
  const tagRegex = /(<\/?[\w-]+)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?>)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    // Text before this tag
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

  // Remaining text
  if (lastIndex < html.length) {
    parts.push(html.slice(lastIndex));
  }

  return parts;
}

function SkillResultTab({
  execution,
  viewingExecution,
  skillName,
  onRerun,
  outputFormat,
}: {
  execution: ReturnType<typeof useSkillExecution>;
  viewingExecution: SkillExecution | null;
  skillName: string;
  onRerun: () => void;
  outputFormat?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Determine what to show: saved execution or live stream
  const isLive = viewingExecution === null;
  const resultText = isLive ? execution.result : viewingExecution?.result || "";
  const isRunning = isLive && execution.state === "running";
  const isDone = isLive ? execution.state === "done" : viewingExecution?.status === "completed";
  const errorMsg = isLive ? execution.error : viewingExecution?.error;
  const contentWarning = isLive ? execution.contentWarning : null;

  const handleCopy = async () => {
    if (!resultText) return;
    await navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Content warning */}
      {contentWarning === "summary_only" && (
        <div className={cn(
          "flex items-center gap-2.5 p-3 rounded-2xl text-xs",
          glass.card,
          "border-l-2 border-amber-500"
        )}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="text-amber-700 dark:text-amber-400">
            Only summary available — result may be limited.
          </span>
        </div>
      )}

      {/* Streaming indicator */}
      {isRunning && !resultText && (
        <div className="flex items-center gap-3 py-6 justify-center">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-sm text-muted-foreground">Generating {skillName.toLowerCase()}...</span>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-2xl bg-red-500/10 dark:bg-red-500/15 border border-red-500/20 dark:border-red-500/25 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Result */}
      {resultText && (
        <div className={cn("rounded-2xl p-4", glass.card)}>
          {(!outputFormat || outputFormat === "markdown") ? (
            <div className="chat-prose text-sm">
              <ReactMarkdown>{resultText}</ReactMarkdown>
              {isRunning && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          ) : outputFormat === "json" ? (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto">
              <code>{tryPrettyJson(resultText)}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </pre>
          ) : outputFormat === "html" ? (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto">
              <code>{highlightHtml(resultText)}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </pre>
          ) : (
            <div className="text-sm whitespace-pre-wrap">
              {resultText}
              {isRunning && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {isDone && resultText && (
        <div className={cn("flex items-center gap-2 p-3 rounded-2xl", glass.overlay)}>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl transition-all duration-200",
              glass.card,
              "hover:shadow-md hover:scale-[1.02]"
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
          <button
            onClick={onRerun}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl transition-all duration-200",
              glass.card,
              "hover:shadow-md hover:scale-[1.02]"
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Rerun
          </button>
        </div>
      )}
    </div>
  );
}

// --- History Tab ---

function SkillHistoryTab({
  executions,
  formatDate,
  onView,
}: {
  executions: SkillExecution[];
  formatDate: (date: string) => string;
  onView: (execution: SkillExecution) => void;
}) {
  if (executions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Clock className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm">No executions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {executions.map((ex, index) => (
        <button
          key={ex.id}
          onClick={() => onView(ex)}
          className={cn(
            "w-full text-left p-3.5 rounded-2xl transition-all duration-200 animate-fade-in-up",
            glass.base,
            glass.hover
          )}
          style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg leading-none">
              {ex.skill_logo ? (
                <img src={ex.skill_logo} alt="" className="h-5 w-5 rounded object-cover" />
              ) : (
                ex.skill_icon
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{ex.skill_name}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Clock className="h-3 w-3" />
                {ex.created_at ? formatDate(ex.created_at) : "—"}
              </div>
            </div>
            <StatusBadge status={ex.status} />
          </div>
        </button>
      ))}
    </div>
  );
}

// --- Status Badge ---

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className={cn(chips.base, "bg-primary/10 text-primary")}>
        Done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={cn(chips.base, "bg-red-500/10 text-red-700 dark:text-red-400")}>
        Failed
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className={cn(chips.base, "bg-blue-500/10 text-blue-500 animate-pulse")}>
        Running
      </span>
    );
  }
  return null;
}

// --- Skill Results Section (for MemoryDetailPanel) ---

export function SkillResultsSection({
  memoryId,
  formatDate,
  onViewExecution,
}: {
  memoryId: number;
  formatDate: (date: string) => string;
  onViewExecution: (executionId: number) => void;
}) {
  const { executions, isLoading } = useSkillHistory(memoryId);

  if (isLoading || executions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 pt-4 border-t">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-muted-foreground">Skill Results</span>
        <span className={cn(chips.base, chips.primary)}>{executions.length}</span>
      </div>
      <div className="space-y-2">
        {executions.map((ex, index) => (
          <button
            key={ex.id}
            onClick={() => onViewExecution(ex.id)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all duration-200 animate-fade-in-up",
              glass.base,
              glass.hover
            )}
            style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
          >
            <span className="text-base leading-none">
              {ex.skill_logo ? (
                <img src={ex.skill_logo} alt="" className="h-4 w-4 rounded object-cover" />
              ) : (
                ex.skill_icon
              )}
            </span>
            <span className="text-xs flex-1 truncate font-medium">{ex.skill_name}</span>
            <span className="text-[10px] text-muted-foreground">
              {ex.created_at ? formatDate(ex.created_at) : ""}
            </span>
            <Eye className="h-3 w-3 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
