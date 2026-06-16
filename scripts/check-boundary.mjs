#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const allowedAshaPackages = new Set(['@asha/contracts', '@asha/runtime-bridge']);
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = packageJson[section] ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    if (name.startsWith('@asha/') && !allowedAshaPackages.has(name)) {
      fail(`${section}.${name} is not an approved asha-demo Tier 1 dependency`);
    }
    if (typeof spec === 'string' && /\.\.\/asha\/.+\/src\//.test(spec)) {
      fail(`${section}.${name} points at an ASHA source internals path: ${spec}`);
    }
  }
}

const scanRoots = ['scripts', 'tests', 'src', 'harness'];
const scannedExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json']);
const forbiddenAshaPackages = new Set([
  '@asha/native-bridge',
  '@asha/wasm-replay-bridge',
  '@asha/app',
  '@asha/electron-main',
  '@asha/ui-dom',
  '@asha/devtools',
  '@asha/policy-core',
  '@asha/policy-examples',
  '@asha/script-host',
  '@asha/catalog-examples',
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') continue;
      files.push(...walk(full));
    } else if (scannedExtensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

for (const root of scanRoots) {
  for (const file of walk(path.join(repoRoot, root))) {
    const rel = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    const importPattern = /(?:from\s+|import\s*\(|import\s+|require\s*\()["']([^"']+)["']/g;
    for (const match of text.matchAll(importPattern)) {
      const spec = match[1];
      if (spec?.startsWith('@asha/') && !allowedAshaPackages.has(spec)) {
        fail(`${rel} imports non-approved ASHA package ${spec}`);
      }
      if (spec && forbiddenAshaPackages.has(spec)) {
        fail(`${rel} imports forbidden ASHA package ${spec}`);
      }
      if (spec && /\.\.\/asha\/.+\/src\//.test(spec)) {
        fail(`${rel} imports ASHA internals by source path: ${spec}`);
      }
      if (spec && /ts\/packages\/contracts\/src\/generated/.test(spec)) {
        fail(`${rel} imports generated contracts by file path: ${spec}`);
      }
      if (spec && /engine-rs\/crates\/.+\/src\//.test(spec)) {
        fail(`${rel} imports ASHA Rust crate internals by source path: ${spec}`);
      }
    }
    if (/call\s*\(\s*["'`]methodName/.test(text) || /methodName\s*,\s*json/.test(text)) {
      fail(`${rel} appears to introduce a generic methodName/json runtime tunnel`);
    }
  }
}

if (failures.length > 0) {
  console.error('asha-demo boundary check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-demo boundary check: OK');
