# Think

Personal AI assistant for saving and chatting with web content.

## Setup

### Backend
```bash
cd backend
poetry install
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
2. Build the native messaging stub: `pnpm build:stub`
3. Go to `chrome://extensions`
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the `extension/dist/` folder
7. Note the Extension ID shown (should be `ddkjmfghdikcpfnemhpecpmiajjhghoi`)
8. Start the Electron app to register the native messaging host

### How Native Messaging Works

The extension communicates with the backend via Chrome's native messaging API:

```
Extension → Native Host (thin C binary) → Python stub → Backend (Unix socket)
```

The native host manifest is automatically installed when the Electron app starts. It registers:
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.think.native.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.think.native.json`

### Extension ID (for team sharing)

The extension uses a stable key in `manifest.json` so all team members get the same Extension ID: `ddkjmfghdikcpfnemhpecpmiajjhghoi`

This ID is pre-configured in `app/scripts/install-native-host.js`.

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

## Building for Distribution

### Prerequisites

You need an [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year) and a Developer ID certificate.

#### Setting up your Developer ID Certificate

1. Open **Keychain Access** → Certificate Assistant → Request a Certificate From a Certificate Authority
2. Enter your email, select "Saved to disk", click Continue
3. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/add)
4. Select **Developer ID Application**, upload your CSR
5. Download the certificate and double-click to install
6. Download the [Developer ID - G2 intermediate cert](https://www.apple.com/certificateauthority/) and install it
7. Verify: `security find-identity -v -p codesigning`

### Development Build

Fast builds for internal testing. Signed but not notarized—recipients need to right-click → Open on first launch.

```bash
pnpm build:all
```

### Release Build

For external distribution. Signed and notarized—opens without warnings.

1. Copy `.env.example` to `.env.local`
2. Fill in your credentials:
   - `CODESIGN_IDENTITY` - From `security find-identity -v -p codesigning`
   - `APPLE_ID` - Your Apple Developer email
   - `APPLE_APP_SPECIFIC_PASSWORD` - Generate at [appleid.apple.com](https://appleid.apple.com/account/manage) → Security → App-Specific Passwords
   - `APPLE_TEAM_ID` - Your 10-character Team ID

3. Build:
   ```bash
   pnpm build:all:release
   ```

Output: `app/release/Think-{version}.dmg`

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind + shadcn/ui
- **Desktop**: Electron
- **Backend**: Python + FastAPI
- **Extension**: Chrome Manifest V3 + React
