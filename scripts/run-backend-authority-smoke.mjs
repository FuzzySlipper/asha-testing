#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseAshaGameManifestToml } from '@asha/game-workspace';
import { createReferenceGameRuntimeLauncher } from '@asha/runtime-bridge';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outDir = join(repoRoot, 'harness/out/backend-authority-smoke/latest');
const artifactPath = join(outDir, 'index.json');

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout.trim().split('\n').filter(Boolean),
    stderr: result.stderr.trim() === '' ? [] : result.stderr.trim().split('\n'),
  };
}

function normalizeBackendHash(hash) {
  return hash.replace(/^native-/, 'backend-').replace(/^reference-/, 'backend-');
}

const authorityRun = run(process.execPath, ['scripts/run-dev-authority-smoke.mjs']);
const authorityText = await readFile(join(repoRoot, 'harness/out/dev-authority-smoke/latest/index.json'), 'utf8');
const authority = JSON.parse(authorityText);
const evidenceText = await readFile(join(repoRoot, authority.artifacts.commandEvidence.path), 'utf8');
const evidence = JSON.parse(evidenceText);
const manifestText = await readFile(join(repoRoot, 'asha.game.toml'), 'utf8');
const manifest = parseAshaGameManifestToml(manifestText);
assert.equal(manifest.ok, true, manifest.ok ? '' : JSON.stringify(manifest.diagnostics));
assert.equal(manifest.manifest.runtime.backendMode, 'native');

const fixture = JSON.parse(await readFile(join(repoRoot, manifest.manifest.runtime.wasmOrNativeEntry), 'utf8'));
const launcher = createReferenceGameRuntimeLauncher();
const reference = await launcher.launch({
  gameId: 'asha-demo',
  workspaceId: 'workspace.local',
  runtimeEntry: manifest.manifest.runtime.wasmOrNativeEntry,
  compatibility: {
    contractsPackageVersion: manifest.manifest.asha.contractsVersion,
    runtimeBridgePackageVersion: manifest.manifest.asha.runtimeBridgeVersion,
    devtoolsProtocolVersion: manifest.manifest.asha.devtoolsProtocolVersion,
    publishArtifactVersion: manifest.manifest.asha.publishArtifactFormatVersion,
  },
  resourceProfile: {
    profileId: 'asha-demo.reference.resources.v1',
    runtimeEntry: manifest.manifest.runtime.wasmOrNativeEntry,
    worldBundleId: `scene:${fixture.sceneId}`,
  },
  world: {
    bundleSchemaVersion: fixture.schemaVersion,
    protocolVersion: fixture.protocolVersion,
    sceneId: fixture.sceneId,
  },
  startedAtIso: '2026-06-28T00:00:00.000Z',
});

const referenceBefore = await reference.pullProjection();
const acceptedReceipt = evidence.commandReceipts.find((receipt) => receipt.status === 'accepted');
const rejectedReceipt = evidence.commandReceipts.find((receipt) => receipt.status === 'rejected');
assert.ok(acceptedReceipt, 'backend evidence must include an accepted command receipt');
assert.ok(rejectedReceipt, 'backend evidence must include a rejected command receipt');

const referenceAccepted = await reference.proposeCommands(acceptedReceipt.batch);
const referenceAfterAccepted = await reference.pullProjection();
const referenceRejected = await reference.proposeCommands(rejectedReceipt.batch);
const referenceAfterRejected = await reference.pullProjection();
await reference.shutdown();

assert.equal(referenceAccepted.status, 'accepted');
assert.equal(referenceRejected.status, 'rejected');
assert.notEqual(acceptedReceipt.authorityHashBefore, acceptedReceipt.authorityHashAfter);
assert.equal(rejectedReceipt.authorityHashBefore, rejectedReceipt.authorityHashAfter);
assert.notEqual(referenceAccepted.authorityHashBefore, referenceAccepted.authorityHashAfter);
assert.equal(referenceRejected.authorityHashBefore, referenceRejected.authorityHashAfter);

const normalizedAcceptedBeforeMatches =
  normalizeBackendHash(acceptedReceipt.authorityHashBefore) === normalizeBackendHash(referenceAccepted.authorityHashBefore);
const normalizedAcceptedAfterMatches =
  normalizeBackendHash(acceptedReceipt.authorityHashAfter) === normalizeBackendHash(referenceAccepted.authorityHashAfter);
const normalizedRejectedAfterMatches =
  normalizeBackendHash(rejectedReceipt.authorityHashAfter) === normalizeBackendHash(referenceRejected.authorityHashAfter);

const artifact = {
  artifactKind: 'asha_demo_backend_authority_smoke',
  artifactVersion: 'backend-authority-smoke.v1',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run backend:authority-smoke',
  backend: {
    mode: authority.backend.mode,
    profile: authority.backend.profile,
    proofRefs: authority.backend.proofRefs,
    moduleRef: authority.backend.moduleRef,
  },
  runtime: authority.runtime,
  nonClaims: [...new Set([...authority.runtime.nonClaims, 'not_wasm_authority'])],
  scene: evidence.scene,
  acceptedCommand: acceptedReceipt,
  rejectedCommand: rejectedReceipt,
  referenceComparison: {
    status: normalizedAcceptedBeforeMatches && normalizedAcceptedAfterMatches && normalizedRejectedAfterMatches
      ? 'normalized_hash_match'
      : 'diverged',
    referenceMode: reference.identity.runtimeMode,
    referenceBefore,
    referenceAccepted,
    referenceAfterAccepted,
    referenceRejected,
    referenceAfterRejected,
    normalizedAcceptedBeforeMatches,
    normalizedAcceptedAfterMatches,
    normalizedRejectedAfterMatches,
    note: 'Raw hashes include backend-mode namespace; normalized comparison replaces native/reference prefix only.',
  },
  artifacts: {
    devAuthoritySmoke: {
      path: 'harness/out/dev-authority-smoke/latest/index.json',
      sha256: sha256(authorityText),
    },
    commandEvidence: {
      path: authority.artifacts.commandEvidence.path,
      sha256: sha256(evidenceText),
    },
    replay: authority.artifacts.replay,
  },
  diagnostics: [],
  validations: [
    'native_backend_mode_selected',
    'devtools_command_proposal_only',
    'accepted_command_mutated_native_authority',
    'rejected_command_preserved_native_authority',
    'reference_hash_relationship_recorded',
    'not_wasm_authority_recorded',
  ],
};

assert.equal(artifact.referenceComparison.status, 'normalized_hash_match');
assert.equal(artifact.nonClaims.includes('not_wasm_authority'), true);

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${artifactPath.replace(`${repoRoot}/`, '')}`);
