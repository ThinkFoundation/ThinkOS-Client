# Think

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Personal AI assistant for saving and chatting with web content.

## Setup

### macOS / Linux

```bash
# Install dependencies
pnpm install

# Install backend
cd backend && poetry install

# Build native messaging stub
pnpm build:stub
```

### Windows

```powershell
# Run the automated setup script
.\scripts\setup-windows.ps1
```

Or manually:

```powershell
# Install dependencies
pnpm install

# Install backend (requires Python 3.12)
cd backend
poetry env use python3.12  # if you have multiple Python versions
poetry install
cd ..

# Build extension and native stub
pnpm ext
pnpm build:stub
```

**Note:** Windows requires Python 3.12 (not 3.13) for full compatibility.

## Development

### Quick Start (All Platforms)

```bash
# Start backend + Electron app together
pnpm dev

# Or with extension hot-reload
pnpm dev:all
```

### Individual Commands

```bash
# Start backend server
pnpm backend

# Start Electron app
pnpm app

# Watch extension changes
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
