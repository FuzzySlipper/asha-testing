#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
const forbiddenBackendFragments = [
  '@asha/native-bridge',
  'native-bridge.node',
  '@asha/wasm-replay-bridge',
  'engine-rs/',
  '/engine-rs',
  '/src/',
  'reference-game-runtime-launcher',
  'asha-demo-static-reference.v1',
  '"runtimeMode": "reference"',
  'devtools_endpoint',
  'ws://127.0.0.1',
  'ws://localhost',
  'call(methodName',
  '"methodName"',
  '"commandJson"',
  '"arbitraryJson"',
  '"jsonRpc"',
  '"call":',
];
const forbiddenRunnableResourcePrefixes = ['assets/', 'scenes/', 'packages/game-catalogs/', 'packages/game-policy/', 'replays/'];

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
  console.error(`asha-testing publish artifact smoke failed: ${message}`);
  process.exit(1);
}

function walkFiles(root) {
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  }
  walk(root);
  return files;
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
const runnableResourceManifest = JSON.parse(runnableResourceManifestText);
for (const entry of runnableResourceManifest.entries ?? []) {
  for (const prefix of forbiddenRunnableResourcePrefixes) {
    assert.ok(!entry.path.startsWith(prefix), `runnable resource ${entry.assetId} reads dev-local source root via ${entry.path}`);
  }
}
const runnableFiles = walkFiles(path.join(repoRoot, artifact.runnableArtifact.directory));
for (const file of runnableFiles) {
  const text = await readFile(file, 'utf8');
  for (const fragment of forbiddenPublishFragments) {
    if (text.includes(fragment)) {
      fail(`runnable artifact file ${path.relative(repoRoot, file)} contains forbidden fragment "${fragment}"`);
    }
  }
}
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
assert.equal(runnableResourceManifest.target, 'asha-demo-static-reference.v1');
assert.deepEqual(runnableResourceManifest.dependencyOrder, artifact.publishAssets.dependencyOrder);
assert.equal(runnableResourceManifest.entries.length, artifact.runnableArtifact.resourceEntryCount);
assert.deepEqual(artifact.nonClaims, [
  'not_native_runtime_authority',
  'not_hardware_gpu_evidence',
  'not_performance_evidence',
  'not_store_submission',
]);
assert.equal(artifact.runtimeBackedArtifact.target, 'asha-demo-staged-backend-native.v2');
assert.equal(artifact.runtimeBackedArtifact.backendMode, 'native');
assert.equal(artifact.runtimeBackedArtifact.backendProfile, parsed.manifest.runtime.backendProfile);
assert.deepEqual(
  artifact.runtimeBackedArtifact.backendProofRefs,
  parsed.manifest.runtime.backendProofRefs,
  'runtime-backed artifact backend proof refs must match manifest backend proof refs',
);
assert.ok(artifact.runtimeBackedArtifact.backendProofRefs.length > 0, 'runtime-backed artifact requires backend proof refs');
const backendReadbackText = await readFile(path.join(repoRoot, artifact.runtimeBackedArtifact.readbackPath), 'utf8');
const backendRuntimeMetadataText = await readFile(path.join(repoRoot, artifact.runtimeBackedArtifact.runtimeMetadataPath), 'utf8');
const backendProfileText = await readFile(path.join(repoRoot, artifact.runtimeBackedArtifact.backendProfilePath), 'utf8');
const moduleRefText = await readFile(path.join(repoRoot, artifact.runtimeBackedArtifact.moduleRefPath), 'utf8');
const backendResourceManifestText = await readFile(path.join(repoRoot, artifact.runtimeBackedArtifact.resourceManifestPath), 'utf8');
assert.equal(artifact.runtimeBackedArtifact.readbackHash, sha256(backendReadbackText));
assert.equal(artifact.runtimeBackedArtifact.runtimeMetadataHash, sha256(backendRuntimeMetadataText), 'runtime-backed runtime metadata hash is stale');
assert.equal(artifact.runtimeBackedArtifact.backendProfileHash, sha256(backendProfileText), 'runtime-backed backend profile hash is stale');
assert.equal(artifact.runtimeBackedArtifact.moduleRefHash, sha256(moduleRefText), 'runtime-backed module ref hash is stale');
assert.equal(artifact.runtimeBackedArtifact.resourceManifestHash, sha256(backendResourceManifestText), 'runtime-backed resource manifest hash is stale');
const backendReadback = JSON.parse(backendReadbackText);
const backendRuntimeMetadata = JSON.parse(backendRuntimeMetadataText);
const backendProfileReadback = JSON.parse(backendProfileText);
const moduleRefReadback = JSON.parse(moduleRefText);
const backendResourceManifest = JSON.parse(backendResourceManifestText);
assert.equal(backendReadback.target, 'asha-demo-staged-backend-native.v2');
assert.equal(backendReadback.runtimeMetadataHash, artifact.runtimeBackedArtifact.runtimeMetadataHash);
assert.equal(backendReadback.backendProfileHash, artifact.runtimeBackedArtifact.backendProfileHash);
assert.equal(backendReadback.moduleRefHash, artifact.runtimeBackedArtifact.moduleRefHash);
assert.equal(backendRuntimeMetadata.runtimeMode, 'native');
assert.equal(backendRuntimeMetadata.launcherName, 'native-game-runtime-launcher');
assert.equal(backendRuntimeMetadata.world.bundleSchemaVersion, 1);
assert.equal(backendRuntimeMetadata.world.protocolVersion, 1);
assert.equal(typeof backendRuntimeMetadata.world.sceneId, 'number');
assert.equal(backendProfileReadback.backendMode, 'native');
assert.deepEqual(
  backendProfileReadback.backendProofRefs,
  parsed.manifest.runtime.backendProofRefs,
  'runtime-backed profile backend proof refs must match manifest backend proof refs',
);
assert.equal(moduleRefReadback.kind, 'public-runtime-bridge-module-ref');
assert.equal(moduleRefReadback.moduleRef, parsed.manifest.runtime.wasmOrNativeEntry);
assert.equal(
  moduleRefReadback.moduleRefHash,
  sha256(readFileSync(path.join(repoRoot, parsed.manifest.runtime.wasmOrNativeEntry), 'utf8')),
  'runtime-backed module file hash is stale',
);
assert.equal(backendResourceManifest.target, 'asha-demo-staged-backend-native.v2');
assert.deepEqual(backendResourceManifest.dependencyOrder, artifact.publishAssets.dependencyOrder);
assert.equal(backendResourceManifest.entries.length, artifact.runtimeBackedArtifact.resourceEntryCount);
assert.equal(backendReadback.resourceManifestHash, artifact.runtimeBackedArtifact.resourceManifestHash);
assert.deepEqual(backendReadback.evidenceRefs.map(ref => ref.kind), [
  'backend-authority-smoke',
  'dev-runtime-command-evidence',
  'publish-artifact',
  'publish-smoke',
  'dependency-guard',
]);
assert.deepEqual(backendReadback.nonClaims, [
  'not_wasm_authority',
  'not_hardware_gpu_evidence',
  'not_performance_evidence',
  'not_store_submission',
  'not_installer',
  'not_package_signing',
  'not_private_runtime_transport',
]);
for (const ref of backendReadback.evidenceRefs) {
  const text = await readFile(path.join(repoRoot, ref.path), 'utf8');
  assert.equal(ref.sha256, sha256(text), `${ref.kind} evidence ref is stale`);
}
const backendFiles = walkFiles(path.join(repoRoot, artifact.runtimeBackedArtifact.directory));
for (const file of backendFiles) {
  const text = await readFile(file, 'utf8');
  for (const fragment of forbiddenBackendFragments) {
    if (text.includes(fragment)) {
      fail(`runtime-backed artifact file ${path.relative(repoRoot, file)} contains forbidden fragment "${fragment}"`);
    }
  }
}

const packedResources = [];
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
  assert.equal(runnablePacked.outputKey, entry.outputKey);
  for (const prefix of forbiddenRunnableResourcePrefixes) {
    assert.ok(!runnablePacked.path.startsWith(prefix), `runnable resource ${entry.assetId} reads dev-local source root via ${runnablePacked.path}`);
  }
  const runnablePackedText = await readFile(path.join(repoRoot, artifact.runnableArtifact.directory, runnablePacked.path), 'utf8');
  assert.equal(runnablePacked.hash, sha256(runnablePackedText));
  assert.equal(runnablePacked.bytes, Buffer.byteLength(runnablePackedText));
  assert.deepEqual(JSON.parse(runnablePackedText), compiled.payload);
  packedResources.push({
    assetId: entry.assetId,
    outputKey: entry.outputKey,
    sourceHash: compiled.sourceHash,
    packedHash: packed.packedHash,
    runnableHash: runnablePacked.hash,
  });
}
for (const entry of backendResourceManifest.entries) {
  assert.ok(entry.path.startsWith('resources/'), `runtime-backed resource ${entry.assetId} must stay under resources/ via ${entry.path}`);
  assert.equal(path.normalize(entry.path), entry.path, `runtime-backed resource ${entry.assetId} uses non-normalized path ${entry.path}`);
  assert.ok(!entry.path.includes('..'), `runtime-backed resource ${entry.assetId} escapes artifact directory via ${entry.path}`);
  for (const prefix of forbiddenRunnableResourcePrefixes) {
    assert.ok(!entry.path.startsWith(prefix), `runtime-backed resource ${entry.assetId} reads dev-local source root via ${entry.path}`);
  }
  const packedText = await readFile(path.join(repoRoot, artifact.runtimeBackedArtifact.directory, entry.path), 'utf8');
  assert.equal(entry.packedHash, sha256(packedText));
  assert.equal(entry.packedBytes, Buffer.byteLength(packedText));
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
  packedResourceProfile: {
    outputDir: 'publish_resource_profile.output_dir',
    runnableDirectory: artifact.runnableArtifact.directory,
    resourceManifestPath: artifact.runnableArtifact.resourceManifestPath,
    runtimeBackedDirectory: artifact.runtimeBackedArtifact.directory,
    runtimeBackedManifestPath: artifact.runtimeBackedArtifact.resourceManifestPath,
  },
  runtimeBackedArtifact: {
    target: artifact.runtimeBackedArtifact.target,
    backendMode: artifact.runtimeBackedArtifact.backendMode,
    backendProfile: artifact.runtimeBackedArtifact.backendProfile,
    backendProofRefs: artifact.runtimeBackedArtifact.backendProofRefs,
    readbackPath: artifact.runtimeBackedArtifact.readbackPath,
    readbackHash: artifact.runtimeBackedArtifact.readbackHash,
    runtimeMetadataPath: artifact.runtimeBackedArtifact.runtimeMetadataPath,
    resourceManifestPath: artifact.runtimeBackedArtifact.resourceManifestPath,
  },
  packedResources,
  dependencyGuard: {
    inspectedRunnableFiles: runnableFiles.map((file) => path.relative(repoRoot, file)),
    inspectedBackendFiles: backendFiles.map((file) => path.relative(repoRoot, file)),
    forbiddenFragments: forbiddenPublishFragments,
    forbiddenBackendFragments,
  },
};

console.log(JSON.stringify(summary));
