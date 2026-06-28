#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import {
  ASHA_GAME_WORKSPACE_COMPATIBILITY,
  parseAshaGameManifestToml,
  validateAshaConsumerCompatibility,
} from '@asha/game-workspace';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = join(repoRoot, 'asha.game.toml');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function ensureInsideRepo(pathValue, context) {
  if (isAbsolute(pathValue) || pathValue.split('/').includes('..')) {
    fail(`${context} must stay inside the demo workspace: ${pathValue}`);
    return null;
  }
  const resolved = resolve(repoRoot, pathValue);
  const rel = relative(repoRoot, resolved);
  if (rel.startsWith('..')) {
    fail(`${context} resolves outside the demo workspace: ${pathValue}`);
    return null;
  }
  return resolved;
}

function ensurePathExists(pathValue, context) {
  const resolved = ensureInsideRepo(pathValue, context);
  if (resolved !== null && !existsSync(resolved)) {
    fail(`${context} does not exist: ${normalize(pathValue)}`);
  }
}

function ensureCommandExists(command, context) {
  const match = /^npm run ([A-Za-z0-9:_-]+)$/.exec(command);
  if (!match) {
    fail(`${context} must be an npm run script command: ${command}`);
    return;
  }
  const scriptName = match[1];
  if (typeof packageJson.scripts?.[scriptName] !== 'string') {
    fail(`${context} references missing package script: ${scriptName}`);
  }
}

if (!existsSync(manifestPath)) {
  fail('missing asha.game.toml');
} else {
  const parsed = parseAshaGameManifestToml(readFileSync(manifestPath, 'utf8'));
  if (!parsed.ok) {
    for (const diagnostic of parsed.diagnostics) {
      fail(`${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
    }
  } else {
    const compatibility = validateAshaConsumerCompatibility(parsed.manifest, ASHA_GAME_WORKSPACE_COMPATIBILITY);
    if (!compatibility.ok) {
      for (const diagnostic of compatibility.diagnostics) {
        fail(`${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
      }
    }

    for (const root of parsed.manifest.workspace.sceneRoots) ensurePathExists(root, 'workspace.scene_roots');
    for (const root of parsed.manifest.workspace.assetRoots) ensurePathExists(root, 'workspace.asset_roots');
    for (const root of parsed.manifest.workspace.replayRoots) ensurePathExists(root, 'workspace.replay_roots');
    for (const root of parsed.manifest.workspace.catalogPackages) ensurePathExists(root, 'workspace.catalog_packages');
    for (const root of parsed.manifest.workspace.policyPackages) ensurePathExists(root, 'workspace.policy_packages');
    ensurePathExists(parsed.manifest.runtime.wasmOrNativeEntry, 'runtime.wasm_or_native_entry');
    ensurePathExists(parsed.manifest.publish.artifactDir, 'publish.artifact_dir');
    ensureCommandExists(parsed.manifest.runtime.devCommand, 'runtime.dev_command');
    ensureCommandExists(parsed.manifest.publish.command, 'publish.command');
    ensureCommandExists(parsed.manifest.publish.verifyCommand, 'publish.verify_command');
  }
}

if (failures.length > 0) {
  console.error('asha-demo manifest check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-demo manifest check: OK');
