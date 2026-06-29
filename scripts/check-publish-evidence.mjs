#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = process.argv[2]
  ? path.resolve(repoRoot, process.argv[2])
  : path.join(repoRoot, 'harness/out/publish-evidence/latest/index.json');

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fail(message) {
  console.error(`asha-demo publish evidence check failed: ${message}`);
  process.exit(1);
}

if (!existsSync(evidencePath)) fail(`missing evidence ${path.relative(repoRoot, evidencePath)}`);

const evidenceText = await readFile(evidencePath, 'utf8');
const evidence = JSON.parse(evidenceText);
assert.equal(evidence.evidenceKind, 'asha_demo_publish_evidence_manifest');
assert.equal(evidence.evidenceVersion, 'publish-evidence.v1');
assert.match(evidence.evidenceHash, /^sha256:/);

const publishArtifactText = await readFile(path.join(repoRoot, evidence.publishArtifact.path), 'utf8');
assert.equal(evidence.publishArtifact.fileHash, sha256(publishArtifactText));
const publishArtifact = JSON.parse(publishArtifactText);
assert.equal(evidence.publishArtifact.artifactHash, publishArtifact.artifactHash);
assert.equal(evidence.publishArtifact.runnableEntrypointHash, publishArtifact.runnableArtifact.entrypointHash);
assert.equal(evidence.publishArtifact.resourcePackManifestHash, publishArtifact.resourcePack.manifestHash);
assert.equal(evidence.publishArtifact.runtimeBackedTarget, publishArtifact.runtimeBackedArtifact.target);
assert.deepEqual(
  evidence.publishArtifact.runtimeBackedBackendProofRefs,
  publishArtifact.runtimeBackedArtifact.backendProofRefs,
  'runtime-backed publish evidence backend proof refs must match publish artifact',
);
assert.ok(evidence.publishArtifact.runtimeBackedBackendProofRefs.length > 0, 'runtime-backed publish evidence requires backend proof refs');

const entrypointText = await readFile(path.join(repoRoot, evidence.publishArtifact.runnableEntrypointPath), 'utf8');
assert.equal(evidence.publishArtifact.runnableEntrypointHash, sha256(entrypointText), 'runnable entrypoint readback hash mismatch');
const resourcePackManifestText = await readFile(path.join(repoRoot, evidence.publishArtifact.resourcePackManifestPath), 'utf8');
assert.equal(evidence.publishArtifact.resourcePackManifestHash, sha256(resourcePackManifestText), 'resource pack manifest readback hash mismatch');

assert.equal(evidence.publishSmoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
assert.ok(evidence.publishSmoke.checks.includes('runnable_dependency_guard_passed'));
const publishRunSmokeText = await readFile(path.join(repoRoot, evidence.publishRunSmoke.path), 'utf8');
assert.equal(evidence.publishRunSmoke.fileHash, sha256(publishRunSmokeText), 'publish run smoke child artifact hash is stale');
assert.equal(evidence.publishRunSmoke.runtime.runtimeMode, 'reference', 'publish run smoke runtime readback missing');
assert.match(evidence.publishRunSmoke.projection.worldHash, /^reference-world:/, 'publish run smoke projection readback missing');
assert.equal(evidence.publishRunSmoke.commandProof.acceptedCommand.status, 'accepted');
assert.equal(evidence.publishRunSmoke.commandProof.rejectedCommand.status, 'rejected');
const publishBackendRunSmokeText = await readFile(path.join(repoRoot, evidence.publishBackendRunSmoke.path), 'utf8');
assert.equal(evidence.publishBackendRunSmoke.fileHash, sha256(publishBackendRunSmokeText), 'publish backend run smoke child artifact hash is stale');
const publishBackendRunSmoke = JSON.parse(publishBackendRunSmokeText);
assert.equal(publishBackendRunSmoke.sourceArtifact.artifactHash, publishArtifact.artifactHash);
assert.equal(evidence.publishBackendRunSmoke.runtimeBackedArtifact.target, publishArtifact.runtimeBackedArtifact.target);
assert.deepEqual(
  evidence.publishBackendRunSmoke.runtimeBackedArtifact.backendProofRefs,
  publishArtifact.runtimeBackedArtifact.backendProofRefs,
  'backend run smoke proof refs must match publish artifact',
);
assert.ok(evidence.publishBackendRunSmoke.runtimeBackedArtifact.backendProofRefs.length > 0, 'backend run smoke requires backend proof refs');
assert.equal(evidence.publishBackendRunSmoke.runtime.runtimeMode, 'native', 'publish backend run smoke runtime readback missing');
assert.match(evidence.publishBackendRunSmoke.projection.worldHash, /^native-world:/, 'publish backend run smoke projection readback missing');
assert.equal(evidence.publishBackendRunSmoke.commandProof.acceptedCommand.status, 'accepted');
assert.equal(evidence.publishBackendRunSmoke.commandProof.rejectedCommand.status, 'rejected');
assert.equal(evidence.publishBackendRunSmoke.noDevServerRequired, true);
assert.ok(evidence.validations.includes('runtime_projection_readback_present'));
assert.ok(evidence.validations.includes('packaged_command_proof_present'));
assert.ok(evidence.validations.includes('backend_runtime_projection_readback_present'));
assert.ok(evidence.validations.includes('backend_packaged_command_proof_present'));
assert.ok(evidence.validations.includes('backend_no_dev_server_smoke_passed'));
for (const nonClaim of ['not_store_submission', 'not_installer', 'not_package_signing', 'not_hardware_gpu_evidence', 'not_performance_evidence']) {
  assert.ok(evidence.nonClaims.includes(nonClaim), `missing publish evidence non-claim ${nonClaim}`);
}

console.log('asha-demo publish evidence check: OK');
