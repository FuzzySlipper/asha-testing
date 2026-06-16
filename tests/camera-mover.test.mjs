import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/camera-mover/latest/index.json', import.meta.url);

test('first-person camera mover scenario records public-surface evidence and missing camera API gap', async () => {
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
  assert.equal(artifact.runtime.mode, 'mock-public-facade');
  assert.equal(artifact.workflow.loadedWorld, 1001);
  assert.equal(artifact.workflow.commandSequence.length, 4);
  assert.deepEqual(artifact.workflow.commandResult, {
    accepted: 1,
    rejected: 0,
    rejections: [],
  });
  assert.deepEqual(artifact.workflow.stepResult, { tick: 1, diffCount: 1 });
  assert.equal(artifact.cameraEvidence.status, 'blocked-by-missing-public-camera-surface');
  assert.equal(artifact.cameraEvidence.attemptedPublicSurface, '@asha/runtime-bridge MANIFEST_OPERATIONS');
  assert.deepEqual(artifact.cameraEvidence.missingOperations, ['createCamera', 'applyFirstPersonCameraInput', 'readCameraProjection']);
  assert.equal(artifact.cameraEvidence.engineFeatureRequest.slug, 'first-person-camera-public-surface-request');
  assert.match(artifact.artifacts.stateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.boundaryCheck.status, 'passed');
});
