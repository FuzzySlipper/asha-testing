import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/voxel-interaction/latest/index.json', import.meta.url);
const pageIndex = new URL('../harness/out/voxel-interaction/latest/index.html', import.meta.url);

test('basic graphical voxel interaction scene records public ASHA evidence and launch page', async () => {
  await rm(new URL('../harness/out/voxel-interaction/', import.meta.url), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['scripts/run-voxel-interaction.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/voxel-interaction\/latest\/index\.json/);
  assert.match(result.stdout, /wrote harness\/out\/voxel-interaction\/latest\/index\.html/);

  const artifact = JSON.parse(await readFile(artifactIndex, 'utf8'));
  const page = await readFile(pageIndex, 'utf8');

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.scenario.id, 'basic-voxel-landscape-interaction');
  assert.equal(artifact.scenario.task, 2648);
  assert.deepEqual(artifact.scenario.dependencyTasks, [2645, 2646, 2647]);
  assert.deepEqual(artifact.publicImports, ['@asha/contracts', '@asha/runtime-bridge']);
  assert.equal(artifact.compatibility.contracts.compatibilityVersion, 'contracts.v0');
  assert.equal(artifact.compatibility.runtimeBridge.compatibilityVersion, 'runtime-bridge.v0');
  assert.equal(artifact.runtime.mode, 'mock-public-facade-deterministic-reference');
  assert.deepEqual(artifact.runtime.missingOperations, []);
  assert.ok(artifact.runtime.requiredOperations.includes('applyCollisionConstrainedCameraInput'));
  assert.ok(artifact.runtime.requiredOperations.includes('selectVoxel'));
  assert.ok(artifact.runtime.requiredOperations.includes('readVoxelMeshEvidence'));

  assert.equal(artifact.fixture.fixtureId, 'basic-voxel-landscape-interaction');
  assert.equal(artifact.fixture.sourceFixture, 'canonical-voxel-world');
  assert.equal(artifact.fixture.grid.id, 1);
  assert.deepEqual(artifact.fixture.materials, [1, 2, 3]);
  assert.equal(artifact.fixture.chunkHashes.length, 1);

  assert.equal(artifact.camera.movementSteps.length, 1);
  const movement = artifact.camera.movementSteps[0].snapshot;
  assert.equal(movement.collision.grid, 1);
  assert.equal(movement.collision.shape.halfExtents.length, 3);
  assert.match(movement.collision.collisionProjectionHash, /^fnv1a64:/);
  assert.match(movement.movementHash, /^fnv1a64:/);
  assert.notDeepEqual(movement.after.pose, movement.before.pose);

  assert.equal(artifact.selection.outcome, 'hit');
  assert.deepEqual(artifact.selection.pickRay.screenPoint, { x: 0.5, y: 0.5, space: 'normalized_0_1' });
  assert.deepEqual(artifact.selection.selectedVoxel, { x: 1, y: 1, z: 0 });
  assert.equal(artifact.selection.selectedFace, 'posZ');
  assert.deepEqual(artifact.selection.editAnchor, { x: 1, y: 1, z: 1 });
  assert.match(artifact.selection.selectionHash, /^fnv1a64:/);

  assert.equal(artifact.edit.source, 'raycast_selection');
  assert.equal(artifact.edit.command.op, 'setVoxel');
  assert.deepEqual(artifact.edit.command.coord, artifact.selection.editAnchor);
  assert.equal(artifact.edit.command.value.material, 2);
  assert.deepEqual(artifact.edit.commandResult, { accepted: 1, rejected: 0, rejections: [] });
  assert.equal(artifact.mesh.before.fixtureId, 'basic-voxel-landscape-interaction');
  assert.equal(artifact.mesh.after.fixtureId, 'basic-voxel-landscape-interaction');
  assert.equal(artifact.mesh.changed, true);
  assert.match(artifact.mesh.beforeHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(artifact.mesh.afterHash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(artifact.mesh.beforeHash, artifact.mesh.afterHash);
  assert.equal(artifact.render.changed, true);
  assert.notEqual(artifact.render.beforeHash, artifact.render.afterHash);

  assert.equal(artifact.controlSurface.type, 'browser-page-fixed-voxel-interaction-hook');
  assert.equal(artifact.controlSurface.hook, 'window.ashaVoxelInteraction.applySelectionEdit()');
  assert.equal(artifact.controlSurface.noRawRuntimeJsonTunnel, true);
  assert.ok(artifact.controlSurface.declaredInputs.includes('click button[data-command="applySelectionEdit"]'));
  assert.match(page, /window\.ashaVoxelInteraction/);
  assert.match(page, /data-proof-ready="true"/);
  assert.match(page, /data-command="applySelectionEdit"/);
  assert.match(page, /selected terrain voxel/);

  assert.equal(artifact.boundaryCheck.status, 'passed');
  assert.equal(artifact.renderEvidencePolicy.evidenceClass, 'functional_software_visual');
  assert.equal(artifact.renderEvidencePolicy.capture.nonblankRequired, true);
  assert.equal(artifact.renderEvidencePolicy.gpu.hardwarePerformanceClaimed, false);
  assert.equal(artifact.agoraSlots.status, 'pending-agora-os-2649');
  assert.deepEqual(artifact.agoraSlots.artifactLinks, []);
  assert.match(artifact.artifacts.stateHash, /^sha256:[0-9a-f]{64}$/);
});
