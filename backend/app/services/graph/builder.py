"""NetworkX graph builder for converting database graph data."""

from typing import List
import networkx as nx


def build_networkx_graph(nodes: List[dict], links: List[dict], directed: bool = False) -> nx.Graph:
    """
    Build a NetworkX graph from database nodes and links.

    Args:
        nodes: List of node dictionaries with id, title, type, summary, etc.
        links: List of link dictionaries with source, target, link_type, relevance_score, etc.
        directed: Whether to create a directed graph (default: False for undirected)

    Returns:
        NetworkX Graph or DiGraph instance with nodes and edges
    """
    # Create appropriate graph type
    G = nx.DiGraph() if directed else nx.Graph()

    # Add nodes with their attributes
    for node in nodes:
        node_id = node["id"]
        G.add_node(
            node_id,
            title=node.get("title", ""),
            type=node.get("type", ""),
            summary=node.get("summary", ""),
            created_at=node.get("created_at", ""),
            # Store all other attributes
            **{k: v for k, v in node.items() if k not in ["id", "title", "type", "summary", "created_at"]}
        )

    # Add edges with their attributes
    for link in links:
        source = link["source"]
        target = link["target"]

        # Only add edge if both nodes exist
        if source in G and target in G:
            G.add_edge(
                source,
                target,
                link_type=link.get("link_type", "manual"),
                relevance_score=link.get("relevance_score"),
                reason=link.get("reason", ""),
                created_at=link.get("created_at", ""),
                # Store all other attributes
                **{k: v for k, v in link.items() if k not in ["source", "target", "link_type", "relevance_score", "reason", "created_at"]}
            )

    return G
