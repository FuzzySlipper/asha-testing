#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeGameRuntimeLauncher } from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/publish-backend-run-smoke/latest');
const smokePath = path.join(outDir, 'index.json');
const artifactPath = path.join(repoRoot, 'harness/out/publish/latest/index.json');

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function readJsonWithHash(relativePath) {
  const text = await readText(relativePath);
  return { text, hash: sha256(text), json: JSON.parse(text) };
}

if (!existsSync(artifactPath)) {
  throw new Error('publish artifact is missing; run npm run publish:artifact first');
}

const artifactText = await readFile(artifactPath, 'utf8');
const artifact = JSON.parse(artifactText);
assert.equal(artifact.runtimeBackedArtifact.target, 'asha-demo-staged-backend-native.v2');
assert.equal(artifact.runtimeBackedArtifact.backendMode, 'native');
assert.ok(artifact.runtimeBackedArtifact.backendProofRefs.length > 0, 'backend proof refs are required');

const runtimeMetadata = await readJsonWithHash(artifact.runtimeBackedArtifact.runtimeMetadataPath);
const backendProfile = await readJsonWithHash(artifact.runtimeBackedArtifact.backendProfilePath);
const moduleRef = await readJsonWithHash(artifact.runtimeBackedArtifact.moduleRefPath);
const resourceManifest = await readJsonWithHash(artifact.runtimeBackedArtifact.resourceManifestPath);
const backendReadback = await readJsonWithHash(artifact.runtimeBackedArtifact.readbackPath);

assert.equal(artifact.runtimeBackedArtifact.runtimeMetadataHash, runtimeMetadata.hash, 'runtime metadata hash is stale');
assert.equal(artifact.runtimeBackedArtifact.backendProfileHash, backendProfile.hash, 'backend profile hash is stale');
assert.equal(artifact.runtimeBackedArtifact.moduleRefHash, moduleRef.hash, 'module ref hash is stale');
assert.equal(artifact.runtimeBackedArtifact.resourceManifestHash, resourceManifest.hash, 'resource manifest hash is stale');
assert.equal(artifact.runtimeBackedArtifact.readbackHash, backendReadback.hash, 'backend readback hash is stale');
assert.equal(runtimeMetadata.json.runtimeMode, 'native', 'runtime-backed publish smoke rejects reference runtime fallback');
assert.equal(runtimeMetadata.json.launcherName, 'native-game-runtime-launcher');
assert.equal(backendProfile.json.backendMode, 'native');
assert.deepEqual(backendProfile.json.backendProofRefs, artifact.runtimeBackedArtifact.backendProofRefs);
assert.equal(moduleRef.json.kind, 'public-runtime-bridge-module-ref');
assert.equal(resourceManifest.json.target, artifact.runtimeBackedArtifact.target);
assert.equal(backendReadback.json.target, artifact.runtimeBackedArtifact.target);

const resolvedResources = [];
for (const entry of resourceManifest.json.entries) {
  assert.ok(entry.path.startsWith('resources/'), `backend resource ${entry.assetId} must stay under resources/`);
  const text = await readText(path.join(artifact.runtimeBackedArtifact.directory, entry.path));
  assert.equal(entry.packedHash, sha256(text));
  assert.equal(entry.packedBytes, Buffer.byteLength(text));
  resolvedResources.push({
    assetId: entry.assetId,
    outputKey: entry.outputKey,
    path: entry.path,
    hash: entry.packedHash,
    bytes: entry.packedBytes,
  });
}

const launcher = createNativeGameRuntimeLauncher();
const session = await launcher.launch({
  gameId: artifact.game.id,
  workspaceId: 'publish-backend-native',
  runtimeEntry: moduleRef.json.moduleRef,
  compatibility: {
    contractsPackageVersion: artifact.compatibility.contractsPackageVersion,
    runtimeBridgePackageVersion: artifact.compatibility.runtimeBridgePackageVersion,
    devtoolsProtocolVersion: artifact.compatibility.devtoolsProtocolVersion,
    publishArtifactVersion: artifact.compatibility.publishArtifactFormatVersion,
  },
  resourceProfile: {
    profileId: 'publish.backend-native.resources.v2',
    runtimeEntry: moduleRef.json.moduleRef,
    worldBundleId: `scene:${runtimeMetadata.json.world.sceneId}`,
    resourceManifestHash: artifact.runtimeBackedArtifact.resourceManifestHash,
  },
  world: runtimeMetadata.json.world,
  startedAtIso: '2026-06-28T00:00:00.000Z',
});

const projection = await session.pullProjection();
const acceptedCommand = await session.proposeCommands(backendReadback.json.commandProof.acceptedCommand.batch);
const afterAcceptedProjection = await session.pullProjection();
const rejectedCommand = await session.proposeCommands(backendReadback.json.commandProof.rejectedCommand.batch);
const afterRejectedProjection = await session.pullProjection();
let shutdown = { status: 'passed' };
try {
  await session.shutdown();
} catch (error) {
  if (error?.kind !== 'operation_unimplemented' || !String(error.message).includes('unload_world')) {
    throw error;
  }
  shutdown = {
    status: 'not_supported',
    diagnostic: 'native_unload_world_not_wired',
    nonClaim: 'not_native_unload_world_evidence',
  };
}

assert.equal(session.identity.runtimeMode, 'native');
assert.equal(session.launch.runtimeProfile.launcherName, 'native-game-runtime-launcher');
assert.equal(acceptedCommand.status, 'accepted');
assert.notEqual(acceptedCommand.authorityHashBefore, acceptedCommand.authorityHashAfter);
assert.equal(rejectedCommand.status, 'rejected');
assert.equal(rejectedCommand.authorityHashBefore, rejectedCommand.authorityHashAfter);

const smoke = {
  artifactKind: 'asha_demo_publish_backend_run_smoke',
  artifactVersion: 'publish-backend-run-smoke.v1',
  generatedAt: 'deterministic-as-structure-only',
  noDevServerRequired: true,
  sourceArtifact: {
    path: 'harness/out/publish/latest/index.json',
    fileHash: sha256(artifactText),
    artifactId: artifact.artifactId,
    artifactHash: artifact.artifactHash,
  },
  runtimeBackedArtifact: {
    target: artifact.runtimeBackedArtifact.target,
    directory: artifact.runtimeBackedArtifact.directory,
    backendMode: artifact.runtimeBackedArtifact.backendMode,
    backendProfile: artifact.runtimeBackedArtifact.backendProfile,
    backendProofRefs: artifact.runtimeBackedArtifact.backendProofRefs,
    runtimeMetadataPath: artifact.runtimeBackedArtifact.runtimeMetadataPath,
    runtimeMetadataHash: runtimeMetadata.hash,
    backendProfilePath: artifact.runtimeBackedArtifact.backendProfilePath,
    backendProfileHash: backendProfile.hash,
    moduleRefPath: artifact.runtimeBackedArtifact.moduleRefPath,
    moduleRefHash: moduleRef.hash,
    resourceManifestPath: artifact.runtimeBackedArtifact.resourceManifestPath,
    resourceManifestHash: resourceManifest.hash,
    readbackPath: artifact.runtimeBackedArtifact.readbackPath,
    readbackHash: backendReadback.hash,
  },
  runtime: {
    runtimeMode: session.identity.runtimeMode,
    launcherName: session.launch.runtimeProfile.launcherName,
    runtimeProfileId: session.launch.runtimeProfile.profileId,
    moduleRef: moduleRef.json.moduleRef,
    nonClaims: session.identity.nonClaims,
  },
  projection,
  commandProof: {
    acceptedCommand,
    rejectedCommand,
    beforeWorldHash: projection.worldHash,
    afterAcceptedWorldHash: afterAcceptedProjection.worldHash,
    afterRejectedWorldHash: afterRejectedProjection.worldHash,
  },
  shutdown,
  resolvedResources,
  checks: [
    'backend_artifact_exists_without_dev_server',
    'native_runtime_metadata_loaded',
    'backend_profile_loaded',
    'module_ref_hash_verified',
    'packed_backend_resources_resolved',
    'native_backend_projection_pulled',
    'native_backend_accepted_command_mutated_projection',
    'native_backend_rejected_command_preserved_projection',
    'reference_runtime_fallback_rejected',
    'native_unload_world_not_required_for_smoke',
  ],
  nonClaims: [
    'not_wasm_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
    'not_installer',
    'not_package_signing',
    'not_native_unload_world_evidence',
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(smokePath, `${JSON.stringify(smoke, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, smokePath)}`);
