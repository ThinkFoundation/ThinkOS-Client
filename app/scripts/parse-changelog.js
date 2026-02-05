import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');
const outputPath = path.resolve(__dirname, '../src/data/changelog.json');

function parseChangelog(content) {
  const entries = [];
  const lines = content.split('\n');

  let currentVersion = null;
  let currentChangeType = null;
  let currentChanges = [];
  let currentDescription = [];

  const flushDescription = () => {
    if (currentDescription.length > 0) {
      const text = currentDescription.join('\n').trim();
      if (text) {
        currentChanges.push({
          type: currentChangeType,
          description: text,
        });
      }
      currentDescription = [];
    }
  };

  const flushVersion = () => {
    flushDescription();
    if (currentVersion && currentChanges.length > 0) {
      entries.push({
        version: currentVersion,
        changes: currentChanges,
      });
    }
    currentChanges = [];
    currentChangeType = null;
  };

  for (const line of lines) {
    // Version header: ## 0.6.2
    const versionMatch = line.match(/^## (\d+\.\d+\.\d+)/);
    if (versionMatch) {
      flushVersion();
      currentVersion = versionMatch[1];
      continue;
    }

    // Change type header: ### Minor Changes or ### Patch Changes
    const changeTypeMatch = line.match(/^### (Minor|Patch|Major) Changes/i);
    if (changeTypeMatch) {
      flushDescription();
      currentChangeType = changeTypeMatch[1].toLowerCase();
      continue;
    }

    // Change item: - commit: description
    const changeMatch = line.match(/^- ([a-f0-9]+: )?(.+)/);
    if (changeMatch && currentChangeType) {
      flushDescription();
      currentDescription.push(changeMatch[2]);
      continue;
    }

    // Continuation of description (indented or empty lines within a change)
    if (currentDescription.length > 0 && (line.startsWith('  ') || line.trim() === '')) {
      currentDescription.push(line);
    }
  }

  flushVersion();

  return entries;
}

// Read and parse
const content = fs.readFileSync(changelogPath, 'utf-8');
const entries = parseChangelog(content);

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write JSON
fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2));
console.log(`Parsed ${entries.length} changelog entries to ${outputPath}`);
