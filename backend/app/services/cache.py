"""Caching layer for graph analytics data."""

from typing import Dict, Any, Optional
import hashlib
import json

from cachetools import TTLCache

from ..db.crud.graph import get_graph_data


# TTL cache with max 100 entries and 5-minute expiration
# Thread-safe for async context as we only use simple get/set operations
_analytics_cache: TTLCache[str, Dict[str, Any]] = TTLCache(maxsize=100, ttl=300)


def _generate_cache_key(
    memory_type: Optional[str] = None,
    date_range: Optional[str] = None,
    include_isolated: bool = True,
) -> str:
    """
    Generate a cache key from filter parameters.

    Args:
        memory_type: Filter by memory type
        date_range: Filter by date range
        include_isolated: Whether to include isolated nodes

    Returns:
        MD5 hash of parameters as cache key
    """
    key_data = {
        "memory_type": memory_type,
        "date_range": date_range,
        "include_isolated": include_isolated,
    }
    key_string = json.dumps(key_data, sort_keys=True)
    return hashlib.md5(key_string.encode()).hexdigest()


async def get_cached_graph_data(
    memory_type: Optional[str] = None,
    date_range: Optional[str] = None,
    include_isolated: bool = True,
    use_cache: bool = True,
) -> Dict[str, Any]:
    """
    Get graph data with caching for analytics.

    Args:
        memory_type: Filter by memory type
        date_range: Filter by date range
        include_isolated: Whether to include isolated nodes
        use_cache: Whether to use cached data if available

    Returns:
        Dictionary with nodes and links arrays
    """
    cache_key = _generate_cache_key(memory_type, date_range, include_isolated)

    # Return cached data if available and caching is enabled
    if use_cache and cache_key in _analytics_cache:
        return _analytics_cache[cache_key]

    # Fetch fresh data from database
    graph_data = await get_graph_data(
        memory_type=memory_type,
        date_range=date_range,
        include_isolated=include_isolated,
    )

    # Cache the result
    _analytics_cache[cache_key] = graph_data

    return graph_data


def invalidate_analytics_cache():
    """
    Clear the entire analytics cache.

    Call this when graph structure changes (links created/deleted).
    """
    global _analytics_cache
    _analytics_cache.clear()


def get_cache_stats() -> Dict[str, Any]:
    """
    Get cache statistics for monitoring.

    Returns:
        Dictionary with cache size and keys
    """
    return {
        "num_entries": len(_analytics_cache),
        "cache_keys": list(_analytics_cache.keys()),
    }
