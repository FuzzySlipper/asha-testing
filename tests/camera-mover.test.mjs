import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/camera-mover/latest/index.json', import.meta.url);

test('first-person camera mover scenario records real public movement/projection evidence', async () => {
  await rm(new URL('../harness/out/camera-mover/', import.meta.url), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['scripts/run-camera-mover.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/camera-mover\/latest\/index\.json/);

  const artifact = JSON.parse(await readFile(artifactIndex, 'utf8'));
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.scenario.name, 'first-person-camera-mover-public-surface-prototype');
  assert.deepEqual(artifact.publicImports, ['@asha/contracts', '@asha/runtime-bridge']);
  assert.equal(artifact.compatibility.contracts.compatibilityVersion, 'contracts.v0');
  assert.equal(artifact.compatibility.runtimeBridge.compatibilityVersion, 'runtime-bridge.v0');
  assert.equal(artifact.runtime.mode, 'mock-public-facade-deterministic-reference');
  assert.equal(artifact.runtime.nativeMode, 'not-used');
  assert.equal(artifact.workflow.loadedWorld, 1001);
  assert.equal(artifact.workflow.commandSequence.length, 6);
  assert.deepEqual(artifact.workflow.commandResult, {
    accepted: 1,
    rejected: 0,
    rejections: [],
  });
  assert.deepEqual(artifact.workflow.stepResult, { tick: 1, diffCount: 1 });

  assert.equal(artifact.cameraEvidence.status, 'public-camera-surface-produced-projection-evidence');
  assert.deepEqual(artifact.cameraEvidence.missingOperations, []);
  assert.equal(artifact.cameraEvidence.beforeSnapshot.camera, 1);
  assert.equal(artifact.cameraEvidence.afterSnapshot.tick, 1);
  assert.notDeepEqual(artifact.cameraEvidence.afterPose, artifact.cameraEvidence.beforePose);
  assert.deepEqual(artifact.cameraEvidence.afterPose.position, [0, 1.600000023841858, -0.05000000074505806]);
  assert.equal(artifact.cameraEvidence.afterPose.yawDegrees, 15);
  assert.equal(artifact.cameraEvidence.afterPose.pitchDegrees, -5);
  assert.equal(artifact.cameraEvidence.projectionSnapshot.projectionHash, 'fnv1a64:071327a4920ab097');
  assert.equal(artifact.cameraEvidence.projectionSnapshot.viewMatrix.length, 16);
  assert.equal(artifact.cameraEvidence.projectionSnapshot.projectionMatrix.length, 16);
  assert.equal(artifact.cameraEvidence.projectionSnapshot.viewProjectionMatrix.length, 16);
  assert.match(artifact.artifacts.stateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.boundaryCheck.status, 'passed');
});
