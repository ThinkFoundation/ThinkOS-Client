import * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Sparkles,
  AlertCircle,
  Loader2,
  ArrowRight,
  Plus,
} from "lucide-react";
import type { GraphFilters, GraphNode } from "../lib/api";
import {
  getLinkRecommendations,
  createLink,
  ApiError,
  type LinkRecommendation,
} from "../lib/api";
import { glass, getMemoryTypeColor } from "@/lib/design-tokens";

const MIN_CONFIDENCE = 0.7; // Fixed threshold

interface GraphInsightsPanelProps {
  filters: GraphFilters;
  nodes: GraphNode[];
  onRefreshGraph?: () => void;
}

export default function GraphInsightsPanel({
  filters,
  nodes,
  onRefreshGraph,
}: GraphInsightsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [recommendations, setRecommendations] = React.useState<LinkRecommendation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creatingLinkId, setCreatingLinkId] = React.useState<string | null>(null);

  // Build node map for quick lookups
  const nodeMap = React.useMemo(() => {
    return new Map(nodes.map(node => [node.id, node]));
  }, [nodes]);

  // Fetch insights data
  const fetchInsights = React.useCallback(async () => {
    setError(null);
    try {
      const recs = await getLinkRecommendations(20, MIN_CONFIDENCE, filters);
      setRecommendations(recs);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load insights");
      setLoading(false);
    }
  }, [filters]);

  React.useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleCreateLink = async (rec: LinkRecommendation) => {
    const linkId = `${rec.source_id}-${rec.target_id}`;
    setCreatingLinkId(linkId);

    try {
      // Backend creates bidirectional links automatically
      await createLink(rec.source_id, rec.target_id, "auto", rec.confidence);

      toast.success("Link created", {
        description: `Connected "${rec.source_title}" and "${rec.target_title}"`,
      });

      // Refresh graph and recommendations
      onRefreshGraph?.();
      await fetchInsights();
    } catch (err) {
      // 409 Conflict indicates link already exists
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Link already exists", {
          description: "This connection has already been created",
        });
      } else {
        toast.error("Failed to create link", {
          description: err instanceof Error ? err.message : "An error occurred",
        });
      }
    } finally {
      setCreatingLinkId(null);
    }
  };

  return (
    <div className="absolute bottom-4 left-4">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200",
            glass.overlay,
            "hover:bg-white/50 dark:hover:bg-white/[0.05]"
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Link Suggestions
          {!loading && recommendations.length > 0 && (
            <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-full text-[10px]">
              {recommendations.length}
            </span>
          )}
        </button>
      ) : (
        <div
          className={cn(
            "rounded-2xl p-3 text-xs w-[320px] animate-fade-in-up",
            glass.overlay
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-semibold text-xs">AI Link Suggestions</span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
            >
              &times;
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-muted-foreground">Finding suggestions...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="text-muted-foreground text-center">{error}</p>
              <Button onClick={fetchInsights} variant="outline" size="sm" className="h-7 text-xs">
                Retry
              </Button>
            </div>
          ) : recommendations.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              No suggestions found
            </div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1">
              {recommendations.map((rec) => {
                const key = `${rec.source_id}-${rec.target_id}`;
                const isCreating = creatingLinkId === key;
                const confidencePercent = Math.round(rec.confidence * 100);

                // Get node colors for preview
                const sourceNode = nodeMap.get(rec.source_id);
                const targetNode = nodeMap.get(rec.target_id);
                const sourceColor = sourceNode ? getMemoryTypeColor(sourceNode.type).hex : '#94a3b8';
                const targetColor = targetNode ? getMemoryTypeColor(targetNode.type).hex : '#94a3b8';

                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-lg p-2.5 transition-colors",
                      "bg-white/30 dark:bg-white/[0.03]",
                      "hover:bg-white/50 dark:hover:bg-white/[0.06]"
                    )}
                  >
                    {/* Compact preview layout */}
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: sourceColor }}
                      />
                      <span className="text-[11px] truncate flex-1 max-w-[90px]">{rec.source_title}</span>
                      <ArrowRight className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                      <div
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: targetColor }}
                      />
                      <span className="text-[11px] truncate flex-1 max-w-[90px]">{rec.target_title}</span>
                    </div>

                    {/* Confidence bar + button */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/20 dark:bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full bg-primary/80 rounded-full"
                          style={{ width: `${confidencePercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-7 text-right">
                        {confidencePercent}%
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-[10px]"
                        disabled={isCreating}
                        onClick={() => handleCreateLink(rec)}
                      >
                        {isCreating ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-3 w-3 mr-0.5" />
                            Link
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
