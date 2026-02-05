import { useState, useEffect } from "react";
import { GraphCanvas, GraphNode as ReagraphNode, GraphEdge, darkTheme, lightTheme } from "reagraph";
import { type GraphNode, type GraphLink } from "../lib/api";
import { getMemoryTypeColor, getCommunityColor, communityColors, memoryTypeColors } from "@/lib/design-tokens";

// Edge and highlight colors from design tokens
const HIGHLIGHT_COLOR = communityColors[9]; // amber-300 (#fbbf24)
const MANUAL_LINK_COLOR = memoryTypeColors.audio.hex; // blue-500 (#3b82f6)
const AI_LINK_COLOR = "#64748b"; // slate-500 (fallback color from getMemoryTypeColor)

interface GraphVisualizationProps {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedNodeId?: number | null;
  highlightedNodeIds?: Set<number>;
  onNodeClick: (node: GraphNode) => void;
  colorByMetric?: "none" | "community";
  communityMap?: Record<number, number>;
}

export default function GraphVisualization({
  nodes,
  links,
  selectedNodeId,
  highlightedNodeIds = new Set(),
  onNodeClick,
  colorByMetric = "none",
  communityMap = {},
}: GraphVisualizationProps) {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Custom themes with white hover highlight
  const customDarkTheme = {
    ...darkTheme,
    node: {
      ...darkTheme.node,
      activeFill: "#ffffff",
      label: { ...darkTheme.node.label, activeColor: "#ffffff" },
    },
  };
  const customLightTheme = {
    ...lightTheme,
    node: {
      ...lightTheme.node,
      activeFill: "#ffffff",
      label: { ...lightTheme.node.label, activeColor: "#ffffff" },
    },
  };


  // Count connections from links (both directions)
  const connectionCounts = new Map<number, number>();
  links.forEach((link) => {
    connectionCounts.set(link.source, (connectionCounts.get(link.source) ?? 0) + 1);
    connectionCounts.set(link.target, (connectionCounts.get(link.target) ?? 0) + 1);
  });

  const getNodeColor = (node: GraphNode): string => {
    // Highlight color takes priority
    if (highlightedNodeIds.has(node.id)) {
      return HIGHLIGHT_COLOR;
    }

    // Community coloring mode
    if (colorByMetric === "community" && communityMap[node.id] !== undefined) {
      return getCommunityColor(communityMap[node.id]);
    }

    // Default type-based coloring
    return getMemoryTypeColor(node.type).hex;
  };

  const getNodeSize = (nodeId: number): number => {
    const count = connectionCounts.get(nodeId) ?? 0;
    // Log scale so highly-connected nodes grow noticeably but don't become blobs
    return Math.max(3, Math.min(12, 3 + Math.log2(count + 1) * 2.5));
  };

  // Convert nodes to Reagraph format
  const graphNodes: ReagraphNode[] = nodes.map((node) => ({
    id: String(node.id),
    label: node.title,
    fill: getNodeColor(node),
    data: { size: getNodeSize(node.id) },
    labelVisible: true,
  }));

  // Convert links to Reagraph format
  const graphEdges: GraphEdge[] = links.map((link) => ({
    id: `${link.source}-${link.target}`,
    source: String(link.source),
    target: String(link.target),
    size: link.relevance_score ? 0.5 + link.relevance_score * 1 : 0.5,
    fill: link.link_type === "manual" ? MANUAL_LINK_COLOR : AI_LINK_COLOR,
  }));

  const handleNodeClick = (node: ReagraphNode) => {
    const originalNode = nodes.find((n) => n.id === Number(node.id));
    if (originalNode) {
      onNodeClick(originalNode);
    }
  };

  return (
    <div className="h-full w-full">
      <GraphCanvas
        nodes={graphNodes}
        edges={graphEdges}
        layoutType="forceDirected2d"
        draggable
        onNodeClick={handleNodeClick}
        theme={isDark ? customDarkTheme : customLightTheme}
        labelType="all"
        sizingType="attribute"
        sizingAttribute="size"
        minNodeSize={3}
        maxNodeSize={12}
        edgeArrowPosition="none"
        contextMenu={() => null}
      />
    </div>
  );
}
