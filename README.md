# ThinkOS Client

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

ThinkOS is an open-source, local-first application that serves as the user interface layer for AI agent servers. Where frameworks like OpenClaw provide the agent engine, ThinkOS provides the experience — a unified dashboard for managing agents, tasks, and personal knowledge, with your data stored entirely on your own device.

Built for users who want the full power of modern agentic AI without sacrificing privacy or control, ThinkOS supports any OpenAI-compatible model provider (Ollama, Claude, GPT, and more) and features a sandboxed plugin architecture that prevents third-party extensions from exfiltrating your data.

ThinkOS is free, self-hosted, and open source. Contributions welcome.

![Think App Screenshot](screenshot.png)

## Download

[![Latest Release](https://img.shields.io/github/v/release/ThinkFoundation/ThinkOS-Client)](https://github.com/ThinkFoundation/ThinkOS-Client/releases/latest)

| Platform         | Download                                                                                |
| ---------------- | --------------------------------------------------------------------------------------- |
| macOS            | [Download .dmg](https://github.com/ThinkFoundation/ThinkOS-Client/releases/latest)      |
| Windows          | [Download Installer](https://github.com/ThinkFoundation/ThinkOS-Client/releases/latest) |
| Chrome Extension | [Download .zip](https://github.com/ThinkFoundation/ThinkOS-Client/releases/latest)      |

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (not npm/yarn)
- [Python](https://www.python.org/) 3.12
- [Poetry](https://python-poetry.org/)
- [Ollama](https://ollama.ai/) (optional - app can auto-install)

## Platform Notes

**macOS**: Install sqlcipher for database encryption:

```bash
brew install sqlcipher
```

**Windows**: Works out of the box. Ensure Python 3.12 is in PATH.

## Setup

```bash
# Install dependencies
pnpm install

# Install backend
cd backend && poetry install
```

## Development

```bash
# Terminal 1: Start backend
cd backend && poetry run uvicorn app.main:app --reload --port 8765

# Terminal 2: Start Electron app
pnpm app

# Terminal 3: Watch extension changes
pnpm --filter think-extension dev
```

## Project Structure

```
think/
├── app/          # Electron + React desktop app
├── backend/      # Python FastAPI server
└── extension/    # Chrome extension (React)
```

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind + shadcn/ui
- **Desktop**: Electron
- **Backend**: Python + FastAPI
- **Extension**: Chrome Manifest V3 + React

## Documentation

- [Chrome Extension Setup](docs/extension.md)
- [Building for Distribution](docs/distribution.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Apache 2.0](LICENSE)
