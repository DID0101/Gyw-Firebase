#!/usr/bin/env node
/**
 * Remove react-native-worklets/plugin from react-native-css-interop (requires New Architecture).
 * Replaces patch-package to avoid EAS Build install failures.
 * Never exits 1 - allows build to continue and fail later with clearer errors if fix fails.
 */
const fs = require('fs');
const path = require('path');

function main() {
  const babelPath = path.join(__dirname, '..', 'node_modules', 'react-native-css-interop', 'babel.js');
  if (!fs.existsSync(babelPath)) {
    console.warn('fix-css-interop: babel.js not found, skipping');
    return;
  }

  let content = fs.readFileSync(babelPath, 'utf8');
  const original = content;

  // Already fixed?
  if (!content.includes('"react-native-worklets/plugin"')) {
    return;
  }

  // Pattern 1: comment + plugin lines (exact match)
  const pattern1 = /(\r?\n)\s*\/\/ Use this plugin in reanimated 4 and later\r?\n\s*"react-native-worklets\/plugin",?\r?\n(?=\s*\])/;
  content = content.replace(
    pattern1,
    '$1      // react-native-worklets/plugin removed - requires New Architecture$1'
  );

  // Pattern 2: fallback - just the plugin line
  if (content === original) {
    const pattern2 = /(\r?\n)\s*"react-native-worklets\/plugin",?\r?\n(?=\s*\])/;
    content = content.replace(pattern2, '$1');
  }

  // Pattern 3: last resort - any line containing the plugin
  if (content === original) {
    content = content.replace(/\s*"react-native-worklets\/plugin",?\r?\n?/g, '');
  }

  if (content.includes('"react-native-worklets/plugin"')) {
    console.warn('fix-css-interop: Could not remove worklets plugin. Build may fail.');
    console.warn('babel.js snippet:', original.slice(0, 500));
    return;
  }

  fs.writeFileSync(babelPath, content);
}

try {
  main();
} catch (e) {
  console.warn('fix-css-interop: Error (continuing):', e.message);
}
