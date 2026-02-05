"""Graph insights service for intelligent knowledge discovery."""

import logging
import math
import re
import struct
from collections import Counter
from typing import List, Dict, Tuple, Optional, Any, Set
import networkx as nx
from .analytics import GraphAnalytics

logger = logging.getLogger(__name__)

# Minimum TF-IDF score for a keyword to be included in community labels.
# Lower values include more keywords but may add noise; higher values are more selective.
TFIDF_MIN_SCORE = 0.05

# Stopwords for TF-IDF (common words to filter out)
STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "should",
    "could", "may", "might", "must", "can", "this", "that", "these", "those",
    "from", "into", "about", "up", "down", "out", "over", "under", "again",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "what", "which", "who", "whom", "whose", "if", "because", "as", "until",
    "while", "after", "before", "through", "during", "above", "below", "between",
    "among", "just", "now", "even", "also", "still", "yet"
}


def deserialize_embedding(embedding_bytes: bytes) -> List[float]:
    """Deserialize embedding bytes to list of floats."""
    num_floats = len(embedding_bytes) // 4
    return list(struct.unpack(f"{num_floats}f", embedding_bytes))


def cosine_similarity(emb_a: List[float], emb_b: List[float]) -> float:
    """
    Compute cosine similarity between two embeddings.

    Returns:
        Similarity score 0-1, where 1 = identical, 0 = orthogonal
    """
    if len(emb_a) != len(emb_b):
        raise ValueError("Embeddings must have same dimension")

    # Compute dot product
    dot_product = sum(a * b for a, b in zip(emb_a, emb_b))

    # Compute magnitudes
    mag_a = math.sqrt(sum(a * a for a in emb_a))
    mag_b = math.sqrt(sum(b * b for b in emb_b))

    # Avoid division by zero
    if mag_a == 0 or mag_b == 0:
        return 0.0

    # Cosine similarity
    return dot_product / (mag_a * mag_b)


def shannon_entropy(values: List[int]) -> float:
    """
    Compute Shannon entropy of a distribution.

    Args:
        values: List of counts

    Returns:
        Entropy value (higher = more diverse)
    """
    total = sum(values)
    if total == 0:
        return 0.0

    entropy = 0.0
    for value in values:
        if value > 0:
            p = value / total
            entropy -= p * math.log2(p)

    return entropy


class GraphInsights:
    """
    Intelligent knowledge discovery service.

    Combines graph topology analysis with semantic similarity to:
    - Detect knowledge gaps (isolated clusters, silos, sparse regions)
    - Generate smart link recommendations
    - Compute knowledge health metrics
    - Identify bridge nodes that could connect clusters
    """

    def __init__(
        self,
        analytics: GraphAnalytics,
        embeddings_map: Optional[Dict[int, bytes]] = None
    ):
        """
        Initialize insights service.

        Args:
            analytics: GraphAnalytics instance with computed metrics
            embeddings_map: Optional dict mapping node_id -> embedding bytes
        """
        self.analytics = analytics
        self.embeddings_map = embeddings_map or {}
        self.graph = analytics.graph
        self._deserialized_embeddings: Dict[int, List[float]] = {}

    def _get_embedding(self, node_id: int) -> Optional[List[float]]:
        """Get deserialized embedding for a node."""
        if node_id in self._deserialized_embeddings:
            return self._deserialized_embeddings[node_id]

        if node_id not in self.embeddings_map:
            return None

        try:
            embedding = deserialize_embedding(self.embeddings_map[node_id])
            self._deserialized_embeddings[node_id] = embedding
            return embedding
        except Exception as e:
            logger.error(f"Failed to deserialize embedding for node {node_id}: {e}")
            return None

    def extract_community_topics(
        self,
        community_nodes: List[int],
        all_communities: List[List[int]]
    ) -> str:
        """
        Extract topic label for a community using TF-IDF on node titles.

        Args:
            community_nodes: List of node IDs in this community
            all_communities: List of all communities for IDF calculation

        Returns:
            Topic label string (e.g., "Machine Learning • Python • Neural Networks")
            Falls back to top node titles if TF-IDF fails
        """
        # Get all titles in this community
        titles = []
        for node_id in community_nodes:
            if node_id in self.graph.nodes:
                title = self.graph.nodes[node_id].get('title', '')
                if title:
                    titles.append(title)

        if not titles:
            return f"Cluster ({len(community_nodes)} nodes)"

        # Tokenize: extract words, lowercase, remove stopwords
        def tokenize(title: str) -> List[str]:
            words = re.findall(r'\b\w+\b', title.lower())
            return [w for w in words if len(w) > 2 and w not in STOPWORDS]

        # Collect words from this community
        words = []
        for title in titles:
            words.extend(tokenize(title))

        if not words:
            # Fallback to node titles
            top_nodes = sorted(
                [n for n in community_nodes if n in self.graph.nodes],
                key=lambda n: self.graph.degree(n),
                reverse=True
            )[:3]
            top_titles = [
                self.graph.nodes[n].get('title', '')[:30]
                for n in top_nodes
            ]
            return " / ".join(filter(None, top_titles)) or f"Cluster {len(community_nodes)}"

        # Term frequency in this community
        tf = Counter(words)

        # Document frequency across all communities
        df = Counter()
        for comm in all_communities:
            comm_words = set()
            for node_id in comm:
                if node_id in self.graph.nodes:
                    title = self.graph.nodes[node_id].get('title', '')
                    if title:
                        comm_words.update(tokenize(title))
            for word in comm_words:
                df[word] += 1

        # Compute TF-IDF scores
        num_communities = len(all_communities)
        tfidf_scores = {}
        total_words = len(words)

        for word, freq in tf.items():
            tf_score = freq / total_words
            # Add 1 to avoid division by zero
            idf_score = math.log(num_communities / (df[word] + 1))
            tfidf_scores[word] = tf_score * idf_score

        # Get top 3 keywords
        top_words = sorted(tfidf_scores.items(), key=lambda x: x[1], reverse=True)[:3]
        keywords = [word.capitalize() for word, score in top_words if score > TFIDF_MIN_SCORE]

        if keywords:
            return " • ".join(keywords)

        # Fallback if no good keywords
        top_nodes = sorted(
            [n for n in community_nodes if n in self.graph.nodes],
            key=lambda n: self.graph.degree(n),
            reverse=True
        )[:3]
        top_titles = [
            self.graph.nodes[n].get('title', '')[:30]
            for n in top_nodes
        ]
        return " / ".join(filter(None, top_titles)) or f"Cluster {len(community_nodes)}"


    def generate_smart_recommendations(
        self,
        limit: int = 20,
        min_confidence: float = 0.6
    ) -> List[Dict]:
        """
        Generate prioritized link recommendations combining structure + semantics.

        Algorithm:
        1. Find all node pairs without existing links
        2. For each pair, compute:
           - Structural score: Common neighbors, path distance, community alignment
           - Semantic score: Embedding cosine similarity
           - Weighted combination (70% semantic, 30% structural)
        3. Filter by confidence threshold
        4. Rank by composite score
        5. Add explanations (why recommend this link)

        Args:
            limit: Maximum number of recommendations to return
            min_confidence: Minimum confidence threshold (0.0-1.0)

        Returns:
            List of recommendation dictionaries
        """
        G = self.graph
        recommendations = []

        # Get existing links
        existing_links = set()
        for u, v in G.edges():
            existing_links.add((min(u, v), max(u, v)))

        # Get communities for community alignment check
        try:
            communities_data = self.analytics.get_communities()
            node_to_community = {}
            for idx, community in enumerate(communities_data["communities"]):
                for node in community:
                    node_to_community[node] = idx
        except Exception:
            node_to_community = {}

        # Get centrality metrics
        try:
            centrality_metrics = self.analytics.get_centrality_metrics()
            degree_centrality = centrality_metrics.get("degree", {})
        except Exception:
            degree_centrality = {}

        max_degree = max(degree_centrality.values()) if degree_centrality else 1.0

        # Sample node pairs (for large graphs, don't check all pairs)
        nodes = list(G.nodes())
        num_nodes = len(nodes)

        # For graphs > 100 nodes, sample intelligently
        if num_nodes > 100:
            # Prioritize high-degree nodes (hubs) as potential connection points
            sorted_nodes = sorted(
                nodes,
                key=lambda n: degree_centrality.get(n, 0),
                reverse=True
            )
            sample_nodes = sorted_nodes[:50]  # Top 50 most connected nodes
        else:
            sample_nodes = nodes

        # Check pairs
        for i, node_a in enumerate(sample_nodes):
            for node_b in sample_nodes[i+1:]:
                # Skip existing links
                pair = (min(node_a, node_b), max(node_a, node_b))
                if pair in existing_links:
                    continue

                # Get embeddings
                emb_a = self._get_embedding(node_a)
                emb_b = self._get_embedding(node_b)

                if emb_a is None or emb_b is None:
                    continue

                # Compute semantic score
                try:
                    semantic_score = cosine_similarity(emb_a, emb_b)
                    # Cosine similarity for embeddings is already in [0, 1] range
                    # Just clamp to handle any edge cases
                    semantic_score = max(0.0, min(1.0, semantic_score))
                except Exception:
                    continue

                # Compute structural score
                try:
                    # Common neighbors
                    neighbors_a = set(G.neighbors(node_a))
                    neighbors_b = set(G.neighbors(node_b))
                    common_neighbors = len(neighbors_a & neighbors_b)

                    # Path distance (if connected)
                    try:
                        path_length = nx.shortest_path_length(G, node_a, node_b)
                    except nx.NetworkXNoPath:
                        path_length = float('inf')

                    # Community alignment
                    same_community = (
                        node_to_community.get(node_a) == node_to_community.get(node_b)
                        if node_to_community else False
                    )

                    # Structural score components
                    common_neighbors_score = min(1.0, common_neighbors / max_degree) if max_degree > 0 else 0
                    path_score = 1 / (path_length + 1) if path_length != float('inf') else 0
                    community_score = 1.0 if same_community else 0.2

                    structural_score = (
                        0.4 * common_neighbors_score +
                        0.3 * path_score +
                        0.3 * community_score
                    )
                    # Ensure structural score stays in [0, 1] range
                    structural_score = max(0.0, min(1.0, structural_score))
                except Exception as e:
                    logger.debug(f"Structural score failed for {node_a}-{node_b}: {e}")
                    structural_score = 0.0

                # Composite confidence (balanced semantic + structural)
                confidence = 0.5 * semantic_score + 0.5 * structural_score

                # Clamp to 0-1 range (in case of calculation issues)
                confidence = max(0.0, min(1.0, confidence))

                # Filter by threshold
                if confidence < min_confidence:
                    continue

                # Generate reason
                reason_parts = []
                if semantic_score > 0.75:
                    reason_parts.append("Highly similar content")
                elif semantic_score > 0.6:
                    reason_parts.append("Similar content")

                if common_neighbors > 0:
                    reason_parts.append(f"{common_neighbors} common connections")

                if same_community:
                    reason_parts.append("Same topic cluster")
                elif path_length != float('inf') and path_length <= 3:
                    reason_parts.append(f"{path_length}-hop path exists")
                else:
                    reason_parts.append("Bridge between clusters")

                reason = ", ".join(reason_parts) if reason_parts else "Recommended connection"

                # Estimate impact
                if path_length == float('inf'):
                    impact = "Connects disconnected clusters"
                elif common_neighbors > 2:
                    impact = "Strengthens existing cluster"
                else:
                    impact = "Forms new connection pathway"

                # Get node titles
                title_a = G.nodes[node_a].get("title", f"Node {node_a}")
                title_b = G.nodes[node_b].get("title", f"Node {node_b}")

                recommendations.append({
                    "source_id": node_a,
                    "target_id": node_b,
                    "source_title": title_a,
                    "target_title": title_b,
                    "confidence": round(confidence, 3),
                    "semantic_score": round(semantic_score, 3),
                    "structural_score": round(structural_score, 3),
                    "reason": reason,
                    "impact": impact
                })

        # Sort by confidence descending
        recommendations.sort(key=lambda x: x["confidence"], reverse=True)

        return recommendations[:limit]

    def compute_knowledge_health(
        self,
        link_timeline: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """
        Calculate knowledge graph health metrics.

        Metrics:
        - Overall health score (0-100)
        - Connectivity score (based on density, components)
        - Balance score (distribution across types/communities)
        - Coverage score (% non-isolated nodes)
        - Growth metrics (links created in last week/month)

        Args:
            link_timeline: Optional list of {date, count} for growth metrics

        Returns:
            Health dashboard data
        """
        G = self.graph
        num_nodes = G.number_of_nodes()

        if num_nodes == 0:
            return {
                "health_score": 0.0,
                "metrics": {
                    "connectivity": 0.0,
                    "balance": 0.0,
                    "coverage": 0.0
                },
                "growth": {
                    "links_last_week": 0,
                    "links_last_month": 0,
                    "trend": "stable"
                },
                "issues": ["No nodes in graph"],
                "recommendations": []
            }

        # 1. Connectivity score (0-100)
        density = nx.density(G)
        num_components = nx.number_connected_components(G)

        # Base score from density (0-1 mapped to 0-70)
        density_score = density * 70

        # Penalty for disconnected components (-10 per additional component)
        component_penalty = (num_components - 1) * 10

        connectivity = max(0, min(100, density_score - component_penalty))

        # 2. Balance score (0-100) - type distribution entropy
        stats = self.analytics.get_statistics()
        type_dist = stats.get("type_distribution", {})

        if type_dist:
            type_counts = list(type_dist.values())
            entropy = shannon_entropy(type_counts)
            max_entropy = math.log2(len(type_counts)) if len(type_counts) > 1 else 1
            balance = (entropy / max_entropy) * 100 if max_entropy > 0 else 100
        else:
            balance = 100

        # 3. Coverage score (0-100) - % of non-isolated nodes
        isolated_nodes = sum(1 for node in G.nodes() if G.degree(node) == 0)
        coverage = ((num_nodes - isolated_nodes) / num_nodes) * 100

        # 4. Overall health score (weighted average)
        health_score = (
            0.4 * connectivity +
            0.3 * balance +
            0.3 * coverage
        )

        # 5. Growth metrics
        links_last_week = 0
        links_last_month = 0
        trend = "stable"

        if link_timeline:
            # Sum links from last 7 and 30 days
            # Timeline is assumed sorted with most recent first
            for idx, entry in enumerate(link_timeline):
                count = entry.get("count", 0)
                links_last_month += count
                if idx < 7:  # First 7 entries = last week
                    links_last_week += count

            # Determine trend
            if links_last_week > links_last_month * 0.5:
                trend = "increasing"
            elif links_last_week < links_last_month * 0.1:
                trend = "decreasing"

        # 6. Issues detection
        issues = []
        if connectivity < 40:
            issues.append("Low connectivity - many disconnected components")
        if coverage < 50:
            issues.append(f"High isolation - {isolated_nodes} nodes have no links")
        if balance < 40:
            issues.append("Imbalanced graph - dominated by one memory type")
        if num_components > 5:
            issues.append(f"Graph fragmented into {num_components} separate clusters")

        # 7. Recommendations
        recommendations = []
        if connectivity < 60:
            recommendations.append("Create more connections between existing nodes")
        if coverage < 70:
            recommendations.append("Link isolated nodes to related memories")
        if num_components > 3:
            recommendations.append("Build bridges between disconnected clusters")
        if balance < 50:
            recommendations.append("Add more diverse types of memories")

        return {
            "health_score": round(health_score, 1),
            "metrics": {
                "connectivity": round(connectivity, 1),
                "balance": round(balance, 1),
                "coverage": round(coverage, 1)
            },
            "growth": {
                "links_last_week": links_last_week,
                "links_last_month": links_last_month,
                "trend": trend
            },
            "issues": issues,
            "recommendations": recommendations
        }
