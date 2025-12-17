#!/usr/bin/env node
/**
 * Cross-platform backend build script.
 * Handles PyInstaller build and code signing for macOS.
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

const platform = os.platform();
const backendDir = path.join(__dirname, '..', 'backend');

console.log(`Building backend for ${platform}...`);

// Run PyInstaller
console.log('Running PyInstaller...');
try {
  execSync('poetry run pyinstaller think.spec --clean', {
    cwd: backendDir,
    stdio: 'inherit',
    shell: true,
  });
} catch (error) {
  console.error('PyInstaller failed:', error.message);
  process.exit(1);
}

// Code signing on macOS
if (platform === 'darwin') {
  const codesignIdentity = process.env.CODESIGN_IDENTITY;

  if (codesignIdentity) {
    console.log('Signing binaries...');
    try {
      // Sign all dylibs and so files in the dist directory
      execSync(
        `find dist/think-backend \\( -name '*.dylib' -o -name '*.so' \\) -exec codesign --force --sign "${codesignIdentity}" --timestamp --options runtime {} \\;`,
        {
          cwd: backendDir,
          stdio: 'inherit',
          shell: true,
        }
      );
      console.log('Code signing complete.');
    } catch (error) {
      console.error('Code signing failed:', error.message);
      process.exit(1);
    }
  } else {
    console.log('CODESIGN_IDENTITY not set, skipping code signing.');
  }
}

console.log('Backend build complete!');
