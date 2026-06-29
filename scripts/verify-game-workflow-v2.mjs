#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/game-workflow-v2/latest');
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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  return {
    command: [command, ...args].join(' '),
    cwd: '.',
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function requirePassed(result) {
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
}

async function readArtifact(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const text = await readFile(absolutePath, 'utf8');
  return {
    path: relativePath,
    fileHash: sha256(text),
    json: JSON.parse(text),
  };
}

function findRef(index, groupName, kind) {
  const artifactRef = index.proofGroups[groupName]?.refs.find((ref) => ref.kind === kind);
  assert.ok(artifactRef, `missing V2 proof ref ${groupName}.${kind}`);
  return artifactRef;
}

const commands = {
  manifest: run('npm', ['run', 'check:manifest']),
  demoBoundary: run('npm', ['run', 'check:boundary']),
  v2ProofIndex: run('npm', ['run', 'proof:v2-index']),
  v2ProofIndexCheck: run('npm', ['run', 'proof:v2-index-check']),
};
for (const result of Object.values(commands)) {
  requirePassed(result);
}

const proofIndex = await readArtifact('harness/out/v2-proof-index/latest/index.json');
const index = proofIndex.json;
assert.equal(index.artifactKind, 'asha_demo_v2_proof_index');
assert.equal(index.runtime.mode, 'native');
assert.ok(index.runtime.backendProofRefs.length > 0, 'V2 workflow requires backend proof refs');

const backendAuthorityRef = findRef(index, 'backendAuthority', 'backend-authority-smoke');
const commandEvidenceRef = findRef(index, 'replayHash', 'dev-runtime-command-evidence');
const replayRef = findRef(index, 'replayHash', 'command-replay');
const studioLiveRef = findRef(index, 'studioLive', 'studio-v2-live-backend-evidence');
const publishArtifactRef = findRef(index, 'publishBackend', 'publish-artifact');
const publishEvidenceRef = findRef(index, 'publishBackend', 'publish-evidence');
const publishBackendSmokeRef = findRef(index, 'publishBackend', 'publish-backend-run-smoke');
const aggregateV1Ref = findRef(index, 'aggregate', 'game-workflow-v1');

const backendAuthority = await readArtifact(backendAuthorityRef.path);
const commandEvidence = await readArtifact(commandEvidenceRef.path);
const replay = await readArtifact(replayRef.path);
const studioLive = await readArtifact(studioLiveRef.path);
const publishArtifact = await readArtifact(publishArtifactRef.path);
const publishEvidence = await readArtifact(publishEvidenceRef.path);
const publishBackendSmoke = await readArtifact(publishBackendSmokeRef.path);
const aggregateV1 = await readArtifact(aggregateV1Ref.path);

assert.equal(backendAuthority.fileHash, backendAuthorityRef.sha256, 'backend authority child hash is stale');
assert.equal(commandEvidence.fileHash, commandEvidenceRef.sha256, 'command evidence child hash is stale');
assert.equal(replay.fileHash, replayRef.sha256, 'replay child hash is stale');
assert.equal(studioLive.fileHash, studioLiveRef.sha256, 'Studio live child hash is stale');
assert.equal(publishArtifact.fileHash, publishArtifactRef.sha256, 'publish artifact child hash is stale');
assert.equal(publishEvidence.fileHash, publishEvidenceRef.sha256, 'publish evidence child hash is stale');
assert.equal(publishBackendSmoke.fileHash, publishBackendSmokeRef.sha256, 'publish backend smoke child hash is stale');
assert.equal(aggregateV1.fileHash, aggregateV1Ref.sha256, 'V1 aggregate child hash is stale');
assert.equal(publishBackendSmoke.json.runtime.runtimeMode, 'native');
assert.equal(publishBackendSmoke.json.noDevServerRequired, true);
assert.equal(publishEvidence.json.publishSmoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
assert.deepEqual(index.runtime.backendProofRefs, publishArtifact.json.runtimeBackedArtifact.backendProofRefs);

const body = {
  artifactKind: 'asha_demo_game_workflow_v2_verification',
  artifactVersion: 'game-workflow-v2-verification.v1',
  generatedAt: 'deterministic-as-structure-only',
  commands,
  artifacts: {
    proofIndex: {
      path: proofIndex.path,
      fileHash: proofIndex.fileHash,
      indexId: index.indexId,
      indexHash: index.indexHash,
    },
    backendAuthority: {
      path: backendAuthority.path,
      fileHash: backendAuthority.fileHash,
      runtimeMode: backendAuthority.json.runtime.runtimeMode,
      backendProfile: backendAuthority.json.backend.profile,
      backendProofRefs: backendAuthority.json.backend.proofRefs,
    },
    replayHash: {
      commandEvidencePath: commandEvidence.path,
      commandEvidenceHash: commandEvidence.fileHash,
      replayPath: replay.path,
      replayHash: replay.fileHash,
    },
    studioLive: {
      path: studioLive.path,
      fileHash: studioLive.fileHash,
      runtimeMode: index.runtime.mode,
    },
    publishBackend: {
      publishArtifactPath: publishArtifact.path,
      publishArtifactFileHash: publishArtifact.fileHash,
      publishEvidencePath: publishEvidence.path,
      publishEvidenceFileHash: publishEvidence.fileHash,
      backendSmokePath: publishBackendSmoke.path,
      backendSmokeFileHash: publishBackendSmoke.fileHash,
      backendMode: publishArtifact.json.runtimeBackedArtifact.backendMode,
      backendProfile: publishArtifact.json.runtimeBackedArtifact.backendProfile,
      backendProofRefs: publishArtifact.json.runtimeBackedArtifact.backendProofRefs,
      dependencyGuard: publishEvidence.json.publishSmoke.readback.publishDependencyGuard,
    },
    aggregateV1: {
      path: aggregateV1.path,
      fileHash: aggregateV1.fileHash,
      remainsRunnable: true,
    },
  },
  validations: [
    'manifest_valid',
    'demo_boundary_passed',
    'selected_backend_authority_smoke_passed',
    'replay_hash_refs_fresh',
    'studio_live_backend_evidence_passed',
    'publish_backend_evidence_passed',
    'v2_proof_index_check_passed',
    'v1_aggregate_remains_runnable',
    'reference_fallback_claims_rejected_by_child_smoke',
    'publish_dependency_guard_passed',
  ],
  nonClaims: [
    'not_store_submission',
    'not_installer',
    'not_package_signing',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};

const artifactHash = sha256(stableJson(body));
const artifact = {
  ...body,
  artifactId: `asha-demo-game-workflow-v2:${artifactHash}`,
  artifactHash,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
