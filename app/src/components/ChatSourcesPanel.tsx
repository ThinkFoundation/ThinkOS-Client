import { useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronRight, ExternalLink, FileText } from "lucide-react";
import type { SourceMemory } from "@/types/chat";

interface ChatSourcesPanelProps {
  sources: SourceMemory[];
}

export function ChatSourcesPanel({ sources }: ChatSourcesPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="flex-none border-t px-4 py-3">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
          />
          <BookOpen className="h-3.5 w-3.5" />
          <span>Sources ({sources.length})</span>
        </button>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-wrap gap-2 pt-2">
              {sources.map((source) =>
                source.url ? (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-background rounded-md border hover:bg-accent transition-colors group"
                  >
                    <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className="truncate max-w-[200px]">{source.title}</span>
                  </a>
                ) : (
                  <Link
                    key={source.id}
                    to={`/memories?open=${source.id}`}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-background rounded-md border hover:bg-accent transition-colors group"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className="truncate max-w-[200px]">{source.title}</span>
                  </Link>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
