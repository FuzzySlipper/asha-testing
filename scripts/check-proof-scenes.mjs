#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  parseAshaGameManifestToml,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf8'));
}

function sceneFilesForRoot(root) {
  return readdirSync(join(repoRoot, root))
    .filter((name) => name.endsWith('.scene.json'))
    .sort()
    .map((name) => `${root}/${name}`);
}

const manifestResult = parseAshaGameManifestToml(readFileSync(join(repoRoot, 'asha.game.toml'), 'utf8'));
if (!manifestResult.ok) {
  for (const diagnostic of manifestResult.diagnostics) fail(`${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
} else {
  const catalog = readJson('packages/game-catalogs/catalog.json');
  const catalogValidation = validateAshaGameAssetCatalog(
    catalog,
    manifestResult.manifest,
    (assetPath) => existsSync(join(repoRoot, assetPath)),
  );
  if (!catalogValidation.ok) {
    for (const diagnostic of catalogValidation.diagnostics) fail(`${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
  } else {
    const catalogIds = new Set(catalogValidation.catalog.entries.map((entry) => entry.id));
    const scenes = manifestResult.manifest.workspace.sceneRoots.flatMap(sceneFilesForRoot).map((path) => ({ path, scene: readJson(path) }));
    if (scenes.length === 0) fail('no proof scenes found');
    for (const { path, scene } of scenes) {
      if (scene.schemaVersion !== 1) fail(`${path} has unsupported schemaVersion`);
      if (typeof scene.name !== 'string' || scene.name.length === 0) fail(`${path} is missing a name`);
      if (!Array.isArray(scene.catalogAssetIds) || scene.catalogAssetIds.length === 0) fail(`${path} has no catalogAssetIds`);
      for (const assetId of scene.catalogAssetIds ?? []) {
        if (!catalogIds.has(assetId)) fail(`${path} references missing catalog asset ${assetId}`);
      }
    }
    const materialProof = scenes.find(({ scene }) => scene.name === 'ASHA Demo Material Proof');
    if (materialProof === undefined) {
      fail('missing named material proof scene');
    } else {
      for (const assetId of ['mesh.demo-cube', 'material.demo-copper', 'texture.demo-checker']) {
        if (!materialProof.scene.catalogAssetIds.includes(assetId)) fail(`material proof scene does not include ${assetId}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('asha-demo proof scene check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-demo proof scene check: OK');
