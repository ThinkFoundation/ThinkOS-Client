#!/usr/bin/env node
/**
 * Cross-platform native messaging stub build script.
 * 
 * - Windows: Uses PyInstaller to build from stub_win.py
 * - macOS/Linux: Uses clang to compile stub.c
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const backendDir = path.join(__dirname, '..', 'backend');
const nativeHostDir = path.join(backendDir, 'native_host');

console.log(`[build-stub] Platform: ${process.platform}`);
console.log(`[build-stub] Backend dir: ${backendDir}`);

if (isWindows) {
  console.log('[build-stub] Building Windows native stub with PyInstaller...');
  
  try {
    execSync(
      'poetry run pyinstaller --onefile --name think-native-stub --distpath native_host native_host/stub_win.py --noconfirm',
      { cwd: backendDir, stdio: 'inherit' }
    );
    
    const exePath = path.join(nativeHostDir, 'think-native-stub.exe');
    if (fs.existsSync(exePath)) {
      console.log(`[build-stub] Success! Built: ${exePath}`);
    } else {
      console.error('[build-stub] Build completed but exe not found');
      process.exit(1);
    }
  } catch (error) {
    console.error('[build-stub] PyInstaller build failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('[build-stub] Building macOS/Linux native stub with clang...');
  
  try {
    execSync('clang -O2 -o think-native-stub stub.c', { 
      cwd: nativeHostDir, 
      stdio: 'inherit' 
    });
    
    const stubPath = path.join(nativeHostDir, 'think-native-stub');
    
    if (isMac) {
      // Code signing for macOS
      const codesignIdentity = process.env.CODESIGN_IDENTITY || 
        (() => {
          try {
            const envLocal = path.join(__dirname, '..', '.env.local');
            if (fs.existsSync(envLocal)) {
              const content = fs.readFileSync(envLocal, 'utf8');
              const match = content.match(/^CODESIGN_IDENTITY=(.+)$/m);
              return match ? match[1].trim() : null;
            }
          } catch (e) {}
          return null;
        })();
      
      if (codesignIdentity) {
        console.log(`[build-stub] Signing with identity: ${codesignIdentity}`);
        execSync(
          `codesign --force --sign "${codesignIdentity}" --timestamp --options runtime think-native-stub`,
          { cwd: nativeHostDir, stdio: 'inherit' }
        );
      } else {
        console.log('[build-stub] No CODESIGN_IDENTITY found, using ad-hoc signing');
        execSync('codesign --sign - --force think-native-stub', { 
          cwd: nativeHostDir, 
          stdio: 'inherit' 
        });
      }
    }
    
    console.log(`[build-stub] Success! Built: ${stubPath}`);
  } catch (error) {
    console.error('[build-stub] Build failed:', error.message);
    process.exit(1);
  }
}

console.log('[build-stub] Done!');
