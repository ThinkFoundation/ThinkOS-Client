#!/usr/bin/env node
/**
 * Cross-platform backend start script.
 * Handles working directory properly on all platforms.
 */

const { spawn } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const isWindows = process.platform === 'win32';

console.log(`[start-backend] Starting backend server...`);
console.log(`[start-backend] Working directory: ${backendDir}`);

const child = spawn(
  isWindows ? 'poetry.cmd' : 'poetry',
  ['run', 'uvicorn', 'app.main:app', '--reload', '--port', '8765'],
  { 
    cwd: backendDir, 
    stdio: 'inherit', 
    shell: true 
  }
);

child.on('error', (error) => {
  console.error('[start-backend] Failed to start:', error.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
