#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASHA_GAME_WORKSPACE_COMPATIBILITY,
  buildAshaGamePublishAssetManifest,
  parseAshaGameManifestToml,
  validateAshaConsumerCompatibility,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = process.argv[2]
  ? path.resolve(repoRoot, process.argv[2])
  : path.join(repoRoot, 'harness/out/publish/latest/index.json');
const manifestPath = path.join(repoRoot, 'asha.game.toml');
const packageJsonPath = path.join(repoRoot, 'package.json');
const forbiddenPublishFragments = [
  '@asha-studio/',
  'asha-studio',
  '../asha-studio',
  'studio-game-workspace',
  'harness/out/dev-smoke',
  'harness/out/publish-smoke',
  'devtools_endpoint',
  'ws://127.0.0.1',
  'ws://localhost',
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function withoutArtifactHash(artifact) {
  const { artifactHash, artifactId, ...body } = artifact;
  void artifactHash;
  void artifactId;
  return body;
}

function fail(message) {
  console.error(`asha-demo publish artifact smoke failed: ${message}`);
  process.exit(1);
}

if (!existsSync(artifactPath)) {
  fail(`missing artifact ${path.relative(repoRoot, artifactPath)}`);
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const manifestText = await readFile(manifestPath, 'utf8');
const parsed = parseAshaGameManifestToml(manifestText);
if (!parsed.ok) fail(`manifest parse diagnostics: ${JSON.stringify(parsed.diagnostics)}`);
const compatibility = validateAshaConsumerCompatibility(parsed.manifest, ASHA_GAME_WORKSPACE_COMPATIBILITY);
if (!compatibility.ok) fail(`compatibility diagnostics: ${JSON.stringify(compatibility.diagnostics)}`);

const artifactText = await readFile(artifactPath, 'utf8');
for (const fragment of forbiddenPublishFragments) {
  if (artifactText.includes(fragment)) {
    fail(`publish artifact contains dev-only Studio/attach fragment "${fragment}"`);
  }
}
const artifact = JSON.parse(artifactText);
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
    if (name.startsWith('@asha-studio/') || String(spec).includes('asha-studio')) {
      fail(`package ${section}.${name} leaks Studio dependency into publish pipeline`);
    }
  }
}
const catalog = JSON.parse(await readFile(path.join(repoRoot, 'packages/game-catalogs/catalog.json'), 'utf8'));
const catalogValidation = validateAshaGameAssetCatalog(
  catalog,
  parsed.manifest,
  relativePath => existsSync(path.join(repoRoot, relativePath)),
  { sourceHash: relativePath => existsSync(path.join(repoRoot, relativePath)) ? sha256(readFileSync(path.join(repoRoot, relativePath))) : null },
);
if (!catalogValidation.ok) fail(`catalog diagnostics: ${JSON.stringify(catalogValidation.diagnostics)}`);

const expectedPublishAssets = buildAshaGamePublishAssetManifest(catalog);
const recomputedHash = sha256(stableJson(withoutArtifactHash(artifact)));

assert.equal(artifact.artifactKind, 'asha_demo_publish_artifact');
assert.equal(artifact.artifactVersion, parsed.manifest.asha.publishArtifactFormatVersion);
assert.equal(artifact.game.id, packageJson.name);
assert.equal(artifact.game.version, packageJson.version);
assert.equal(artifact.compatibility.devtoolsProtocolVersion, parsed.manifest.asha.devtoolsProtocolVersion);
assert.equal(artifact.compatibility.publishArtifactFormatVersion, parsed.manifest.asha.publishArtifactFormatVersion);
assert.equal(artifact.sourceManifest.hash, sha256(manifestText));
assert.deepEqual(artifact.publishAssets, expectedPublishAssets);
assert.equal(artifact.artifactHash, recomputedHash);
assert.equal(artifact.artifactId, `asha-demo-publish:${artifact.artifactHash}`);
assert.equal(artifact.resourcePack.entryCount, artifact.publishAssets.entries.length);
const resourcePackManifestText = await readFile(path.join(repoRoot, artifact.resourcePack.manifestPath), 'utf8');
assert.equal(artifact.resourcePack.manifestHash, sha256(resourcePackManifestText));
const resourcePackManifest = JSON.parse(resourcePackManifestText);
assert.deepEqual(resourcePackManifest.dependencyOrder, artifact.publishAssets.dependencyOrder);
assert.equal(resourcePackManifest.entries.length, artifact.resourcePack.entryCount);
const entrypointText = await readFile(path.join(repoRoot, artifact.runnableArtifact.entrypointPath), 'utf8');
const runtimeMetadataText = await readFile(path.join(repoRoot, artifact.runnableArtifact.runtimeMetadataPath), 'utf8');
const runnableResourceManifestText = await readFile(path.join(repoRoot, artifact.runnableArtifact.resourceManifestPath), 'utf8');
assert.equal(artifact.runnableArtifact.target, 'asha-demo-static-reference.v1');
assert.equal(artifact.runnableArtifact.entrypointHash, sha256(entrypointText));
assert.equal(artifact.runnableArtifact.runtimeMetadataHash, sha256(runtimeMetadataText));
assert.equal(artifact.runnableArtifact.resourceManifestHash, sha256(runnableResourceManifestText));
assert.match(entrypointText, /data-runtime-mode="reference"/);
assert.match(entrypointText, /resources\/manifest\.json/);
assert.match(entrypointText, /runtime\/reference-runtime\.json/);
const runtimeMetadata = JSON.parse(runtimeMetadataText);
assert.equal(runtimeMetadata.runtimeMode, 'reference');
assert.equal(runtimeMetadata.launcherName, 'reference-game-runtime-launcher');
const runnableResourceManifest = JSON.parse(runnableResourceManifestText);
assert.equal(runnableResourceManifest.target, 'asha-demo-static-reference.v1');
assert.deepEqual(runnableResourceManifest.dependencyOrder, artifact.publishAssets.dependencyOrder);
assert.equal(runnableResourceManifest.entries.length, artifact.runnableArtifact.resourceEntryCount);
assert.deepEqual(artifact.nonClaims, [
  'not_native_runtime_authority',
  'not_hardware_gpu_evidence',
  'not_performance_evidence',
  'not_store_submission',
]);

for (const entry of artifact.publishAssets.entries) {
  const compiled = artifact.compiledAssets.find(candidate => candidate.assetId === entry.assetId);
  assert.ok(compiled, `compiled asset missing for ${entry.assetId}`);
  assert.equal(compiled.kind, entry.kind);
  assert.equal(compiled.sourcePath, entry.sourcePath);
  assert.equal(compiled.outputKey, entry.outputKey);
  const sourceText = await readFile(path.join(repoRoot, entry.sourcePath), 'utf8');
  assert.equal(compiled.sourceHash, sha256(sourceText));
  assert.equal(compiled.devImport.importStatus, 'clean');
  assert.equal(compiled.devImport.generatedArtifactVersion, 'asset-import.v1');
  assert.deepEqual(compiled.payload, JSON.parse(sourceText));
  const packed = artifact.resourcePack.entries.find(candidate => candidate.assetId === entry.assetId);
  assert.ok(packed, `resource pack entry missing for ${entry.assetId}`);
  assert.equal(packed.outputKey, entry.outputKey);
  const packedText = await readFile(path.join(repoRoot, packed.packedPath), 'utf8');
  assert.equal(packed.packedHash, sha256(packedText));
  assert.equal(packed.packedBytes, Buffer.byteLength(packedText));
  assert.deepEqual(JSON.parse(packedText), compiled.payload);
  const runnablePacked = runnableResourceManifest.entries.find(candidate => candidate.assetId === entry.assetId);
  assert.ok(runnablePacked, `runnable resource entry missing for ${entry.assetId}`);
  const runnablePackedText = await readFile(path.join(repoRoot, artifact.runnableArtifact.directory, runnablePacked.path), 'utf8');
  assert.equal(runnablePacked.hash, sha256(runnablePackedText));
  assert.equal(runnablePacked.bytes, Buffer.byteLength(runnablePackedText));
  assert.deepEqual(JSON.parse(runnablePackedText), compiled.payload);
}

const summary = {
  status: 'ok',
  artifactPath: path.relative(repoRoot, artifactPath),
  artifactHash: artifact.artifactHash,
  publishDependencyGuard: 'no-studio-dev-only-fragments',
  sceneCount: artifact.scenes.length,
  catalogCount: artifact.catalogs.length,
  compiledAssetCount: artifact.compiledAssets.length,
  publishAssetCount: artifact.publishAssets.entries.length,
};

console.log(JSON.stringify(summary));
