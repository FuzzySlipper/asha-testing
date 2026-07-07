#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReferenceGameRuntimeLauncher } from '@asha/runtime-bridge/reference';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/publish-run-smoke/latest');
const smokePath = path.join(outDir, 'index.json');
const artifactPath = path.join(repoRoot, 'harness/out/publish/latest/index.json');

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

if (!existsSync(artifactPath)) {
  throw new Error('publish artifact is missing; run npm run publish:artifact first');
}

const artifactText = await readFile(artifactPath, 'utf8');
const artifact = JSON.parse(artifactText);
const entrypointText = await readText(artifact.runnableArtifact.entrypointPath);
assert.match(entrypointText, /asha-demo-static-reference\.v1/);
assert.match(entrypointText, /data-runtime-mode="reference"/);
assert.ok(!entrypointText.includes('ws://'), 'runnable entrypoint must not reference a devtools endpoint');
assert.ok(!entrypointText.includes('devtools_endpoint'), 'runnable entrypoint must not reference devtools manifest fields');

const runtimeMetadataText = await readText(artifact.runnableArtifact.runtimeMetadataPath);
assert.equal(artifact.runnableArtifact.runtimeMetadataHash, sha256(runtimeMetadataText));
const runtimeMetadata = JSON.parse(runtimeMetadataText);
assert.equal(runtimeMetadata.runtimeMode, 'reference');

const resourceManifestText = await readText(artifact.runnableArtifact.resourceManifestPath);
assert.equal(artifact.runnableArtifact.resourceManifestHash, sha256(resourceManifestText));
const resourceManifest = JSON.parse(resourceManifestText);
assert.equal(resourceManifest.target, 'asha-demo-static-reference.v1');
assert.equal(resourceManifest.entries.length, artifact.runnableArtifact.resourceEntryCount);

const resolvedResources = [];
for (const entry of resourceManifest.entries) {
  assert.ok(!entry.path.startsWith('assets/'), `runnable resource reads dev source root: ${entry.path}`);
  const resourceText = await readText(path.join(artifact.runnableArtifact.directory, entry.path));
  assert.equal(entry.hash, sha256(resourceText));
  resolvedResources.push({
    assetId: entry.assetId,
    outputKey: entry.outputKey,
    path: entry.path,
    hash: entry.hash,
    bytes: Buffer.byteLength(resourceText),
  });
}

const launcher = createReferenceGameRuntimeLauncher();
const session = await launcher.launch({
  gameId: artifact.game.id,
  workspaceId: 'publish-runnable',
  runtimeEntry: artifact.runnableArtifact.runtimeMetadataPath,
  compatibility: {
    contractsPackageVersion: artifact.compatibility.contractsPackageVersion,
    runtimeBridgePackageVersion: artifact.compatibility.runtimeBridgePackageVersion,
    devtoolsProtocolVersion: artifact.compatibility.devtoolsProtocolVersion,
    publishArtifactVersion: artifact.compatibility.publishArtifactFormatVersion,
  },
  resourceProfile: {
    profileId: 'publish.runnable.resources.v1',
    runtimeEntry: artifact.runnableArtifact.runtimeMetadataPath,
    worldBundleId: `scene:${runtimeMetadata.world.sceneId}`,
    resourceManifestHash: artifact.runnableArtifact.resourceManifestHash,
  },
  world: runtimeMetadata.world,
  startedAtIso: '2026-06-28T00:00:00.000Z',
});
const projection = await session.pullProjection();
const acceptedCommand = await session.proposeCommands({
  commands: [{
    op: 'setVoxel',
    grid: 1,
    coord: { x: 0, y: 0, z: 0 },
    value: { kind: 'solid', material: 1 },
  }],
});
const afterAcceptedProjection = await session.pullProjection();
const rejectedCommand = await session.proposeCommands({
  commands: [{
    op: 'setVoxel',
    grid: 1,
    coord: { x: 0, y: 0, z: 0 },
    value: { kind: 'solid', material: 999 },
  }],
});
const afterRejectedProjection = await session.pullProjection();
await session.shutdown();

const smoke = {
  artifactKind: 'asha_demo_publish_run_smoke',
  artifactVersion: 'publish-run-smoke.v1',
  generatedAt: 'deterministic-as-structure-only',
  runnableArtifact: {
    target: artifact.runnableArtifact.target,
    directory: artifact.runnableArtifact.directory,
    entrypointPath: artifact.runnableArtifact.entrypointPath,
    entrypointHash: sha256(entrypointText),
    runtimeMetadataPath: artifact.runnableArtifact.runtimeMetadataPath,
    runtimeMetadataHash: sha256(runtimeMetadataText),
    resourceManifestPath: artifact.runnableArtifact.resourceManifestPath,
    resourceManifestHash: sha256(resourceManifestText),
  },
  runtime: {
    runtimeMode: session.identity.runtimeMode,
    launcherName: session.launch.runtimeProfile.launcherName,
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
  resolvedResources,
  checks: [
    'entrypoint_exists_without_dev_server',
    'runtime_metadata_loaded',
    'packed_resources_resolved',
    'reference_runtime_projection_pulled',
    'packaged_runtime_accepted_command_mutated_projection',
    'packaged_runtime_rejected_command_preserved_projection',
    'no_devtools_endpoint_required',
  ],
};

assert.equal(acceptedCommand.status, 'accepted');
assert.notEqual(acceptedCommand.authorityHashBefore, acceptedCommand.authorityHashAfter);
assert.equal(rejectedCommand.status, 'rejected');
assert.equal(rejectedCommand.authorityHashBefore, rejectedCommand.authorityHashAfter);

await mkdir(outDir, { recursive: true });
await writeFile(smokePath, `${JSON.stringify(smoke, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, smokePath)}`);
