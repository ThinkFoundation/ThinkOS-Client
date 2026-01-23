const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

// Default timeout for FFmpeg operations (5 minutes)
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Validate that a video path is safe for processing.
 * Prevents path traversal and ensures the file exists within allowed directories.
 *
 * @param {string} videoPath - Path to validate
 * @returns {{ valid: boolean, error?: string }} - Validation result
 */
function validateVideoPath(videoPath) {
  if (!videoPath || typeof videoPath !== 'string') {
    return { valid: false, error: 'Invalid video path' };
  }

  // Resolve to absolute path
  const absolutePath = path.resolve(videoPath);

  // Check that the path exists
  if (!fs.existsSync(absolutePath)) {
    return { valid: false, error: 'Video file does not exist' };
  }

  // Check that it's a file (not a directory or symlink to directory)
  const stats = fs.lstatSync(absolutePath);
  if (!stats.isFile()) {
    return { valid: false, error: 'Path is not a file' };
  }

  // Get allowed directories (temp and user downloads)
  const tempDir = app.getPath('temp');
  const downloadsDir = app.getPath('downloads');
  const homeDir = app.getPath('home');

  // Use realpathSync to resolve symlinks (important for macOS where /var -> /private/var)
  const realPath = fs.realpathSync(absolutePath);
  const realTemp = fs.realpathSync(tempDir);
  const realDownloads = fs.realpathSync(downloadsDir);
  const realHome = fs.realpathSync(homeDir);

  // Allow files from temp directory, downloads, or anywhere under home directory
  const isInAllowedDir =
    realPath.startsWith(realTemp + path.sep) ||
    realPath.startsWith(realDownloads + path.sep) ||
    realPath.startsWith(realHome + path.sep);

  if (!isInAllowedDir) {
    return { valid: false, error: 'Video file is outside allowed directories' };
  }

  return { valid: true };
}

/**
 * Get the path to the FFmpeg binary.
 * In development, uses ffmpeg-static from node_modules.
 * In production, uses the bundled binary in resources.
 */
function getFFmpegPath() {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';

  if (app.isPackaged) {
    // Production: bundled binary
    return path.join(process.resourcesPath, 'ffmpeg', `ffmpeg${ext}`);
  } else {
    // Development: use ffmpeg-static package
    try {
      const ffmpegStatic = require('ffmpeg-static');
      return ffmpegStatic;
    } catch {
      // Fallback: system ffmpeg
      return 'ffmpeg';
    }
  }
}

/**
 * Parse FFmpeg progress from stderr output.
 * Extracts time progress like "time=00:00:05.00"
 *
 * @param {string} stderr - FFmpeg stderr output chunk
 * @param {number} duration - Total duration in seconds
 * @returns {number|null} - Progress 0-100 or null if not parseable
 */
function parseProgress(stderr, duration) {
  if (!duration || duration <= 0) return null;

  const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = parseInt(timeMatch[3], 10);
    const centiseconds = parseInt(timeMatch[4], 10);
    const currentTime = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
    return Math.min(100, Math.round((currentTime / duration) * 100));
  }
  return null;
}

/**
 * Get the duration of a video file using FFmpeg.
 *
 * @param {string} videoPath - Path to the video file (must be validated first)
 * @returns {Promise<number>} - Duration in seconds
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath();
    const args = ['-i', videoPath, '-f', 'null', '-'];

    const ffmpeg = spawn(ffmpegPath, args);
    let stderr = '';
    let killed = false;

    // Set timeout for duration extraction (30 seconds should be enough)
    const timeout = setTimeout(() => {
      killed = true;
      ffmpeg.kill('SIGKILL');
      console.warn('[VideoProcessor] Duration extraction timed out');
      resolve(0);
    }, 30000);

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', () => {
      clearTimeout(timeout);
      if (killed) return;

      // Parse duration from output like "Duration: 00:01:30.50"
      const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const centiseconds = parseInt(match[4], 10);
        resolve(hours * 3600 + minutes * 60 + seconds + centiseconds / 100);
      } else {
        // If duration parsing fails, use a default (will affect progress accuracy)
        console.warn('[VideoProcessor] Could not parse video duration');
        resolve(0);
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Extract audio from a video file.
 *
 * @param {string} videoPath - Path to the input video file (must be validated first)
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<string>} - Path to the extracted audio file (m4a)
 */
async function extractAudio(videoPath, onProgress) {
  const ffmpegPath = getFFmpegPath();
  const outputPath = videoPath.replace(/\.[^.]+$/, '') + '_audio.m4a';

  // Get duration for progress calculation
  const duration = await getVideoDuration(videoPath);

  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-vn',                  // No video
      '-acodec', 'aac',       // AAC codec
      '-b:a', '128k',         // 128kbps bitrate
      '-y',                   // Overwrite output
      outputPath
    ];

    console.log('[VideoProcessor] Extracting audio:', ffmpegPath, args.join(' '));
    const ffmpeg = spawn(ffmpegPath, args);
    let killed = false;

    // Set timeout (5 minutes for audio extraction)
    const timeout = setTimeout(() => {
      killed = true;
      ffmpeg.kill('SIGKILL');
      reject(new Error('Audio extraction timed out'));
    }, FFMPEG_TIMEOUT_MS);

    ffmpeg.stderr.on('data', (data) => {
      const stderr = data.toString();
      const progress = parseProgress(stderr, duration);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (killed) return;

      if (code === 0) {
        console.log('[VideoProcessor] Audio extraction complete:', outputPath);
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[VideoProcessor] FFmpeg error:', err);
      reject(err);
    });
  });
}

/**
 * Generate a thumbnail from a video file.
 *
 * @param {string} videoPath - Path to the input video file (must be validated first)
 * @param {number} timestamp - Timestamp in seconds (default: 1)
 * @returns {Promise<string|null>} - Path to the thumbnail file (jpg) or null on failure
 */
function generateThumbnail(videoPath, timestamp = 1) {
  const ffmpegPath = getFFmpegPath();
  const outputPath = videoPath.replace(/\.[^.]+$/, '') + '_thumb.jpg';

  return new Promise((resolve) => {
    const args = [
      '-ss', String(timestamp), // Seek to timestamp
      '-i', videoPath,
      '-frames:v', '1',         // Single frame
      '-q:v', '2',              // High quality JPEG
      '-y',                     // Overwrite output
      outputPath
    ];

    console.log('[VideoProcessor] Generating thumbnail:', ffmpegPath, args.join(' '));
    const ffmpeg = spawn(ffmpegPath, args);
    let killed = false;

    // Set timeout (30 seconds for thumbnail generation)
    const timeout = setTimeout(() => {
      killed = true;
      ffmpeg.kill('SIGKILL');
      console.warn('[VideoProcessor] Thumbnail generation timed out');
      resolve(null);
    }, 30000);

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (killed) return;

      if (code === 0) {
        console.log('[VideoProcessor] Thumbnail generation complete:', outputPath);
        resolve(outputPath);
      } else {
        // Thumbnail failure is non-critical, resolve with null
        console.warn('[VideoProcessor] Thumbnail generation failed, code:', code);
        resolve(null);
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      console.warn('[VideoProcessor] FFmpeg thumbnail error:', err);
      // Non-critical, resolve with null
      resolve(null);
    });
  });
}

/**
 * Process a video file: extract audio and generate thumbnail.
 *
 * @param {string} videoPath - Path to the video file
 * @param {function} onProgress - Progress callback ({ progress: 0-100, stage: string })
 * @returns {Promise<{ audioPath: string, thumbnailPath: string|null }>}
 */
async function processVideo(videoPath, onProgress) {
  console.log('[VideoProcessor] Processing video:', videoPath);

  // Validate the video path before processing
  const validation = validateVideoPath(videoPath);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid video path');
  }

  // Stage 1: Extract audio (0-80%)
  onProgress?.({ progress: 0, stage: 'extracting_audio' });
  const audioPath = await extractAudio(videoPath, (p) => {
    onProgress?.({ progress: Math.round(p * 0.8), stage: 'extracting_audio' });
  });

  // Stage 2: Generate thumbnail (80-100%)
  onProgress?.({ progress: 80, stage: 'generating_thumbnail' });
  const thumbnailPath = await generateThumbnail(videoPath, 1);

  onProgress?.({ progress: 100, stage: 'done' });

  return { audioPath, thumbnailPath };
}

/**
 * Write data to a temporary file.
 *
 * @param {Buffer} data - File data
 * @param {string} filename - Original filename (for extension)
 * @returns {Promise<string>} - Path to the temp file
 */
function writeTempFile(data, filename) {
  const tempDir = app.getPath('temp');
  const ext = path.extname(filename) || '.mp4';
  const tempPath = path.join(tempDir, `think_video_${Date.now()}${ext}`);

  return new Promise((resolve, reject) => {
    fs.writeFile(tempPath, data, (err) => {
      if (err) reject(err);
      else resolve(tempPath);
    });
  });
}

/**
 * Delete a temporary file.
 *
 * @param {string} filePath - Path to the file to delete
 */
function deleteTempFile(filePath) {
  return new Promise((resolve) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.warn('[VideoProcessor] Failed to delete temp file:', filePath, err);
      }
      resolve();
    });
  });
}

/**
 * Read a file as a buffer.
 *
 * @param {string} filePath - Path to the file
 * @returns {Promise<Buffer>}
 */
function readFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

module.exports = {
  getFFmpegPath,
  extractAudio,
  generateThumbnail,
  processVideo,
  writeTempFile,
  deleteTempFile,
  readFile,
};
