#!/usr/bin/env node
/**
 * Cross-platform backend build script.
 * 
 * - Windows: Uses PyInstaller without code signing
 * - macOS: Uses PyInstaller with optional code signing
 * - Linux: Uses PyInstaller without code signing
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const backendDir = path.join(__dirname, '..', 'backend');

console.log(`[build-backend] Platform: ${process.platform}`);
console.log(`[build-backend] Backend dir: ${backendDir}`);

// Check if think.spec exists
const specPath = path.join(backendDir, 'think.spec');
if (!fs.existsSync(specPath)) {
  console.error(`[build-backend] Error: ${specPath} not found`);
  console.error('[build-backend] PyInstaller spec file is required for backend build');
  process.exit(1);
}

// Get codesign identity for macOS
function getCodesignIdentity() {
  if (!isMac) return null;
  
  // Check environment variable first
  if (process.env.CODESIGN_IDENTITY) {
    return process.env.CODESIGN_IDENTITY;
  }
  
  // Try to read from .env.local
  try {
    const envLocalPath = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(envLocalPath)) {
      const content = fs.readFileSync(envLocalPath, 'utf8');
      const match = content.match(/^CODESIGN_IDENTITY=(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    }
  } catch (e) {
    // Ignore errors reading .env.local
  }
  
  return null;
}

// Run PyInstaller
console.log('[build-backend] Running PyInstaller...');
try {
  execSync(
    `poetry run pyinstaller think.spec --clean --noconfirm`,
    { cwd: backendDir, stdio: 'inherit' }
  );
} catch (error) {
  console.error('[build-backend] PyInstaller build failed:', error.message);
  process.exit(1);
}

// Code signing for macOS
if (isMac) {
  const codesignIdentity = getCodesignIdentity();
  
  if (codesignIdentity) {
    console.log(`[build-backend] Signing with identity: ${codesignIdentity}`);
    
    const distDir = path.join(backendDir, 'dist', 'think-backend');
    
    // Find all .dylib and .so files
    function findFilesToSign(dir, files = []) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findFilesToSign(fullPath, files);
        } else if (entry.name.endsWith('.dylib') || entry.name.endsWith('.so')) {
          files.push(fullPath);
        }
      }
      return files;
    }
    
    try {
      const filesToSign = findFilesToSign(distDir);
      console.log(`[build-backend] Found ${filesToSign.length} files to sign`);
      
      for (const file of filesToSign) {
        console.log(`[build-backend] Signing: ${path.basename(file)}`);
        execSync(
          `codesign --force --sign "${codesignIdentity}" --timestamp --options runtime "${file}"`,
          { stdio: 'pipe' }
        );
      }
      
      console.log('[build-backend] Code signing complete');
    } catch (error) {
      console.error('[build-backend] Code signing failed:', error.message);
      console.error('[build-backend] Build completed but signing failed');
    }
  } else {
    console.log('[build-backend] No CODESIGN_IDENTITY found, skipping code signing');
  }
}

// Verify output
const distPath = path.join(backendDir, 'dist', 'think-backend');
if (fs.existsSync(distPath)) {
  console.log(`[build-backend] Success! Built to: ${distPath}`);
} else {
  console.error('[build-backend] Build completed but output directory not found');
  process.exit(1);
}

console.log('[build-backend] Done!');
