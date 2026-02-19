import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ArrowRight,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { glass } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { useExecutionHistory, useSkills } from "@/hooks/useSkills";
import type { ExecutionHistoryItem, ExecutionHistoryFilters } from "@/lib/api";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ExecutionRow({ execution }: { execution: ExecutionHistoryItem }) {
  const navigate = useNavigate();
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3.5 rounded-xl transition-all duration-200 group",
        glass.card,
        "hover:bg-white/60 dark:hover:bg-white/[0.06] hover:shadow-sm hover:-translate-y-[1px]"
      )}
    >
      <div className="h-8 w-8 rounded-lg bg-white/50 dark:bg-white/[0.04] border border-white/60 dark:border-white/10 flex items-center justify-center flex-shrink-0">
        {execution.skill_logo ? (
          <img src={execution.skill_logo} alt="" className="h-4 w-4 rounded object-cover" />
        ) : (
          <span className="text-sm">{execution.skill_icon}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium truncate">{execution.skill_name}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
          <button
            onClick={() => navigate(`/memories?open=${execution.memory_id}`)}
            className="text-muted-foreground truncate hover:text-primary hover:underline transition-colors"
          >
            {execution.memory_title || "Untitled"}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground/60">
          <span>{formatTime(execution.created_at)}</span>
          {execution.duration_seconds != null && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {execution.duration_seconds}s
            </span>
          )}
          {execution.status === "failed" && execution.error && (
            <span className="text-red-500/80 truncate max-w-48">
              {execution.error}
            </span>
          )}
        </div>
      </div>
      {execution.status === "completed" ? (
        <div className={cn("h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0", "bg-emerald-500/10")}>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        </div>
      ) : execution.status === "failed" ? (
        <div className={cn("h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0", "bg-red-500/10")}>
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        </div>
      ) : (
        <div className={cn("h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0", "bg-amber-500/10")}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
        </div>
      )}
    </div>
  );
}

export default function SkillExecutionHistory() {
  const { skills } = useSkills();
  const [skillFilter, setSkillFilter] = useState("all");
  const [skillFilterOpen, setSkillFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const filters: ExecutionHistoryFilters = useMemo(
    () => ({
      skill_id: skillFilter !== "all" ? skillFilter : undefined,
      status:
        statusFilter !== "all"
          ? (statusFilter as "completed" | "failed")
          : undefined,
      search: debouncedSearch || undefined,
      limit: 20,
    }),
    [skillFilter, statusFilter, debouncedSearch]
  );

  const { executions, total, isLoading, hasMore, loadMore } =
    useExecutionHistory(filters);

  // Infinite scroll sentinel
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  // Group executions by date
  const grouped = useMemo(() => {
    const groups: Map<string, ExecutionHistoryItem[]> = new Map();
    for (const ex of executions) {
      const dateKey = new Date(ex.created_at).toDateString();
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(ex);
    }
    return groups;
  }, [executions]);

  return (
    <div>
      {/* Filters */}
      <div className={cn("flex items-center gap-2 mb-6 p-2 rounded-xl", glass.overlay)}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <Input
            placeholder="Search by memory title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Skill filter */}
        <Popover open={skillFilterOpen} onOpenChange={setSkillFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              {skillFilter === "all"
                ? "All Skills"
                : skills.find((s) => s.id === skillFilter)?.name ?? "Skill"}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1 max-h-64 overflow-y-auto" align="end">
            <button
              onClick={() => {
                setSkillFilter("all");
                setSkillFilterOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                skillFilter === "all"
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted"
              )}
            >
              All Skills
            </button>
            {skills.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSkillFilter(s.id);
                  setSkillFilterOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-2",
                  skillFilter === s.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                {s.logo ? (
                  <img src={s.logo} alt="" className="h-4 w-4 rounded object-cover" />
                ) : (
                  <span>{s.icon}</span>
                )}
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Status filter */}
        <Popover open={statusFilterOpen} onOpenChange={setStatusFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              {statusFilter === "all"
                ? "All Status"
                : statusFilter === "completed"
                  ? "Completed"
                  : "Failed"}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-36 p-1" align="end">
            {[
              { value: "all", label: "All Status" },
              { value: "completed", label: "Completed" },
              { value: "failed", label: "Failed" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setStatusFilter(opt.value);
                  setStatusFilterOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                  statusFilter === opt.value
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Results count */}
      {total > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <div className="h-1.5 w-1.5 rounded-full bg-primary/50" />
          <p className="text-xs text-muted-foreground/50">
            {total} execution{total !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* Grouped list */}
      {isLoading && executions.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : executions.length === 0 ? (
        <div className="text-center py-20 animate-fade-in-up">
          <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/5 flex items-center justify-center mb-4">
            <Clock className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <p className="text-muted-foreground">
            {debouncedSearch || skillFilter !== "all" || statusFilter !== "all"
              ? "No executions match your filters."
              : "No skill executions yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from(grouped.entries()).map(([dateKey, execs]) => (
            <div key={dateKey}>
              <div className="flex items-center gap-3 mb-3 px-1">
                <h3 className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-widest whitespace-nowrap">
                  {formatDateHeader(execs[0].created_at)}
                </h3>
                <div className="flex-1 h-px bg-border/40" />
              </div>
              <div className="space-y-2">
                {execs.map((ex, index) => (
                  <div
                    key={ex.id}
                    className="animate-stagger-fade-in opacity-0"
                    style={{
                      animationDelay: `${Math.min(index * 40, 1000)}ms`,
                      animationFillMode: 'forwards',
                    }}
                  >
                    <ExecutionRow execution={ex} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load more sentinel */}
      {hasMore && <div ref={loadMoreRef} className="h-1" />}
      {isLoading && executions.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
