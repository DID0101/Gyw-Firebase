#!/usr/bin/env node
/** Patch Expo/RN gradle plugins to prefer android/local-maven-repo (TLS workaround). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const localMavenSnippet = `  maven {
    url = uri(File(rootDir, "../../../../android/local-maven-repo"))
  }`;

function patchFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('local-maven-repo')) return false;
  const reposMatch = src.match(/repositories\s*\{([^}]*)\}/s);
  if (!reposMatch) return false;
  const block = reposMatch[0];
  const next = block.replace(/repositories\s*\{/, `repositories {\n${localMavenSnippet}`);
  src = src.replace(block, next);
  fs.writeFileSync(file, src);
  return true;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'node_modules' && dir !== root) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name.endsWith('-gradle-plugin') || name === 'expo-gradle-plugin') acc.push(p);
      walk(p, acc);
    }
  }
  return acc;
}

const dirs = walk(root);
let count = 0;
for (const dir of dirs) {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && patchFile(file)) {
      console.log('patched', path.relative(root, file));
      count++;
    }
  }
}
console.log(`Done. Patched ${count} file(s).`);
