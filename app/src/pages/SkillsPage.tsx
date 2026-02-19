import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  Download,
  ChevronDown,
  ChevronRight,
  Zap,
  SlidersHorizontal,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { glass, chips, getSkillCategoryColor } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { useSkillsList } from "@/hooks/useSkills";
import SkillDetail from "@/components/SkillDetail";
import SkillExecutionHistory from "@/components/SkillExecutionHistory";
import { SkillImportDialog } from "@/components/SkillImportDialog";
import type { SkillListItem } from "@/lib/api";

type TabMode = "browse" | "history";
type SortBy = "alpha" | "recent_used" | "recent_created";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "productivity", label: "Productivity" },
  { value: "analysis", label: "Analysis" },
  { value: "export", label: "Export" },
  { value: "writing", label: "Writing" },
  { value: "research", label: "Research" },
  { value: "custom", label: "Custom" },
];

function SkillCard({
  skill,
  isSelected,
  onClick,
}: {
  skill: SkillListItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const catColor = getSkillCategoryColor(skill.category);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-xl transition-all duration-200 group",
        glass.card,
        isSelected
          ? "ring-2 ring-primary/40 bg-primary/5 dark:bg-primary/10 shadow-md shadow-primary/10"
          : [
              "hover:bg-white/60 dark:hover:bg-white/[0.06]",
              "hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20",
              "hover:-translate-y-0.5",
            ]
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0",
            "bg-white/50 dark:bg-white/[0.04] border border-white/60 dark:border-white/10",
            "group-hover:shadow-sm group-hover:shadow-primary/10 transition-all duration-200"
          )}
        >
          {skill.logo ? (
            <img src={skill.logo} alt="" className="h-5 w-5 rounded object-cover" />
          ) : (
            <span className="text-lg">{skill.icon}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{skill.name}</span>
            <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
              v{skill.version}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {skill.description}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className={cn(
                chips.base,
                "text-[10px] py-0.5 border",
                catColor.bg,
                catColor.text,
                catColor.border
              )}
            >
              {skill.category}
            </span>
            {skill.execution_count > 0 && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {skill.execution_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function SkillSection({
  title,
  skills,
  selectedId,
  onSelect,
  collapsible = false,
  defaultCollapsed = false,
}: {
  title: string;
  skills: SkillListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (skills.length === 0) return null;

  return (
    <div className="mb-5">
      <button
        onClick={() => collapsible && setCollapsed(!collapsed)}
        className={cn(
          "flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1 w-full",
          collapsible && "cursor-pointer hover:text-muted-foreground transition-colors"
        )}
      >
        <div className="h-px w-4 bg-primary/30 flex-shrink-0" />
        {collapsible &&
          (collapsed ? (
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 flex-shrink-0" />
          ))}
        {title}
        <span className="text-muted-foreground/40">({skills.length})</span>
        <div className="flex-1 h-px bg-border/50" />
      </button>
      {!collapsed && (
        <div className="space-y-2">
          {skills.map((skill, index) => (
            <div
              key={skill.id}
              className="animate-stagger-fade-in opacity-0"
              style={{
                animationDelay: `${Math.min(index * 50, 1000)}ms`,
                animationFillMode: "forwards",
              }}
            >
              <SkillCard
                skill={skill}
                isSelected={selectedId === skill.id}
                onClick={() => onSelect(skill.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SkillsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabMode>("browse");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("alpha");
  const [sortOpen, setSortOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFileContent, setImportFileContent] = useState<string | null>(
    null
  );

  const { skills, isLoading, refresh } = useSkillsList({
    include_hidden: true,
    search: searchQuery || undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
  });

  // Listen for .think-skill file import events from Electron
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ filePath: string; content: string }>)
        .detail;
      setImportFileContent(detail.content);
      setShowImportDialog(true);
      setActiveTab("browse");
    };
    window.addEventListener("import-skill-file", handler);
    return () => window.removeEventListener("import-skill-file", handler);
  }, []);

  // Sort and group skills
  const sortSkills = useCallback(
    (list: SkillListItem[]) => {
      const sorted = [...list];
      switch (sortBy) {
        case "alpha":
          sorted.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case "recent_used":
          sorted.sort((a, b) =>
            (b.last_executed_at ?? "").localeCompare(
              a.last_executed_at ?? ""
            )
          );
          break;
        case "recent_created":
          sorted.sort((a, b) =>
            (b.created_at ?? "").localeCompare(a.created_at ?? "")
          );
          break;
      }
      return sorted;
    },
    [sortBy]
  );

  const builtinSkills = useMemo(
    () =>
      sortSkills(
        skills.filter((s) => s.source === "builtin" && !s.hidden)
      ),
    [skills, sortSkills]
  );
  const userSkills = useMemo(
    () =>
      sortSkills(
        skills.filter((s) => s.source === "user" && !s.hidden)
      ),
    [skills, sortSkills]
  );
  const hiddenSkills = useMemo(
    () => sortSkills(skills.filter((s) => s.hidden)),
    [skills, sortSkills]
  );

  const totalSkills = builtinSkills.length + userSkills.length;

  const handleSkillSelect = (id: string) => {
    setSelectedSkillId(id === selectedSkillId ? null : id);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center animate-glow-pulse">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-semibold">Skills</h1>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {totalSkills} skill{totalSkills !== 1 ? "s" : ""} available
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setImportFileContent(null);
              setShowImportDialog(true);
            }}
            className="gap-1.5 hover:shadow-sm hover:shadow-primary/10 transition-all duration-200"
          >
            <Download className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/skills/new")}
            className="gap-1.5 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            New Skill
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className={cn("inline-flex items-center gap-1 p-1 rounded-xl mb-6", glass.overlay)}>
        {(["browse", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-5 py-2 text-sm rounded-lg transition-all duration-200 capitalize",
              activeTab === tab
                ? "bg-primary/15 text-primary font-medium shadow-sm shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-white/40 dark:hover:bg-white/[0.04]"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Browse Tab */}
      {activeTab === "browse" && (
        <>
          {/* Search + Filters */}
          <div className={cn("flex items-center gap-2 mb-6 p-2 rounded-xl", glass.overlay)}>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
              <Input
                placeholder="Search skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-white/50 dark:bg-white/[0.03] border-white/40 dark:border-white/[0.06] focus-visible:ring-primary/30 focus-visible:shadow-sm focus-visible:shadow-primary/10 transition-shadow duration-200"
              />
            </div>

            {/* Category filter */}
            <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {CATEGORIES.find((c) => c.value === categoryFilter)?.label ??
                    "All"}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1" align="end">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => {
                      setCategoryFilter(cat.value);
                      setCategoryOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                      categoryFilter === cat.value
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted"
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Sort */}
            <Popover open={sortOpen} onOpenChange={setSortOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9">
                  Sort
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1" align="end">
                {[
                  { value: "alpha" as const, label: "Alphabetical" },
                  { value: "recent_used" as const, label: "Recently used" },
                  {
                    value: "recent_created" as const,
                    label: "Recently created",
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSortBy(opt.value);
                      setSortOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                      sortBy === opt.value
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

          {/* Skill List */}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : builtinSkills.length === 0 &&
            userSkills.length === 0 &&
            hiddenSkills.length === 0 ? (
            <div className="text-center py-20 animate-fade-in-up">
              <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/5 flex items-center justify-center mb-4">
                <Zap className="h-8 w-8 text-muted-foreground/20" />
              </div>
              <p className="text-muted-foreground">
                {searchQuery
                  ? "No skills match your search."
                  : "No skills found."}
              </p>
            </div>
          ) : (
            <div>
              <SkillSection
                title="Built-in"
                skills={builtinSkills}
                selectedId={selectedSkillId}
                onSelect={handleSkillSelect}
              />
              <SkillSection
                title="My Skills"
                skills={userSkills}
                selectedId={selectedSkillId}
                onSelect={handleSkillSelect}
              />
              {userSkills.length === 0 && !searchQuery && (
                <div
                  className={cn(
                    "rounded-xl p-6 text-center mb-5 animate-fade-in-up",
                    glass.overlay
                  )}
                >
                  <p className="text-sm text-muted-foreground mb-3">
                    No custom skills yet. Create one or import a .think-skill
                    file.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setImportFileContent(null);
                        setShowImportDialog(true);
                      }}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Import
                    </Button>
                    <Button size="sm" onClick={() => navigate("/skills/new")}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      New Skill
                    </Button>
                  </div>
                </div>
              )}
              <SkillSection
                title="Hidden"
                skills={hiddenSkills}
                selectedId={selectedSkillId}
                onSelect={handleSkillSelect}
                collapsible
                defaultCollapsed
              />
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {activeTab === "history" && <SkillExecutionHistory />}

      {/* Detail Panel */}
      <SkillDetail
        skillId={selectedSkillId}
        isOpen={selectedSkillId !== null}
        onClose={() => setSelectedSkillId(null)}
        onDeleted={() => {
          setSelectedSkillId(null);
          refresh();
        }}
        onUpdated={refresh}
      />

      {/* Import Dialog */}
      <SkillImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        initialContent={importFileContent}
        onImported={() => {
          setShowImportDialog(false);
          setImportFileContent(null);
          refresh();
        }}
      />
    </div>
  );
}
