#!/usr/bin/env node
/**
 * Cross-platform native messaging stub build script.
 * - macOS/Linux: Compiles C stub with clang/gcc
 * - Windows: Builds Python stub with PyInstaller
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const platform = os.platform();
const nativeHostDir = path.join(__dirname, '..', 'backend', 'native_host');

console.log(`Building native stub for ${platform}...`);

if (platform === 'win32') {
  // Windows: Build Python stub with PyInstaller
  console.log('Building Python stub with PyInstaller...');
  try {
    execSync('poetry run pyinstaller stub_win.spec --clean', {
      cwd: nativeHostDir,
      stdio: 'inherit',
      shell: true,
    });

    // Move the built exe to the native_host directory for bundling
    const distExe = path.join(nativeHostDir, 'dist', 'think-native-stub.exe');
    const targetExe = path.join(nativeHostDir, 'think-native-stub.exe');
    if (fs.existsSync(distExe)) {
      fs.copyFileSync(distExe, targetExe);
      console.log(`Copied stub to ${targetExe}`);
    }
  } catch (error) {
    console.error('PyInstaller failed:', error.message);
    process.exit(1);
  }
} else {
  // macOS/Linux: Compile C stub
  const compiler = platform === 'darwin' ? 'clang' : 'gcc';
  const stubSource = path.join(nativeHostDir, 'stub.c');
  const stubOutput = path.join(nativeHostDir, 'think-native-stub');

  console.log(`Compiling C stub with ${compiler}...`);
  try {
    execSync(`${compiler} -O2 -o think-native-stub stub.c`, {
      cwd: nativeHostDir,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Compilation failed:', error.message);
    process.exit(1);
  }

  // Code signing on macOS
  if (platform === 'darwin') {
    const codesignIdentity = process.env.CODESIGN_IDENTITY;

    if (codesignIdentity) {
      console.log('Signing stub binary...');
      try {
        execSync(
          `codesign --force --sign "${codesignIdentity}" --timestamp --options runtime think-native-stub`,
          {
            cwd: nativeHostDir,
            stdio: 'inherit',
          }
        );
        console.log('Code signing complete.');
      } catch (error) {
        console.error('Code signing failed:', error.message);
        process.exit(1);
      }
    } else {
      // Ad-hoc signing for local development
      console.log('Ad-hoc signing for local development...');
      try {
        execSync('codesign --sign - --force think-native-stub', {
          cwd: nativeHostDir,
          stdio: 'inherit',
        });
      } catch (error) {
        console.warn('Ad-hoc signing failed (non-fatal):', error.message);
      }
    }
  }
}

console.log('Native stub build complete!');
