#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const evidencePath = process.argv[2] ?? join(repoRoot, 'harness/out/devtools/latest/index.json');
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));

assert.equal(evidence.artifactKind, 'asha_demo_dev_runtime_command_evidence');
assert.equal(evidence.artifactVersion, 'dev-runtime-command-evidence.v1');
assert.match(evidence.manifestHash, /^sha256:/);
assert.equal(evidence.scene.sceneId, 1001);
assert.ok(['reference', 'native', 'wasm', 'degraded'].includes(evidence.runtime.runtimeMode), 'runtimeMode must be reference/native/wasm/degraded');
assert.notEqual(evidence.runtime.runtimeMode, 'mock', 'dev runtime evidence must not use mock runtimeMode');
assert.ok(Array.isArray(evidence.nonClaims), 'nonClaims must be present');
if (evidence.runtime.runtimeMode === 'reference') {
  for (const nonClaim of ['not_native_runtime', 'not_hardware_gpu', 'not_performance_evidence', 'not_wasm_authority']) {
    assert.ok(evidence.nonClaims.includes(nonClaim), `${nonClaim} must be present for reference runtimeMode`);
  }
}
if (evidence.runtime.runtimeMode === 'native') {
  assert.equal(typeof evidence.runtime.nativeProofRef, 'string', 'nativeProofRef required for native runtimeMode');
}
if (evidence.runtime.runtimeMode === 'wasm') {
  assert.equal(typeof evidence.runtime.wasmProofRef, 'string', 'wasmProofRef required for wasm runtimeMode');
}
assert.ok(Array.isArray(evidence.commandReceipts));
assert.ok(evidence.commandReceipts.length >= 2);

for (const receipt of evidence.commandReceipts) {
  assert.equal(typeof receipt.sequenceId, 'number');
  assert.equal(typeof receipt.authorityHashBefore, 'string', 'authorityHashBefore must be present');
  assert.equal(typeof receipt.authorityHashAfter, 'string', 'authorityHashAfter must be present');
  assert.ok(receipt.authorityHashBefore.length > 0, 'authorityHashBefore must be non-empty');
  assert.ok(receipt.authorityHashAfter.length > 0, 'authorityHashAfter must be non-empty');
  assert.ok(receipt.status === 'accepted' || receipt.status === 'rejected' || receipt.status === 'failed');
}

const accepted = evidence.commandReceipts.find((receipt) => receipt.status === 'accepted');
const rejected = evidence.commandReceipts.find((receipt) => receipt.status === 'rejected');
assert.ok(accepted, 'expected accepted command receipt');
assert.ok(rejected, 'expected rejected command receipt');
assert.notEqual(accepted.authorityHashBefore, accepted.authorityHashAfter);
assert.equal(rejected.authorityHashBefore, rejected.authorityHashAfter);
assert.equal(evidence.projectionDiffSummary.acceptedCommandChangedAuthority, true);
assert.equal(evidence.projectionDiffSummary.rejectedCommandPreservedAuthority, true);

console.log('dev runtime command evidence check: OK');
