#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  buildAshaGamePublishAssetManifest,
  parseAshaGameManifestToml,
  resolveAshaGameAssetForDev,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = join(repoRoot, 'asha.game.toml');
const catalogPath = join(repoRoot, 'packages/game-catalogs/catalog.json');
const failures = [];

function fail(message) {
  failures.push(message);
}

const manifestResult = parseAshaGameManifestToml(readFileSync(manifestPath, 'utf8'));
if (!manifestResult.ok) {
  for (const diagnostic of manifestResult.diagnostics) fail(`${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
} else {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const validation = validateAshaGameAssetCatalog(
    catalog,
    manifestResult.manifest,
    (assetPath) => existsSync(join(repoRoot, assetPath)),
  );
  if (!validation.ok) {
    for (const diagnostic of validation.diagnostics) fail(`${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
  } else {
    const publishManifest = buildAshaGamePublishAssetManifest(validation.catalog);
    for (const assetId of ['mesh.demo-cube', 'material.demo-copper', 'texture.demo-checker']) {
      const resolution = resolveAshaGameAssetForDev(validation.catalog, assetId);
      if (resolution === null) {
        fail(`${assetId} did not resolve through the catalog`);
      } else if (!existsSync(join(repoRoot, resolution.sourcePath))) {
        fail(`resolved source file is missing: ${resolution.sourcePath}`);
      }
      if (!publishManifest.entries.some((entry) => entry.assetId === assetId)) {
        fail(`publish asset manifest does not include ${assetId}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('asha-demo asset catalog check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-demo asset catalog check: OK');
