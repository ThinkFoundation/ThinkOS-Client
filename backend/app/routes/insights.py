"""Insights API endpoints for intelligent knowledge discovery."""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, HTTPException, Body
from pydantic import BaseModel, Field

# Maximum number of links that can be created in a single batch request.
# Limits memory usage and prevents timeout issues with large batches.
MAX_BATCH_LINK_COUNT = 50

from ..db.crud.insights import get_embeddings_for_nodes, get_link_creation_timeline
from ..db.crud.links import batch_create_links
from ..services.cache import get_cached_graph_data, invalidate_analytics_cache
from ..services.graph import GraphAnalytics
from ..services.graph.insights import GraphInsights


router = APIRouter(prefix="/api/insights", tags=["insights"])


# Response models
class LinkRecommendation(BaseModel):
    """Smart link recommendation with explanation."""
    source_id: int
    target_id: int
    source_title: str
    target_title: str
    confidence: float = Field(description="Confidence score 0-1 (higher = better match)", ge=0.0, le=1.0)
    semantic_score: float = Field(description="Embedding similarity 0-1")
    structural_score: float = Field(description="Graph structure score 0-1")
    reason: str = Field(description="Why this connection is recommended")
    impact: str = Field(description="How this link improves the graph")


class HealthMetrics(BaseModel):
    """Individual health metric scores."""
    connectivity: float = Field(description="Connectivity score 0-100")
    balance: float = Field(description="Type distribution balance 0-100")
    coverage: float = Field(description="Non-isolated nodes coverage 0-100")


class GrowthMetrics(BaseModel):
    """Graph growth statistics."""
    links_last_week: int
    links_last_month: int
    trend: str = Field(description="Growth trend: increasing, stable, or decreasing")


class HealthResponse(BaseModel):
    """Knowledge graph health dashboard."""
    health_score: float = Field(description="Overall health score 0-100", ge=0.0, le=100.0)
    metrics: HealthMetrics
    growth: GrowthMetrics
    issues: List[str] = Field(description="Detected issues")
    recommendations: List[str] = Field(description="Improvement suggestions")


class AutoLinkRequest(BaseModel):
    """Request body for batch link creation."""
    source_id: int
    target_id: int
    confidence: float


class BatchAutoLinkRequest(BaseModel):
    """Request body for batch link creation."""
    links: List[AutoLinkRequest]


class AutoLinkResponse(BaseModel):
    """Response for batch link creation."""
    created: int = Field(description="Number of successfully created link pairs")
    failed: int = Field(description="Number of failed link pairs")
    errors: List[str] = Field(description="Error messages")


# Helper function to create insights instance
async def _get_insights(
    memory_type: Optional[str] = None,
    date_range: Optional[str] = None,
    include_isolated: bool = True,
) -> GraphInsights:
    """Create GraphInsights instance from filtered graph data with embeddings."""
    # Get cached graph data
    graph_data = await get_cached_graph_data(
        memory_type=memory_type,
        date_range=date_range,
        include_isolated=include_isolated,
    )
    
    # Get embeddings for all nodes
    node_ids = [node["id"] for node in graph_data["nodes"]]
    embeddings_map = await get_embeddings_for_nodes(node_ids) if node_ids else {}
    
    # Create analytics instance
    analytics = GraphAnalytics(
        nodes=graph_data["nodes"],
        links=graph_data["links"],
    )
    
    # Create insights instance
    return GraphInsights(
        analytics=analytics,
        embeddings_map=embeddings_map
    )


@router.get("/recommendations", response_model=List[LinkRecommendation])
async def get_link_recommendations(
    limit: int = Query(20, ge=1, le=100, description="Maximum number of recommendations"),
    min_confidence: float = Query(0.6, ge=0.0, le=1.0, description="Minimum confidence threshold"),
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Get smart link recommendations combining semantic similarity and graph structure.

    Returns prioritized list of potential connections with explanations.
    Uses 50% semantic score + 50% structural score for balanced ranking.
    """
    insights = await _get_insights(memory_type, date_range, include_isolated)
    recommendations = insights.generate_smart_recommendations(
        limit=limit,
        min_confidence=min_confidence
    )
    
    return [LinkRecommendation(**rec) for rec in recommendations]


@router.get("/health", response_model=HealthResponse)
async def get_knowledge_health(
    memory_type: Optional[str] = Query(None, description="Filter by memory type"),
    date_range: Optional[str] = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include isolated nodes"),
):
    """
    Get knowledge graph health dashboard.
    
    Returns overall health score (0-100) based on:
    - Connectivity: Graph density and component count
    - Balance: Distribution across memory types
    - Coverage: Percentage of non-isolated nodes
    
    Also includes growth metrics and actionable recommendations.
    """
    insights = await _get_insights(memory_type, date_range, include_isolated)
    
    # Get link creation timeline for growth metrics
    timeline = await get_link_creation_timeline(days=30)
    
    # Compute health
    health = insights.compute_knowledge_health(link_timeline=timeline)
    
    return HealthResponse(
        health_score=health["health_score"],
        metrics=HealthMetrics(**health["metrics"]),
        growth=GrowthMetrics(**health["growth"]),
        issues=health["issues"],
        recommendations=health["recommendations"]
    )


@router.post("/auto-link", response_model=AutoLinkResponse)
async def create_auto_links(
    request: BatchAutoLinkRequest
):
    """
    Batch create multiple links from recommendations.

    Creates bidirectional links (both directions) with link_type="auto".
    Validates that both nodes exist before creating links.
    Returns count of successfully created links and any errors.

    Note: This invalidates the analytics cache.
    """
    if not request.links:
        raise HTTPException(status_code=400, detail="No links provided")

    if len(request.links) > MAX_BATCH_LINK_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Too many links (max {MAX_BATCH_LINK_COUNT} per request)"
        )

    # Extract link pairs
    link_pairs = [
        (link.source_id, link.target_id, link.confidence)
        for link in request.links
    ]

    # Create links in batch
    result = await batch_create_links(link_pairs)

    # Invalidate analytics cache since graph structure changed
    if result["created"] > 0:
        invalidate_analytics_cache()

    return AutoLinkResponse(**result)
