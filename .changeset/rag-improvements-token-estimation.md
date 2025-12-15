---
"think-app": patch
---

# RAG Pipeline Improvements & Token Estimation

## Frontend Changes

### Token Usage Estimation
- Replaced API-provided token counts with client-side estimation (~4 chars/token)
- Context usage indicator now shows approximate values with `~` prefix
- More stable UI without flickering from API response timing

### Model Selector Optimization
- Added provider tracking to prevent unnecessary re-fetches during polling
- Reduces API calls and eliminates visual flickering

## Backend Changes

### Improved Memory Filtering
- Dynamic threshold-based filtering adapts to match quality
- Tiered filtering: excellent matches allow more results, marginal matches are stricter
- Skip RAG for very short messages (< 10 chars)

### Enhanced Search Pipeline
- Added match type tracking (vector/keyword/hybrid) and RRF scores
- Graceful fallback to vector-only search if hybrid fails
- Comprehensive logging throughout the search pipeline

### Embedding Safety
- Model-specific context windows (Ollama models have smaller limits than documented)
- Intelligent text chunking with paragraph/sentence awareness
- Parallel chunk processing with embedding averaging

### Other Improvements
- Blocked `all-minilm` embedding model (context too small)
- Removed conversation history limit for fuller context
- Added logging for query transformations
