"""Graph analytics service with NetworkX algorithms."""

import logging
from typing import List, Dict, Tuple, Optional, Any
import networkx as nx
from .builder import build_networkx_graph

logger = logging.getLogger(__name__)


class GraphAnalytics:
    """
    Main analytics class with lazy computation and caching.

    Computes graph metrics on-demand using NetworkX algorithms.
    """

    def __init__(self, nodes: List[dict], links: List[dict], directed: bool = False):
        """
        Initialize analytics with graph data.

        Args:
            nodes: List of node dictionaries
            links: List of link dictionaries
            directed: Whether graph is directed
        """
        self.nodes = nodes
        self.links = links
        self.directed = directed
        self._graph: Optional[nx.Graph] = None
        self._centrality_cache: Dict[str, Dict[int, float]] = {}
        self._communities_cache: Optional[List[set]] = None
        self._statistics_cache: Optional[Dict[str, Any]] = None

    @property
    def graph(self) -> nx.Graph:
        """Lazy-load the NetworkX graph."""
        if self._graph is None:
            self._graph = build_networkx_graph(self.nodes, self.links, self.directed)
        return self._graph

    def get_centrality_metrics(self) -> Dict[str, Dict[int, float]]:
        """
        Compute all centrality metrics.

        Returns:
            Dictionary with keys: degree, betweenness, closeness, eigenvector
            Each value is a dict mapping node_id -> score
        """
        metrics = {}

        # Degree centrality (always computable)
        if "degree" not in self._centrality_cache:
            self._centrality_cache["degree"] = nx.degree_centrality(self.graph)
        metrics["degree"] = self._centrality_cache["degree"]

        # Betweenness centrality
        if "betweenness" not in self._centrality_cache:
            self._centrality_cache["betweenness"] = nx.betweenness_centrality(self.graph)
        metrics["betweenness"] = self._centrality_cache["betweenness"]

        # Closeness centrality (requires connected graph for meaningful results)
        if "closeness" not in self._centrality_cache:
            try:
                self._centrality_cache["closeness"] = nx.closeness_centrality(self.graph)
            except Exception:
                # For disconnected graphs, compute per component
                self._centrality_cache["closeness"] = {}
                for component in nx.connected_components(self.graph):
                    if len(component) > 1:
                        subgraph = self.graph.subgraph(component)
                        closeness = nx.closeness_centrality(subgraph)
                        self._centrality_cache["closeness"].update(closeness)
        metrics["closeness"] = self._centrality_cache["closeness"]

        # Eigenvector centrality (may not converge for all graphs)
        if "eigenvector" not in self._centrality_cache:
            try:
                self._centrality_cache["eigenvector"] = nx.eigenvector_centrality(
                    self.graph, max_iter=100
                )
            except (nx.PowerIterationFailedConvergence, nx.NetworkXError):
                # Fallback to degree centrality if eigenvector fails
                logger.warning(
                    "Eigenvector centrality failed to converge, falling back to degree centrality"
                )
                self._centrality_cache["eigenvector"] = self._centrality_cache["degree"].copy()
        metrics["eigenvector"] = self._centrality_cache["eigenvector"]

        return metrics

    def get_communities(self) -> Dict[str, Any]:
        """
        Detect communities using greedy modularity optimization.

        Returns:
            Dictionary with:
                - communities: List of lists (each inner list is node IDs in a community)
                - modularity: Modularity score (quality of partition)
                - num_communities: Number of communities detected
        """
        if self._communities_cache is None:
            # Use greedy modularity communities (fast and effective)
            self._communities_cache = list(
                nx.community.greedy_modularity_communities(self.graph)
            )

        # Convert sets to lists and calculate modularity
        communities_list = [list(community) for community in self._communities_cache]
        modularity = nx.community.modularity(self.graph, self._communities_cache)

        return {
            "communities": communities_list,
            "modularity": round(modularity, 4),
            "num_communities": len(communities_list),
        }

    def get_statistics(self) -> Dict[str, Any]:
        """
        Compute graph-level statistics.

        Returns:
            Dictionary with various graph metrics
        """
        if self._statistics_cache is not None:
            return self._statistics_cache

        G = self.graph
        num_nodes = G.number_of_nodes()
        num_edges = G.number_of_edges()

        # Basic stats
        stats = {
            "num_nodes": num_nodes,
            "num_edges": num_edges,
            "num_components": nx.number_connected_components(G),
        }

        # Density (0 = no edges, 1 = fully connected)
        stats["density"] = round(nx.density(G), 4) if num_nodes > 0 else 0.0

        # Average degree
        if num_nodes > 0:
            total_degree = sum(dict(G.degree()).values())
            stats["average_degree"] = round(total_degree / num_nodes, 2)
        else:
            stats["average_degree"] = 0.0

        # Diameter (only for connected graphs)
        stats["diameter"] = None
        if nx.is_connected(G):
            try:
                stats["diameter"] = nx.diameter(G)
            except Exception:
                pass

        # Clustering coefficient
        try:
            stats["clustering_coefficient"] = round(nx.average_clustering(G), 4)
        except Exception:
            stats["clustering_coefficient"] = 0.0

        # Type distribution (count nodes by type)
        type_dist: Dict[str, int] = {}
        for node_data in self.nodes:
            node_type = node_data.get("type", "unknown")
            type_dist[node_type] = type_dist.get(node_type, 0) + 1
        stats["type_distribution"] = type_dist

        # Link type distribution (count edges by link_type)
        link_type_dist: Dict[str, int] = {}
        for link_data in self.links:
            link_type = link_data.get("link_type", "manual")
            link_type_dist[link_type] = link_type_dist.get(link_type, 0) + 1
        stats["link_type_distribution"] = link_type_dist

        self._statistics_cache = stats
        return stats

    def find_path(
        self, source: int, target: int, all_paths: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Find shortest path(s) between two nodes.

        Args:
            source: Source node ID
            target: Target node ID
            all_paths: If True, return all shortest paths; if False, return one

        Returns:
            Dictionary with:
                - path: List of node IDs in path (or list of paths if all_paths=True)
                - length: Number of hops
                - exists: Whether path exists
                - node_titles: List of node titles in path
            Returns None if either node doesn't exist
        """
        G = self.graph

        # Validate nodes exist
        if source not in G or target not in G:
            return None

        # Check if path exists
        try:
            if not nx.has_path(G, source, target):
                return {
                    "path": [],
                    "length": 0,
                    "exists": False,
                    "node_titles": [],
                }
        except nx.NodeNotFound:
            return None

        # Find path(s)
        if all_paths:
            # Find all shortest paths
            paths = list(nx.all_shortest_paths(G, source, target))
            results = []
            for path in paths:
                node_titles = [G.nodes[node_id].get("title", f"Node {node_id}") for node_id in path]
                results.append({
                    "path": path,
                    "length": len(path) - 1,  # Number of edges
                    "exists": True,
                    "node_titles": node_titles,
                })
            return results
        else:
            # Find single shortest path
            path = nx.shortest_path(G, source, target)
            node_titles = [G.nodes[node_id].get("title", f"Node {node_id}") for node_id in path]
            return {
                "path": path,
                "length": len(path) - 1,
                "exists": True,
                "node_titles": node_titles,
            }

    def get_top_nodes(
        self, metric: str = "degree", limit: int = 10
    ) -> List[Tuple[int, float]]:
        """
        Get top N nodes by centrality metric.

        Args:
            metric: One of "degree", "betweenness", "closeness", "eigenvector"
            limit: Number of top nodes to return

        Returns:
            List of (node_id, score) tuples, sorted by score descending
        """
        metrics = self.get_centrality_metrics()

        if metric not in metrics:
            raise ValueError(f"Unknown metric: {metric}")

        # Sort by score descending and take top N
        sorted_nodes = sorted(
            metrics[metric].items(), key=lambda x: x[1], reverse=True
        )
        return sorted_nodes[:limit]
