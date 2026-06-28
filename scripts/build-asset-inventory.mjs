#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  buildAshaGamePublishAssetManifest,
  parseAshaGameManifestToml,
  resolveAshaGameAssetForDev,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const catalogPath = process.argv[2] ?? 'packages/game-catalogs/catalog.json';
const outDir = join(repoRoot, 'harness/out/asset-inventory/latest');
const artifactPath = join(outDir, 'index.json');

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fileHash(relativePath) {
  const fullPath = join(repoRoot, relativePath);
  return existsSync(fullPath) ? sha256(readFileSync(fullPath)) : null;
}

function fileSize(relativePath) {
  const fullPath = join(repoRoot, relativePath);
  return existsSync(fullPath) ? statSync(fullPath).size : null;
}

const manifestText = readFileSync(join(repoRoot, 'asha.game.toml'), 'utf8');
const manifestResult = parseAshaGameManifestToml(manifestText);
if (!manifestResult.ok) {
  console.error('asha-demo asset inventory failed: manifest did not parse');
  for (const diagnostic of manifestResult.diagnostics) console.error(`- ${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`);
  process.exit(1);
}

const catalogText = readFileSync(join(repoRoot, catalogPath), 'utf8');
const catalog = JSON.parse(catalogText);
const validation = validateAshaGameAssetCatalog(
  catalog,
  manifestResult.manifest,
  (assetPath) => existsSync(join(repoRoot, assetPath)),
  { sourceHash: fileHash },
);
const publishManifest = buildAshaGamePublishAssetManifest(catalog);
const packEntries = new Map(publishManifest.entries.map((entry) => [entry.assetId, {
  outputKey: entry.outputKey,
  packedPath: join(manifestResult.manifest.publishResourceProfile.outputDir, entry.outputKey),
}]));

const entries = catalog.entries.map((entry) => {
  const observedHash = fileHash(entry.source);
  const dev = resolveAshaGameAssetForDev(catalog, entry.id, observedHash);
  const pack = packEntries.get(entry.id) ?? null;
  return {
    assetId: entry.id,
    kind: entry.kind,
    sourcePath: entry.source,
    dependencies: entry.dependencies ?? [],
    devResolution: dev,
    publishResolution: pack === null ? null : {
      outputKey: pack.outputKey,
      packedPath: pack.packedPath,
      packedHash: fileHash(pack.packedPath),
      packedBytes: fileSize(pack.packedPath),
    },
    diagnostics: validation.ok ? [] : validation.diagnostics.filter((diagnostic) => diagnostic.message.includes(`"${entry.id}"`) || diagnostic.path.startsWith(`entries[${catalog.entries.indexOf(entry)}]`)),
    evidenceRefs: [
      { kind: 'source', path: entry.source, sha256: observedHash },
      ...(pack === null ? [] : [{ kind: 'packed-resource', path: pack.packedPath, sha256: fileHash(pack.packedPath) }]),
    ],
  };
});

const body = {
  artifactKind: 'asha_demo_asset_inventory',
  artifactVersion: 'asset-inventory.v1',
  generatedAt: 'deterministic-as-structure-only',
  sourceManifest: {
    path: 'asha.game.toml',
    hash: sha256(manifestText),
  },
  catalog: {
    path: catalogPath,
    hash: sha256(catalogText),
  },
  status: validation.ok ? 'ok' : 'diagnostics',
  diagnostics: validation.ok ? [] : validation.diagnostics,
  dependencyOrder: publishManifest.dependencyOrder,
  entries,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(body, null, 2)}\n`);
console.log(`wrote ${artifactPath.replace(`${repoRoot}/`, '')}`);
