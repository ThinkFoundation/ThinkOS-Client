# Think

Personal AI assistant for saving and chatting with web content.

## Setup

### Backend
```bash
cd backend
poetry install
poetry run alembic upgrade head  # Run migrations
```

### Install all dependencies
```bash
pnpm install
```

### Build extension
```bash
pnpm ext
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

## Chrome Extension

1. Build the extension: `pnpm ext`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension/dist/` folder

## Project Structure

```
think/
├── app/                 # Electron + React desktop app
│   └── src/
│       ├── components/ui/   # shadcn components
│       └── lib/utils.ts     # Tailwind utilities
├── backend/             # Python FastAPI server
│   └── app/main.py
└── extension/           # Chrome extension (React)
    └── src/
        ├── components/ui/   # shadcn components (shared style)
        └── popup.tsx
```

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind + shadcn/ui
- **Desktop**: Electron
- **Backend**: Python + FastAPI
- **Extension**: Chrome Manifest V3 + React
