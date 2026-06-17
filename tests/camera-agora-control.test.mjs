import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/camera-agora-control/latest/index.json', import.meta.url);
const pageIndex = new URL('../harness/out/camera-agora-control/latest/index.html', import.meta.url);

test('first-person Agora control scenario records public controllable camera evidence', async () => {
  await rm(new URL('../harness/out/camera-agora-control/', import.meta.url), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['scripts/run-camera-agora-control.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/camera-agora-control\/latest\/index\.json/);
  assert.match(result.stdout, /wrote harness\/out\/camera-agora-control\/latest\/index\.html/);

  const artifact = JSON.parse(await readFile(artifactIndex, 'utf8'));
  const page = await readFile(pageIndex, 'utf8');

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.scenario.name, 'first-person-agora-control-basic');
  assert.equal(artifact.scenario.task, 2630);
  assert.equal(artifact.scenario.pairedAgoraTask, 2631);
  assert.deepEqual(artifact.publicImports, ['@asha/contracts', '@asha/runtime-bridge']);
  assert.equal(artifact.compatibility.contracts.compatibilityVersion, 'contracts.v0');
  assert.equal(artifact.compatibility.runtimeBridge.compatibilityVersion, 'runtime-bridge.v0');
  assert.equal(artifact.runtime.mode, 'mock-public-facade-deterministic-reference');
  assert.equal(artifact.cameraEvidence.status, 'public-first-person-agora-control-produced-projection-evidence');
  assert.deepEqual(artifact.cameraEvidence.missingOperations, []);

  assert.equal(artifact.controlSurface.type, 'browser-page-fixed-command-hook');
  assert.equal(artifact.controlSurface.hook, 'window.ashaAgoraControl.applyCommand(commandName)');
  assert.equal(artifact.controlSurface.noRawRuntimeJsonTunnel, true);
  assert.deepEqual(artifact.controlSurface.allowedCommands, ['moveForward', 'lookRight', 'lookDown']);
  assert.equal(new Set(artifact.controlSurface.allowedCommands).size, 3);
  assert.match(page, /window\.ashaAgoraControl/);
  assert.match(page, /data-command/);

  assert.equal(artifact.cameraEvidence.steps.length, 3);
  assert.ok(new Set(artifact.cameraEvidence.steps.map((step) => step.command)).size >= 2);
  assert.deepEqual(artifact.cameraEvidence.steps.map((step) => step.publicSurface), [
    '@asha/runtime-bridge',
    '@asha/runtime-bridge',
    '@asha/runtime-bridge',
  ]);
  assert.notDeepEqual(artifact.cameraEvidence.final.pose, artifact.cameraEvidence.initial.pose);
  assert.notEqual(artifact.cameraEvidence.final.projectionHash, artifact.cameraEvidence.initial.projectionHash);
  assert.match(artifact.cameraEvidence.initial.projectionHash, /^fnv1a64:[0-9a-f]{16}$/);
  assert.match(artifact.cameraEvidence.final.projectionHash, /^fnv1a64:[0-9a-f]{16}$/);
  assert.equal(artifact.cameraEvidence.final.projectionSnapshot.viewMatrix.length, 16);
  assert.equal(artifact.cameraEvidence.final.projectionSnapshot.projectionMatrix.length, 16);
  assert.equal(artifact.cameraEvidence.final.projectionSnapshot.viewProjectionMatrix.length, 16);

  assert.equal(artifact.agoraSlots.status, 'pending-agora-os-2631');
  assert.deepEqual(artifact.agoraSlots.artifactLinks, []);
  assert.match(artifact.artifacts.stateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.boundaryCheck.status, 'passed');
});
