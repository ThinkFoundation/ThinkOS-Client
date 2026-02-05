import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { glass, memoryTypeColors } from "@/lib/design-tokens";
import {
  ChevronDown,
  Check,
  Globe,
  FileText,
  Mic,
  FileAudio,
  Video,
  LayoutGrid,
  Calendar,
  X,
} from "lucide-react";
import type { GraphFilters as GraphFiltersType } from "../lib/api";

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All", icon: LayoutGrid, dot: null },
  { value: "web", label: "Web", icon: Globe, dot: memoryTypeColors.web.bg },
  { value: "note", label: "Notes", icon: FileText, dot: memoryTypeColors.note.bg },
  { value: "voice_memo", label: "Voice Memos", icon: Mic, dot: memoryTypeColors.voice_memo.bg },
  { value: "audio", label: "Audio", icon: FileAudio, dot: memoryTypeColors.audio.bg },
  { value: "video", label: "Video", icon: Video, dot: memoryTypeColors.video.bg },
  { value: "document", label: "Documents", icon: FileText, dot: memoryTypeColors.document.bg },
] as const;

const DATE_FILTER_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
] as const;

interface GraphFiltersProps {
  filters: GraphFiltersType;
  onFiltersChange: (filters: GraphFiltersType) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  inline?: boolean;
}

export default function GraphFilters({
  filters,
  onFiltersChange,
  searchQuery,
  onSearchChange,
  inline = false,
}: GraphFiltersProps) {
  const typeFilter = filters.type || "all";
  const dateFilter = filters.date_range || "all";
  const showIsolated = filters.include_isolated !== false;

  const [typeFilterOpen, setTypeFilterOpen] = React.useState(false);
  const [dateFilterOpen, setDateFilterOpen] = React.useState(false);

  const isNonDefault = typeFilter !== "all" || dateFilter !== "all" || !showIsolated;

  const selectedTypeOption =
    TYPE_FILTER_OPTIONS.find((opt) => opt.value === typeFilter) ||
    TYPE_FILTER_OPTIONS[0];
  const selectedDateOption =
    DATE_FILTER_OPTIONS.find((opt) => opt.value === dateFilter) ||
    DATE_FILTER_OPTIONS[0];

  const TypeIcon = selectedTypeOption.icon;

  const handleClear = () => {
    onFiltersChange({ type: "all", date_range: "all", include_isolated: true });
  };

  const filterButtons = (
    <>
      {/* Segmented control pill */}
      <div className={cn(
        "flex items-center rounded-lg overflow-hidden",
        "border border-white/30 dark:border-white/[0.06]",
        "bg-white/20 dark:bg-white/[0.02]"
      )}>
        {/* Type Filter */}
        <Popover open={typeFilterOpen} onOpenChange={setTypeFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 rounded-none border-r border-white/20 dark:border-white/[0.06]",
                typeFilter !== "all" && "bg-primary/10 text-primary"
              )}
            >
              {selectedTypeOption.dot ? (
                <div className={cn("mr-1.5 h-2.5 w-2.5 rounded-full", selectedTypeOption.dot)} />
              ) : (
                <TypeIcon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              )}
              {selectedTypeOption.label}
              <ChevronDown className="ml-1.5 h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            {TYPE_FILTER_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => {
                    onFiltersChange({ ...filters, type: option.value });
                    setTypeFilterOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                    typeFilter === option.value && "bg-accent"
                  )}
                >
                  {option.dot ? (
                    <div className={cn("h-3 w-3 rounded-full", option.dot)} />
                  ) : (
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="flex-1 text-left">{option.label}</span>
                  {typeFilter === option.value && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>

        {/* Date Filter */}
        <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 rounded-none border-r border-white/20 dark:border-white/[0.06]",
                dateFilter !== "all" && "bg-primary/10 text-primary"
              )}
            >
              <Calendar className={cn("mr-1.5 h-3.5 w-3.5", dateFilter !== "all" && "text-primary")} />
              {selectedDateOption.label}
              <ChevronDown className="ml-1.5 h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            {DATE_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onFiltersChange({ ...filters, date_range: option.value });
                  setDateFilterOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  dateFilter === option.value && "bg-accent"
                )}
              >
                <span className="flex-1 text-left">{option.label}</span>
                {dateFilter === option.value && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Show Isolated Toggle */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 rounded-none",
            !showIsolated && "bg-primary/10 text-primary"
          )}
          onClick={() => {
            onFiltersChange({ ...filters, include_isolated: !showIsolated });
          }}
        >
          <Check
            className={cn("mr-1.5 h-3.5 w-3.5", !showIsolated && "opacity-0")}
          />
          Isolated
        </Button>
      </div>

      {/* Clear button - visible only when non-default */}
      {isNonDefault && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
          onClick={handleClear}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
    </>
  );

  // When inline, skip the outer glass wrapper - parent toolbar provides it
  if (inline) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {filterButtons}
        <div className="ml-auto max-w-xs flex-1">
          <Input
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3",
      glass.base,
      "rounded-none border-t-0 border-l-0 border-r-0"
    )}>
      {filterButtons}
      <div className="ml-auto max-w-md flex-1">
        <Input
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9"
        />
      </div>
    </div>
  );
}
