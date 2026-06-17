import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/conformance/latest/index.json', import.meta.url);

test('public boundary conformance harness emits deterministic artifact metadata', async () => {
  await rm(new URL('../harness/out/conformance/', import.meta.url), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['scripts/run-conformance.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/conformance\/latest\/index\.json/);

  const artifact = JSON.parse(await readFile(artifactIndex, 'utf8'));
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.runtime.mode, 'mock-public-facade-with-native-probe');
  assert.equal(artifact.workflow.loadedWorld, 1001);
  assert.deepEqual(artifact.workflow.commandResult, {
    accepted: 1,
    rejected: 0,
    rejections: [],
  });
  assert.deepEqual(artifact.workflow.stepResult, { tick: 1, diffCount: 1 });
  assert.deepEqual(artifact.workflow.renderDiff, { ops: [] });
  assert.equal(artifact.workflow.saveSummary.artifactsWritten, 3);
  assert.match(artifact.artifacts.stateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.boundaryCheck.command, 'npm run check:boundary');
  assert.equal(artifact.boundaryCheck.status, 'passed');
  assert.deepEqual(artifact.publicImports, ['@asha/contracts', '@asha/runtime-bridge']);

  assert.equal(artifact.compatibility.contracts.compatibilityVersion, 'contracts.v0');
  assert.equal(artifact.compatibility.runtimeBridge.compatibilityVersion, 'runtime-bridge.v0');
  assert.match(artifact.ashaSource.commit, /^[0-9a-f]{40}$/);
  assert.match(artifact.repo.commit, /^[0-9a-f]{40}$/);

  assert.equal(artifact.cameraEvidence.status, 'public-camera-surface-produced-projection-evidence');
  assert.deepEqual(artifact.cameraEvidence.missingOperations, []);
  assert.notDeepEqual(artifact.cameraEvidence.afterPose, artifact.cameraEvidence.beforePose);
  assert.equal(artifact.cameraEvidence.projectionSnapshot.projectionHash, 'fnv1a64:071327a4920ab097');

  assert.equal(artifact.resolvedEvidence.nativeAuthority.status, 'available');
  assert.equal(artifact.resolvedEvidence.nativeAuthority.resolvedByTask, 2570);
  assert.equal(artifact.gaps.nativeAuthority, undefined);
  assert.equal(artifact.runtime.nativeMode, 'native-public-facade');
  assert.ok(['available-inventory-only', 'captured', 'unavailable'].includes(artifact.renderEvidence.agora.status));
  assert.equal(artifact.gaps.renderEvidence.followUpTask, 2553);
  if (artifact.renderEvidence.agora.inventory.latest?.visualInspection?.status === 'blank') {
    assert.equal(artifact.renderEvidence.agora.classification, 'blank-compositor-capture-inventory');
    assert.equal(artifact.gaps.renderEvidence.status, 'agora-compositor-capture-blank-readback');
  }
  assert.ok(['comparable', 'unavailable'].includes(artifact.renderEvidence.comparison.status));
});
