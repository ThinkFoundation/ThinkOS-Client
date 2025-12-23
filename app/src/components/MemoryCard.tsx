import { Button } from "@/components/ui/button";
import {
  Globe,
  FileText,
  X,
  Link as LinkIcon,
  PanelRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MemoryTag {
  id: number;
  name: string;
  source: "ai" | "manual";
}

interface Memory {
  id: number;
  type: "web" | "note";
  url: string | null;
  title: string;
  summary: string | null;
  tags: MemoryTag[];
  created_at: string;
}

interface MemoryCardProps {
  memory: Memory;
  onRemoveTag: (memoryId: number, tagId: number) => void;
  onExpand: (id: number) => void;
  formatDate: (date: string) => string;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function DomainBadge({ url }: { url: string }) {
  const domain = extractDomain(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full",
        "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300",
        "hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-white/15 dark:hover:text-slate-200",
        "transition-colors"
      )}
      title={url}
    >
      <LinkIcon className="h-3 w-3" />
      {domain}
    </a>
  );
}

export function MemoryCard({
  memory,
  onRemoveTag,
  onExpand,
  formatDate,
}: MemoryCardProps) {
  return (
    <div
      className={cn(
        "group relative p-5 rounded-2xl",
        // Glassmorphism - light mode
        "bg-white/70 dark:bg-white/5 backdrop-blur-md",
        "border border-white/60 dark:border-white/10",
        "shadow-sm shadow-black/5 dark:shadow-black/20",
        // Hover lift effect
        "hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30",
        "hover:scale-[1.01] hover:-translate-y-0.5",
        "transition-all duration-200"
      )}
    >
      {/* Hover actions - top right */}
      <div
        className={cn(
          "absolute top-3 right-3 flex gap-0.5",
          "opacity-0 group-hover:opacity-100",
          "transition-opacity duration-200"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onExpand(memory.id)}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="View Details"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Header: Type icon + Title */}
      <div className="flex items-start gap-2.5 mb-3 pr-14">
        <div className="mt-0.5">
          {memory.type === "web" ? (
            <Globe className="h-4 w-4 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 text-amber-600" />
          )}
        </div>
        <h3 className="font-medium text-[15px] leading-snug">
          {memory.title || "Untitled"}
        </h3>
      </div>

      {/* Summary - full text, no clamp for masonry effect */}
      {memory.summary ? (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {memory.summary}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground/50 italic mb-4">
          Generating summary...
        </p>
      )}

      {/* Bottom row: Domain badge + Tags */}
      {(memory.url || memory.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {memory.url && <DomainBadge url={memory.url} />}
          {memory.tags.map((tag) => (
            <span
              key={tag.id}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full",
                "transition-colors",
                tag.source === "ai"
                  ? "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
                  : "bg-primary/10 text-primary"
              )}
            >
              {tag.name}
              {tag.source === "manual" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTag(memory.id, tag.id);
                  }}
                  className="hover:text-primary/70 -mr-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Date - subtle */}
      <p className="text-[11px] text-muted-foreground/70">
        {formatDate(memory.created_at)}
      </p>
    </div>
  );
}
