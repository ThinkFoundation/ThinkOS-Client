const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  // Skip notarization on non-macOS platforms
  if (electronPlatformName !== 'darwin') return;

  // Load .env.local from project root
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('Loaded environment from:', envPath);
  } else {
    console.log('No .env.local found at:', envPath);
  }

  // Skip notarization unless NOTARIZE=1 is set
  if (process.env.NOTARIZE !== '1') {
    console.log('Skipping notarization (use pnpm build:all:release for notarized builds)');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.error('Missing notarization credentials:');
    console.error('  APPLE_ID:', appleId ? 'set' : 'MISSING');
    console.error('  APPLE_APP_SPECIFIC_PASSWORD:', appleIdPassword ? 'set' : 'MISSING');
    console.error('  APPLE_TEAM_ID:', teamId ? 'set' : 'MISSING');
    throw new Error('Cannot notarize without credentials. Check .env.local file.');
  }

  const appName = context.packager.appInfo.productFilename;

  // Dynamic import to avoid ESM issues on Windows
  const { notarize } = await import('@electron/notarize');
  
  console.log('Notarizing application...');
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log('Notarization complete!');
};
