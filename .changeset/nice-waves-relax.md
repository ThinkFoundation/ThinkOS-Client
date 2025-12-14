---
"think-app": minor
---

feat: add provider switching and context usage tracking

## Provider Switching
- Switch between Ollama (local) and OpenAI (cloud) providers
- Separate selection for chat and embedding models
- Provider status indicator in sidebar showing connection state
- Auto-sync embedding provider when AI provider changes
- Validate provider/model combinations to prevent invalid configs

## Context Usage Tracking
- Real-time token usage indicator with circular progress ring
- Color-coded usage levels (green → yellow → orange → red)
- Hover popover showing current context and session totals
- Track prompt, completion, and total tokens per message

## Model Management
- Model selector component with download support for Ollama
- Display model context window sizes
- Block known broken models (nomic-embed-text)
- Reset to default model when switching providers

## Re-embedding System
- Background job system for re-embedding memories when model changes
- Progress tracking with cancellation support
- Smart detection of stale embeddings by model mismatch
- Warning dialog showing affected memory count before changes

## Backend Changes
- Database-backed settings with thread-safe reloading
- Token usage columns on messages table
- Embedding model tracking on memories table
- Jobs table for background task management
- Model context window metadata registry
