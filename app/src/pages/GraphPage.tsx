import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { glass, getCommunityColor } from "@/lib/design-tokens";
import { formatDate } from "@/lib/date-utils";
import {
  getGraphData,
  getCommunities,
  type GraphData,
  type GraphNode,
  type GraphFilters as GraphFiltersType,
  type Community,
} from "../lib/api";
import GraphVisualization from "../components/GraphVisualization";
import GraphFilters from "../components/GraphFilters";
import GraphLegend from "../components/GraphLegend";
import GraphInsightsPanel from "../components/GraphInsightsPanel";
import { MemoryDetailPanel } from "../components/MemoryDetailPanel";
import {
  Loader2,
  Palette,
  Brain,
  Link2,
  SearchX,
  AlertCircle,
} from "lucide-react";

type ColorByOption = "none" | "community";

export default function GraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GraphFiltersType>({
    type: "all",
    date_range: "all",
    include_isolated: true,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<number>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [colorBy, setColorBy] = useState<ColorByOption>("none");
  const [communityMap, setCommunityMap] = useState<Record<number, number>>({});
  const [communities, setCommunities] = useState<Community | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Handle focus param from URL
  useEffect(() => {
    const focusParam = searchParams.get("focus");
    if (focusParam && graphData) {
      const focusId = parseInt(focusParam);
      if (!isNaN(focusId)) {
        setSelectedNodeId(focusId);
        setIsPanelOpen(true);
      }
    }
  }, [searchParams, graphData]);

  // Fetch graph data when filters change
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getGraphData(filters);
        setGraphData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load graph data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters]);

  // Fetch communities when community color mode is selected
  useEffect(() => {
    if (graphData && colorBy === "community") {
      const fetchCommunities = async () => {
        try {
          const result: Community = await getCommunities(filters);
          const map: Record<number, number> = {};
          result.communities.forEach((community, idx) => {
            community.forEach((nodeId) => {
              map[nodeId] = idx;
            });
          });
          setCommunityMap(map);
          setCommunities(result);
        } catch (err) {
          console.error("Failed to fetch communities:", err);
        }
      };
      fetchCommunities();
    }
  }, [colorBy, filters, graphData]);

  // Handle search with debouncing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      if (searchQuery && graphData) {
        const highlighted = graphData.nodes
          .filter((n) => n.title.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((n) => n.id);
        setHighlightedNodeIds(new Set(highlighted));
      } else {
        setHighlightedNodeIds(new Set());
      }
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery, graphData]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNodeId(node.id);
    setIsPanelOpen(true);
  };

  const handlePanelClose = () => {
    setIsPanelOpen(false);
    setSelectedNodeId(null);
    searchParams.delete("focus");
    setSearchParams(searchParams);
  };

  const handleDelete = async (id: number) => {
    try {
      const data = await getGraphData(filters);
      setGraphData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh graph");
    }
  };

  const handleMemoryUpdated = async () => {
    try {
      const data = await getGraphData(filters);
      setGraphData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh graph");
    }
  };

  const toggleColorMode = () => {
    setColorBy(prev => prev === "none" ? "community" : "none");
  };

  // Loading state
  if (loading && !graphData) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className={cn("flex flex-col items-center gap-4 rounded-2xl p-8 max-w-xs text-center", glass.overlay)}>
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
          <div>
            <p className="font-heading text-base font-semibold">Loading Graph</p>
            <p className="text-sm text-muted-foreground mt-1">Fetching your knowledge graph...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className={cn("flex flex-col items-center gap-4 rounded-2xl p-8 max-w-xs text-center", glass.overlay)}>
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <p className="font-heading text-base font-semibold">Something went wrong</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasNoMemories = graphData && graphData.total_nodes === 0;
  const hasNoLinks = graphData && graphData.total_nodes > 0 && graphData.total_links === 0;
  const hasNoResults =
    graphData &&
    graphData.nodes.length === 0 &&
    (filters.type !== "all" || filters.date_range !== "all" || !filters.include_isolated);

  // Community colors for legend
  const communityColorsList = colorBy === 'community'
    ? Array.from(new Set(Object.values(communityMap))).map(getCommunityColor)
    : [];

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Compact Toolbar: title + stats + divider + inline filters + controls */}
      <div className={cn(
        "flex-shrink-0 flex items-center gap-3 px-4 h-12",
        glass.base,
        "rounded-none border-t-0 border-l-0 border-r-0"
      )}>
        <h1 className="text-base font-semibold whitespace-nowrap">Knowledge Graph</h1>
        <GraphFilters
          inline
          filters={filters}
          onFiltersChange={setFilters}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        {/* Graph view controls */}
        <div className="flex items-center gap-1 ml-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleColorMode}
            className={cn(
              "h-8 w-8 p-0",
              colorBy === "community" && "bg-primary/10 text-primary"
            )}
            title={colorBy === "none" ? "Color by community" : "Color by type"}
          >
            <Palette className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden min-w-[320px]">
        {/* Main Graph Area */}
        <div className="relative flex-1 min-w-0 h-full">
          {hasNoMemories ? (
            <div className="flex h-full items-center justify-center">
              <div className={cn("flex flex-col items-center gap-3 rounded-2xl p-8 max-w-xs text-center", glass.overlay)}>
                <Brain className="h-12 w-12 text-muted-foreground" />
                <p className="font-heading text-base font-semibold">No memories yet</p>
                <p className="text-sm text-muted-foreground">
                  Create memories to see your knowledge graph
                </p>
              </div>
            </div>
          ) : hasNoLinks ? (
            <div className="flex h-full items-center justify-center">
              <div className={cn("flex flex-col items-center gap-3 rounded-2xl p-8 max-w-xs text-center", glass.overlay)}>
                <Link2 className="h-12 w-12 text-muted-foreground" />
                <p className="font-heading text-base font-semibold">No connections yet</p>
                <p className="text-sm text-muted-foreground">
                  Link related memories to build your graph
                </p>
              </div>
            </div>
          ) : hasNoResults ? (
            <div className="flex h-full items-center justify-center">
              <div className={cn("flex flex-col items-center gap-3 rounded-2xl p-8 max-w-xs text-center", glass.overlay)}>
                <SearchX className="h-12 w-12 text-muted-foreground" />
                <p className="font-heading text-base font-semibold">No results</p>
                <p className="text-sm text-muted-foreground">
                  No memories match your current filters
                </p>
              </div>
            </div>
          ) : (
            graphData && (
              <>
                <GraphVisualization
                  nodes={graphData.nodes}
                  links={graphData.links}
                  selectedNodeId={selectedNodeId}
                  highlightedNodeIds={highlightedNodeIds}
                  onNodeClick={handleNodeClick}
                  colorByMetric={colorBy}
                  communityMap={communityMap}
                />
                <GraphLegend
                  colorMode={colorBy}
                  communityColors={communityColorsList}
                  communityLabels={communities?.community_labels}
                />
                {/* AI Link Suggestions - floating overlay */}
                <GraphInsightsPanel
                  filters={filters}
                  nodes={graphData.nodes}
                  onRefreshGraph={() => {
                    const fetchData = async () => {
                      setLoading(true);
                      try {
                        const data = await getGraphData(filters);
                        setGraphData(data);
                      } finally {
                        setLoading(false);
                      }
                    };
                    fetchData();
                  }}
                />
              </>
            )
          )}
        </div>
      </div>

      {selectedNodeId && (
        <MemoryDetailPanel
          memoryId={selectedNodeId}
          isOpen={isPanelOpen}
          onClose={handlePanelClose}
          onDelete={handleDelete}
          onMemoryUpdated={handleMemoryUpdated}
          allTags={[]}
          formatDate={formatDate}
        />
      )}
    </div>
  );
}
