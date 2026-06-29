#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioRoot = path.resolve(repoRoot, '../asha-studio');
const outDir = path.join(repoRoot, 'harness/out/game-workflow-v1/latest');
const artifactPath = path.join(outDir, 'index.json');

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

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
  });
  return {
    command: [command, ...args].join(' '),
    cwd: path.relative(repoRoot, cwd) || '.',
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function readArtifact(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const text = await readFile(absolutePath, 'utf8');
  return {
    path: relativePath,
    fileHash: sha256(text),
    json: JSON.parse(text),
  };
}

async function readStudioSource(relativePath) {
  const absolutePath = path.join(studioRoot, relativePath);
  const text = await readFile(absolutePath, 'utf8');
  return {
    path: path.relative(repoRoot, absolutePath),
    fileHash: sha256(text),
    text,
  };
}

function requirePassed(result) {
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
}

function assertHashMatches(artifact, expectedHash, label) {
  assert.equal(artifact.fileHash, expectedHash, `${label} hash is stale`);
}

if (!existsSync(studioRoot)) {
  throw new Error(`missing sibling Studio repo: ${studioRoot}`);
}

const commands = {
  manifest: run('npm', ['run', 'check:manifest']),
  demoBoundary: run('npm', ['run', 'check:boundary']),
  publicArtifacts: run('npm', ['run', 'check:public-artifacts']),
  assetsV1: run('npm', ['run', 'verify:assets-v1']),
  runtimeAuthoritySmoke: run('npm', ['run', 'dev:authority-smoke']),
  publishEvidence: run('npm', ['run', 'publish:evidence']),
  publishEvidenceCheck: run('npm', ['run', 'publish:evidence-check']),
  studioTests: run('pnpm', ['run', 'test'], studioRoot),
  studioBoundaries: run('pnpm', ['run', 'check:boundaries'], studioRoot),
  studioTypecheck: run('pnpm', ['exec', 'nx', 'typecheck', 'studio-app'], studioRoot),
};

for (const result of Object.values(commands)) {
  requirePassed(result);
}

const runtimeAuthority = await readArtifact('harness/out/dev-authority-smoke/latest/index.json');
const devSmoke = await readArtifact('harness/out/dev-smoke/latest/index.json');
const assetsV1 = await readArtifact('harness/out/assets-v1/latest/index.json');
const assetInventory = await readArtifact('harness/out/asset-inventory/latest/index.json');
const publishEvidence = await readArtifact('harness/out/publish-evidence/latest/index.json');
const publishArtifact = await readArtifact('harness/out/publish/latest/index.json');
const publishSmoke = await readArtifact('harness/out/publish-smoke/latest/index.json');
const publishRunSmoke = await readArtifact('harness/out/publish-run-smoke/latest/index.json');
const studioPanels = await readStudioSource('libs/studio-panels/src/index.ts');
const studioDomain = await readStudioSource('libs/studio-domain/src/index.ts');
const studioTests = await readStudioSource('test/substrate-scaffold.test.ts');

assert.equal(runtimeAuthority.json.artifactKind, 'asha_demo_dev_authority_smoke');
assert.equal(runtimeAuthority.json.artifactVersion, 'dev-authority-smoke.v1');
assert.equal(runtimeAuthority.json.runtime.runtimeMode, 'reference');
assert.equal(runtimeAuthority.json.acceptedCommand.status, 'accepted');
assert.equal(runtimeAuthority.json.rejectedCommand.status, 'rejected');
assert.notEqual(
  runtimeAuthority.json.acceptedCommand.authorityHashBefore,
  runtimeAuthority.json.acceptedCommand.authorityHashAfter,
);
assert.equal(
  runtimeAuthority.json.rejectedCommand.authorityHashBefore,
  runtimeAuthority.json.rejectedCommand.authorityHashAfter,
);
assertHashMatches(devSmoke, runtimeAuthority.json.artifacts.devSmoke.sha256, 'dev smoke child artifact');

assert.equal(assetsV1.json.artifactKind, 'asha_demo_assets_v1_verification');
assert.equal(assetsV1.json.artifactVersion, 'assets-v1-verification.v1');
assert.equal(assetsV1.json.artifacts.assetInventory.entryCount, 3);
assertHashMatches(assetInventory, assetsV1.json.artifacts.assetInventory.sha256, 'asset inventory child artifact');

assert.equal(publishEvidence.json.evidenceKind, 'asha_demo_publish_evidence_manifest');
assert.equal(publishEvidence.json.evidenceVersion, 'publish-evidence.v1');
assert.equal(publishEvidence.json.publishArtifact.runnableTarget, 'asha-demo-static-reference.v1');
assert.equal(publishEvidence.json.publishSmoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
assert.equal(publishEvidence.json.publishRunSmoke.runtime.runtimeMode, 'reference');
assert.equal(publishEvidence.json.publishRunSmoke.commandProof.acceptedCommand.status, 'accepted');
assert.equal(publishEvidence.json.publishRunSmoke.commandProof.rejectedCommand.status, 'rejected');
assertHashMatches(publishArtifact, publishEvidence.json.publishArtifact.fileHash, 'publish artifact child artifact');
assertHashMatches(publishSmoke, publishEvidence.json.publishSmoke.fileHash, 'publish smoke child artifact');
assertHashMatches(publishRunSmoke, publishEvidence.json.publishRunSmoke.fileHash, 'publish run smoke child artifact');

const studioMarkers = [
  'studio-game-workspace-overview',
  'studio-assets-panel',
  'studio-proof-scene-panel',
  'studio-runtime-session-panel',
  'studio-command-proposal-panel',
  'studio-publish-evidence-panel',
  'studio-workspace-cockpit-evidence',
];
for (const marker of studioMarkers) {
  assert.ok(
    studioPanels.text.includes(marker) || studioDomain.text.includes(marker) || studioTests.text.includes(marker),
    `missing Studio cockpit marker ${marker}`,
  );
}
assert.ok(studioDomain.text.includes('studio_workspace_cockpit_evidence'));
assert.ok(studioTests.text.includes('workspace cockpit evidence export covers panel readouts'));

const body = {
  artifactKind: 'asha_demo_game_workflow_v1_verification',
  artifactVersion: 'game-workflow-v1-verification.v1',
  generatedAt: 'deterministic-as-structure-only',
  commands,
  artifacts: {
    runtimeAuthority: {
      path: runtimeAuthority.path,
      fileHash: runtimeAuthority.fileHash,
      runtimeMode: runtimeAuthority.json.runtime.runtimeMode,
      acceptedAuthorityHashBefore: runtimeAuthority.json.acceptedCommand.authorityHashBefore,
      acceptedAuthorityHashAfter: runtimeAuthority.json.acceptedCommand.authorityHashAfter,
      rejectedAuthorityHashBefore: runtimeAuthority.json.rejectedCommand.authorityHashBefore,
      rejectedAuthorityHashAfter: runtimeAuthority.json.rejectedCommand.authorityHashAfter,
      commandEvidencePath: runtimeAuthority.json.artifacts.commandEvidence.path,
    },
    assets: {
      path: assetsV1.path,
      fileHash: assetsV1.fileHash,
      inventoryPath: assetInventory.path,
      inventoryHash: assetInventory.fileHash,
      resourcePackManifestPath: assetsV1.json.artifacts.publishArtifact.resourcePackManifestPath,
      resourcePackManifestHash: assetsV1.json.artifacts.publishArtifact.resourcePackManifestHash,
      resourcePackEntryCount: assetsV1.json.artifacts.publishArtifact.resourcePackEntryCount,
      inventoryEntryCount: assetsV1.json.artifacts.assetInventory.entryCount,
      dependencyOrder: assetsV1.json.artifacts.assetInventory.dependencyOrder,
    },
    publish: {
      evidencePath: publishEvidence.path,
      evidenceFileHash: publishEvidence.fileHash,
      evidenceId: publishEvidence.json.evidenceId,
      evidenceHash: publishEvidence.json.evidenceHash,
      publishArtifactPath: publishEvidence.json.publishArtifact.path,
      publishArtifactFileHash: publishEvidence.json.publishArtifact.fileHash,
      publishArtifactHash: publishEvidence.json.publishArtifact.artifactHash,
      publishTarget: publishEvidence.json.publishArtifact.runnableTarget,
      entrypointPath: publishEvidence.json.publishArtifact.runnableEntrypointPath,
      entrypointHash: publishEvidence.json.publishArtifact.runnableEntrypointHash,
      dependencyGuard: publishEvidence.json.publishSmoke.readback.publishDependencyGuard,
      runSmokePath: publishEvidence.json.publishRunSmoke.path,
      runSmokeFileHash: publishEvidence.json.publishRunSmoke.fileHash,
      runSmokeRuntimeMode: publishEvidence.json.publishRunSmoke.runtime.runtimeMode,
    },
    studio: {
      cockpitArtifactKind: 'studio_workspace_cockpit_evidence',
      cockpitArtifactVersion: 'studio-workspace-cockpit-evidence.v0',
      markers: studioMarkers,
      sourceRefs: [
        { kind: 'studio-panels', path: studioPanels.path, sha256: studioPanels.fileHash },
        { kind: 'studio-domain', path: studioDomain.path, sha256: studioDomain.fileHash },
        { kind: 'studio-tests', path: studioTests.path, sha256: studioTests.fileHash },
      ],
    },
  },
  validations: [
    'manifest_valid',
    'demo_boundary_passed',
    'public_artifacts_available',
    'assets_v1_verification_passed',
    'runtime_authority_smoke_passed',
    'runtime_authority_child_hashes_fresh',
    'publish_evidence_passed',
    'publish_child_hashes_fresh',
    'publish_dependency_guard_passed',
    'studio_cockpit_tests_passed',
    'studio_boundaries_passed',
    'studio_typecheck_passed',
    'studio_cockpit_markers_present',
  ],
  nonClaims: [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
    'not_studio_runtime_authority',
    'not_studio_publish_builder',
  ],
};

const artifactHash = sha256(stableJson(body));
const artifact = {
  ...body,
  artifactId: `asha-demo-game-workflow-v1:${artifactHash}`,
  artifactHash,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
