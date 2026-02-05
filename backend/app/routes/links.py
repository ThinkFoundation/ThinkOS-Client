"""API routes for memory links (knowledge graph)."""

import logging
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..db.crud.links import create_link, delete_link, get_memory_links
from ..services.cache import invalidate_analytics_cache
from ..services.links.suggestions import get_link_suggestions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memories", tags=["links"])


class CreateLinkRequest(BaseModel):
    """Request body for creating a memory link."""
    target_memory_id: int = Field(..., description="Target memory ID to link to")
    link_type: str = Field(default="manual", description="Link type: 'manual' or 'auto'")
    relevance_score: float | None = Field(default=None, description="AI confidence score (0.0-1.0) for auto links")


class LinkResponse(BaseModel):
    """Response model for a memory link."""
    id: int
    source_memory_id: int
    target_memory_id: int
    link_type: str
    relevance_score: float | None
    created_at: str


class MemoryLinkDetail(BaseModel):
    """Detailed link information with connected memory details."""
    id: int
    memory_id: int
    title: str | None
    type: str
    link_type: str
    relevance_score: float | None
    created_at: str


@router.post("/{memory_id}/links", response_model=LinkResponse)
async def create_memory_link(memory_id: int, request: CreateLinkRequest):
    """Create a bidirectional link between two memories.

    Creates links in both directions (A→B and B→A) for efficient querying.

    Args:
        memory_id: Source memory ID
        request: Link creation request with target_memory_id

    Returns:
        Created link details

    Raises:
        400: Self-link or invalid relevance score
        404: Memory not found
        409: Link already exists
    """
    try:
        link = await create_link(
            source_id=memory_id,
            target_id=request.target_memory_id,
            link_type=request.link_type,
            relevance_score=request.relevance_score,
        )
        # Invalidate analytics cache since graph structure changed
        try:
            invalidate_analytics_cache()
        except Exception:
            pass  # Cache invalidation failure shouldn't break link operations
        return link
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating link: {e}")
        raise HTTPException(status_code=500, detail="Failed to create link")


@router.delete("/{memory_id}/links/{target_id}")
async def delete_memory_link(memory_id: int, target_id: int):
    """Delete a bidirectional link between two memories.

    Removes links in both directions (A→B and B→A).

    Args:
        memory_id: Source memory ID
        target_id: Target memory ID

    Returns:
        Success status

    Raises:
        404: Link not found
    """
    try:
        await delete_link(source_id=memory_id, target_id=target_id)
        # Invalidate analytics cache since graph structure changed
        try:
            invalidate_analytics_cache()
        except Exception:
            pass  # Cache invalidation failure shouldn't break link operations
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting link: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete link")


@router.get("/{memory_id}/links", response_model=list[MemoryLinkDetail])
async def get_links_for_memory(memory_id: int):
    """Get all links for a memory.

    Returns a unified view of connections (bidirectional links shown as single connections).

    Args:
        memory_id: Memory ID to get links for

    Returns:
        List of connected memories with link details
    """
    try:
        links = await get_memory_links(memory_id)
        return links
    except Exception as e:
        logger.error(f"Error fetching links: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch links")


class MemorySuggestion(BaseModel):
    """AI-suggested memory to link."""
    memory_id: int
    title: str | None
    summary: str | None
    type: str
    relevance: float


class SuggestionsResponse(BaseModel):
    """Response model for link suggestions."""
    suggestions: list[MemorySuggestion]


@router.get("/{memory_id}/suggestions", response_model=SuggestionsResponse)
async def get_link_suggestions_endpoint(
    memory_id: int,
    limit: int = Query(5, ge=1, le=20, description="Maximum suggestions to return"),
    min_relevance: float = Query(0.5, ge=0.0, le=1.0, description="Minimum relevance score (0.0-1.0)"),
):
    """
    Get AI-suggested memories to link based on semantic similarity.

    Uses vector embeddings to find related memories that could be linked.
    Automatically excludes already-linked memories and the source memory itself.

    Args:
        memory_id: Source memory ID
        limit: Maximum number of suggestions (1-20, default 5)
        min_relevance: Minimum relevance score 0.0-1.0 (default 0.5)

    Returns:
        List of suggested memories with relevance scores

    Notes:
        - Returns empty array if memory has no embedding
        - Relevance scores are 0.0-1.0 (display as percentage)
        - Results are sorted by relevance (highest first)
    """
    try:
        # Convert min_relevance to similarity_threshold (inverted)
        # min_relevance=0.5 means max_distance=0.5
        similarity_threshold = 1.0 - min_relevance

        suggestions = await get_link_suggestions(
            memory_id=memory_id,
            similarity_threshold=similarity_threshold,
            limit=limit,
        )

        return {"suggestions": suggestions}
    except Exception as e:
        logger.error(f"Error fetching link suggestions: {e}")
        # Fail gracefully - return empty suggestions instead of 500 error
        # This allows the UI to degrade gracefully
        return {"suggestions": []}
