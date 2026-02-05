"""Graph visualization API routes."""

import logging
from typing import List, Optional

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field

from ..db.crud.graph import get_graph_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/graph", tags=["graph"])


# Response models
class NodeData(BaseModel):
    """Graph node representing a memory."""
    id: int
    title: str
    type: str
    summary: Optional[str] = None
    created_at: Optional[str] = None
    connection_count: int


class LinkData(BaseModel):
    """Graph edge representing a connection between memories."""
    source: int
    target: int
    link_type: str
    relevance_score: Optional[float] = None
    created_at: Optional[str] = None


class GraphDataResponse(BaseModel):
    """Complete graph data for visualization."""
    nodes: List[NodeData] = Field(description="Graph nodes")
    links: List[LinkData] = Field(description="Graph edges")
    total_nodes: int = Field(description="Total node count")
    total_links: int = Field(description="Total link count")


@router.get("/data", response_model=GraphDataResponse)
async def get_graph_data_endpoint(
    memory_type: str | None = Query(None, description="Filter by memory type"),
    date_range: str | None = Query(None, description="Filter by date range"),
    include_isolated: bool = Query(True, description="Include nodes with no connections"),
    limit: int | None = Query(None, ge=1, le=1000, description="Maximum nodes to return")
):
    """
    Get graph structure for visualization.

    Returns memories as nodes and their connections as edges,
    optimized for graph visualization rendering.
    """
    try:
        data = await get_graph_data(
            memory_type=memory_type,
            date_range=date_range,
            include_isolated=include_isolated,
            limit=limit
        )
        return data
    except Exception as e:
        logger.error(f"Error fetching graph data: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch graph data")
