/**
 * check-function-sizes.js
 *
 * Detects serverless function bundles that exceed Vercel's 50 MB limit.
 * Walks .next/server/app and sums file sizes per route directory.
 * Reports violations with top 5 largest files.
 *
 * Usage: node scripts/check-function-sizes.js
 * Exit 0 if all pass (or .next/server missing), exit 1 if any violation.
 */

const fs = require('fs');
const path = require('path');

const THRESHOLD_MB = 50;
const THRESHOLD_BYTES = THRESHOLD_MB * 1024 * 1024;
const SERVER_DIR = path.join(process.cwd(), '.next', 'server');

function getDirectorySize(dirPath) {
  let totalSize = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const fullPath = path.join(entry.parentPath || entry.path || dirPath, entry.name);
      totalSize += fs.statSync(fullPath).size;
    }
  }
  return totalSize;
}

function findLargestFiles(dirPath, limit = 5) {
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const fullPath = path.join(entry.parentPath || entry.path || dirPath, entry.name);
      files.push({ path: fullPath, size: fs.statSync(fullPath).size });
    }
  }
  files.sort((a, b) => b.size - a.size);
  return files.slice(0, limit);
}

function main() {
  if (!fs.existsSync(SERVER_DIR)) {
    console.log('No .next/server found. Run npm run build first.');
    process.exit(0);
  }

  const appDir = path.join(SERVER_DIR, 'app');
  if (!fs.existsSync(appDir)) {
    console.log('No .next/server/app found. Nothing to check.');
    process.exit(0);
  }

  let hasViolation = false;

  const routes = fs.readdirSync(appDir, { withFileTypes: true });
  for (const route of routes) {
    if (route.isDirectory()) {
      const routePath = path.join(appDir, route.name);
      const size = getDirectorySize(routePath);
      const sizeMB = (size / 1024 / 1024).toFixed(1);

      if (size > THRESHOLD_BYTES) {
        console.log(`✗ ${route.name}: ${sizeMB} MB (EXCEEDS ${THRESHOLD_MB} MB)`);
        const largest = findLargestFiles(routePath);
        largest.forEach((f, i) => {
          console.log(`  ${i + 1}. ${path.relative(routePath, f.path)} — ${(f.size / 1024 / 1024).toFixed(1)} MB`);
        });
        hasViolation = true;
      } else {
        console.log(`✓ ${route.name}: ${sizeMB} MB`);
      }
    }
  }

  process.exit(hasViolation ? 1 : 0);
}

main();
