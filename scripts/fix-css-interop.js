#!/usr/bin/env node
/**
 * Patches for react-native-css-interop (NativeWind):
 * 1) Remove react-native-worklets/plugin from babel.js (requires New Architecture).
 * 2) Fix dist/metro/index.js ensureFileSystemPatched for Metro/Expo 53+ where
 *    graph._fileSystem or getSha1 may be missing — published dist lags behind src.
 * Never exits 1 - allows build to continue if a fix does not apply.
 */
const fs = require('fs');
const path = require('path');

/** Matches compiled output style in react-native-css-interop/dist/metro/index.js */
const SAFE_ENSURE_FILE_SYSTEM = `function ensureFileSystemPatched(fs) {
    var getSha1Any = fs && fs.getSha1;
    if (!getSha1Any || typeof getSha1Any !== "function")
        return fs;
    if (!getSha1Any.__css_interop_patched) {
        var original_getSha1 = getSha1Any.bind(fs);
        fs.getSha1 = function (filename) {
            if (virtualModules.has(filename)) {
                return "".concat(filename, "-").concat(Date.now());
            }
            return original_getSha1(filename);
        };
        getSha1Any.__css_interop_patched = true;
    }
    return fs;
}`;

function patchBabel() {
  const babelPath = path.join(__dirname, '..', 'node_modules', 'react-native-css-interop', 'babel.js');
  if (!fs.existsSync(babelPath)) {
    console.warn('fix-css-interop: babel.js not found, skipping worklets patch');
    return;
  }

  let content = fs.readFileSync(babelPath, 'utf8');
  const original = content;

  if (!content.includes('"react-native-worklets/plugin"')) {
    return;
  }

  const pattern1 = /(\r?\n)\s*\/\/ Use this plugin in reanimated 4 and later\r?\n\s*"react-native-worklets\/plugin",?\r?\n(?=\s*\])/;
  content = content.replace(
    pattern1,
    '$1      // react-native-worklets/plugin removed - requires New Architecture$1',
  );

  if (content === original) {
    const pattern2 = /(\r?\n)\s*"react-native-worklets\/plugin",?\r?\n(?=\s*\])/;
    content = content.replace(pattern2, '$1');
  }

  if (content === original) {
    content = content.replace(/\s*"react-native-worklets\/plugin",?\r?\n?/g, '');
  }

  if (content.includes('"react-native-worklets/plugin"')) {
    console.warn('fix-css-interop: Could not remove worklets plugin. Build may fail.');
    return;
  }

  fs.writeFileSync(babelPath, content);
}

function patchMetroEnsureFileSystem() {
  const metroPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'react-native-css-interop',
    'dist',
    'metro',
    'index.js',
  );
  if (!fs.existsSync(metroPath)) {
    console.warn('fix-css-interop: dist/metro/index.js not found, skipping Metro patch');
    return;
  }

  let content = fs.readFileSync(metroPath, 'utf8');

  if (content.includes('var getSha1Any = fs && fs.getSha1')) {
    return;
  }

  const startMark = 'function ensureFileSystemPatched(fs) {';
  const endMark = '\nfunction ensureBundlerPatched';
  const startIdx = content.indexOf(startMark);
  const endIdx = content.indexOf(endMark, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    console.warn('fix-css-interop: could not locate ensureFileSystemPatched in dist/metro/index.js');
    return;
  }

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx);
  content = before + SAFE_ENSURE_FILE_SYSTEM + after;

  fs.writeFileSync(metroPath, content);
}

try {
  patchBabel();
  patchMetroEnsureFileSystem();
} catch (e) {
  console.warn('fix-css-interop: Error (continuing):', e.message);
}
