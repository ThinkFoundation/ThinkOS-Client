"""Analytics caching layer for graph data.

This module re-exports caching functions from the services layer for backwards compatibility.
New code should import directly from app.services.cache.
"""

from ...services.cache import (
    get_cached_graph_data as get_graph_data_for_analytics,
    invalidate_analytics_cache,
    get_cache_stats,
)

__all__ = [
    "get_graph_data_for_analytics",
    "invalidate_analytics_cache",
    "get_cache_stats",
]
