# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-12-10

Initial open source release of Think - a local-first AI assistant with memory.

### Features

#### Core
- Chat with AI using local Ollama or OpenAI-compatible cloud APIs
- Real-time streaming responses with conversation history
- RAG (Retrieval-Augmented Generation): AI uses your saved memories as context
- Source attribution showing which memories informed each response

#### Memory Management
- Save web pages and manual notes
- Hybrid search: semantic (vector embeddings) + full-text keyword search
- Automatic AI-generated summaries and tags
- Filter by type (web/note) and date range
- Infinite scroll pagination

#### Chrome Extension
- One-click save of current webpage
- Duplicate detection with update option
- Secure native messaging (no HTTP exposure)

#### AI Providers
- **Local**: Ollama with automated setup wizard (llama3.2, nomic-embed-text)
- **Cloud**: OpenAI or compatible APIs
- Switch providers without losing data

#### Privacy & Security
- Local-first architecture - no data sent externally by default
- Master password protection
- Encrypted SQLite database
- No telemetry or tracking

#### UI/UX
- Clean, modern interface
- Light/dark theme support
- Personalized greetings with user profile
