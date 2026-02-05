"""Analytics API endpoints for graph metrics and insights."""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field

from ..services.cache import get_cached_graph_data
from ..services.graph import GraphAnalytics, GraphInsights

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# Response models
class CentralityMetricsResponse(BaseModel):
    """All centrality metrics for all nodes."""
    degree: Dict[int, float] = Field(description="Degree centrality scores")
    betweenness: Dict[int, float] = Field(description="Betweenness centrality scores")
    closeness: Dict[int, float] = Field(description="Closeness centrality scores")
    eigenvector: Dict[int, float] = Field(description="Eigenvector centrality scores")


class TopNodeResponse(BaseModel):
    """Single top node with score."""
    node_id: int
    score: float
    title: str
    type: str


class CommunityResponse(BaseModel):
    """Community detection results."""
    communities: List[List[int]] = Field(description="List of communities (each is a list of node IDs)")
    modularity: float = Field(description="Modularity score (quality of partition)")
    num_communities: int = Field(description="Number of communities detected")
    community_labels: Optional[List[str]] = Field(None, description="Topic labels for each community")


class GraphStatisticsResponse(BaseModel):
    """Graph-level statistics."""
    num_nodes: int
    num_edges: int
    num_components: int
    density: float
    average_degree: float
    diameter: Optional[int]
    clustering_coefficient: float
    type_distribution: Dict[str, int]
    link_type_distribution: Dict[str, int]


class PathResponse(BaseModel):
    """Path between two nodes."""
    path: List[int] = Field(description="List of node IDs in path")
    length: int = Field(description="Number of edges in path")
    exists: bool = Field(description="Whether path exists")
    node_titles: List[str] = Field(description="List of node titles in path")


# Helper function to create analytics instance
async def _get_analytics(
    memory_type: Optional[str] = None,
    date_range: Optional[str] = None,
    include_isolated: bool = True,
) -> GraphAnalytics:
    """Create GraphAnalytics instance from filtered graph data."""
    graph_data = await get_cached_graph_data(
        memory_type=memory_type,
        date_range=date_range,
        include_isolated=include_isolated,
    )
    return GraphAnalytics(
        nodes=graph_data["nodes"],
        links=graph_data["links"],
    )


@router.get("/centrality", response_model=CentralityMetricsResponse)
async def get_centrality_metrics(
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range (today, week, month)"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Get all centrality metrics for all nodes.

    Returns degree, betweenness, closeness, and eigenvector centrality scores.
    """
    analytics = await _get_analytics(memory_type, date_range, include_isolated)
    metrics = analytics.get_centrality_metrics()
    return CentralityMetricsResponse(**metrics)


@router.get("/top-nodes", response_model=List[TopNodeResponse])
async def get_top_nodes(
    metric: str = Query("degree", description="Centrality metric (degree, betweenness, closeness, eigenvector)"),
    limit: int = Query(10, ge=1, le=100, description="Number of top nodes to return"),
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Get top N nodes ranked by centrality metric.

    Returns nodes with highest scores for the specified metric.
    """
    valid_metrics = {"degree", "betweenness", "closeness", "eigenvector"}
    if metric not in valid_metrics:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid metric. Must be one of: {', '.join(valid_metrics)}"
        )

    analytics = await _get_analytics(memory_type, date_range, include_isolated)
    top_nodes = analytics.get_top_nodes(metric=metric, limit=limit)

    # Enrich with node details
    node_map = {node["id"]: node for node in analytics.nodes}
    response = []
    for node_id, score in top_nodes:
        node_data = node_map.get(node_id, {})
        response.append(TopNodeResponse(
            node_id=node_id,
            score=round(score, 4),
            title=node_data.get("title", "Unknown"),
            type=node_data.get("type", "unknown"),
        ))

    return response


@router.get("/communities", response_model=CommunityResponse)
async def get_communities(
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Detect communities using Louvain/greedy modularity algorithm.

    Returns community assignments, modularity score, and topic labels.
    """
    analytics = await _get_analytics(memory_type, date_range, include_isolated)
    communities = analytics.get_communities()

    # Generate topic labels using insights service
    try:
        insights = GraphInsights(analytics)
        community_labels = []
        for community in communities["communities"]:
            label = insights.extract_community_topics(
                community,
                communities["communities"]
            )
            community_labels.append(label)
        communities["community_labels"] = community_labels
    except Exception as e:
        # If topic extraction fails, continue without labels
        logger.warning(f"Failed to extract community topics: {e}")
        communities["community_labels"] = None

    return CommunityResponse(**communities)


@router.get("/statistics", response_model=GraphStatisticsResponse)
async def get_statistics(
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Get graph-level statistics.

    Returns density, clustering coefficient, diameter, type distributions, etc.
    """
    analytics = await _get_analytics(memory_type, date_range, include_isolated)
    stats = analytics.get_statistics()
    return GraphStatisticsResponse(**stats)


@router.get("/path")
async def find_path(
    source: int = Query(..., description="Source node ID"),
    target: int = Query(..., description="Target node ID"),
    all_paths: bool = Query(False, description="Return all shortest paths (not just one)"),
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Find shortest path(s) between two nodes.

    Returns path as list of node IDs, length, and node titles.
    Set all_paths=true to get all shortest paths instead of just one.
    """
    analytics = await _get_analytics(memory_type, date_range, include_isolated)
    result = analytics.find_path(source=source, target=target, all_paths=all_paths)

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"One or both nodes not found: source={source}, target={target}"
        )

    return result
