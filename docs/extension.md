# Chrome Extension

## Installation

1. Build the extension: `pnpm ext`
2. Build the native messaging stub: `pnpm build:stub`
3. Go to `chrome://extensions`
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the `extension/dist/` folder
7. Note the Extension ID shown (should be `ddkjmfghdikcpfnemhpecpmiajjhghoi`)
8. Start the Electron app to register the native messaging host

## How Native Messaging Works

The extension communicates with the backend via Chrome's native messaging API:

```
Extension → Native Host (thin C binary) → Python stub → Backend (Unix socket)
```

The native host manifest is automatically installed when the Electron app starts. It registers:
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.think.native.json`
- Windows: `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\com.think.native.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.think.native.json`

## Extension ID

The extension uses a stable key in `manifest.json` so all team members get the same Extension ID: `ddkjmfghdikcpfnemhpecpmiajjhghoi`

This ID is pre-configured in `app/scripts/install-native-host.js`.
