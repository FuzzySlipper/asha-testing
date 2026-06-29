#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = process.argv[2]
  ? path.resolve(repoRoot, process.argv[2])
  : path.join(repoRoot, 'harness/out/v2-proof-index/latest/index.json');

const requiredGroups = ['backendAuthority', 'replayHash', 'studioLive', 'publishBackend', 'aggregate'];

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

function withoutIndexHash(index) {
  const { indexHash, indexId, ...body } = index;
  void indexHash;
  void indexId;
  return body;
}

function fail(message) {
  console.error(`asha-demo V2 proof index check failed: ${message}`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  fail(`missing index ${path.relative(repoRoot, indexPath)}`);
}

const indexText = await readFile(indexPath, 'utf8');
const index = JSON.parse(indexText);
assert.equal(index.artifactKind, 'asha_demo_v2_proof_index');
assert.equal(index.artifactVersion, 'v2-proof-index.v1');
assert.equal(index.indexHash, sha256(stableJson(withoutIndexHash(index))));
assert.equal(index.indexId, `asha-demo-v2-proof-index:${index.indexHash}`);
assert.equal(index.campaign.projectId, 'asha');
assert.equal(index.campaign.parentTaskId, 3697);
assert.equal(index.denIngestableSummary.dataOnly, true);
assert.ok(index.nonClaims.includes('not_runtime_den_dependency'));
assert.ok(index.runtime.backendProofRefs.length > 0, 'V2 proof index requires backend proof refs');

for (const groupName of requiredGroups) {
  const group = index.proofGroups[groupName];
  assert.ok(group, `missing proof group ${groupName}`);
  assert.equal(group.required, true, `proof group ${groupName} must be required`);
  assert.ok(Array.isArray(group.refs) && group.refs.length > 0, `proof group ${groupName} requires refs`);
}

for (const [groupName, group] of Object.entries(index.proofGroups)) {
  for (const artifactRef of group.refs) {
    const artifactText = await readFile(path.resolve(repoRoot, artifactRef.path), 'utf8');
    assert.equal(artifactRef.sha256, sha256(artifactText), `${groupName}.${artifactRef.kind} child ref is stale`);
  }
}

const publishArtifactRef = index.proofGroups.publishBackend.refs.find((artifactRef) => artifactRef.kind === 'publish-artifact');
const publishBackendSmokeRef = index.proofGroups.publishBackend.refs.find((artifactRef) => artifactRef.kind === 'publish-backend-run-smoke');
assert.ok(publishArtifactRef, 'publishBackend group requires publish-artifact');
assert.ok(publishBackendSmokeRef, 'publishBackend group requires publish-backend-run-smoke');
const publishArtifact = JSON.parse(await readFile(path.resolve(repoRoot, publishArtifactRef.path), 'utf8'));
const publishBackendSmoke = JSON.parse(await readFile(path.resolve(repoRoot, publishBackendSmokeRef.path), 'utf8'));
assert.deepEqual(index.runtime.backendProofRefs, publishArtifact.runtimeBackedArtifact.backendProofRefs);
assert.equal(index.runtime.mode, publishBackendSmoke.runtime.runtimeMode);
assert.equal(index.runtime.mode, 'native');
assert.equal(publishBackendSmoke.noDevServerRequired, true);
assert.ok(index.validations.includes('den_summary_is_data_only'));

console.log('asha-demo V2 proof index check: OK');
