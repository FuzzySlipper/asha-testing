import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/voxel-conversion-matrix/latest/index.json', import.meta.url);

test('native voxel conversion matrix records public consumer evidence', async () => {
  await rm(new URL('../harness/out/voxel-conversion-matrix/', import.meta.url), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['scripts/run-voxel-conversion-matrix.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 240000,
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/voxel-conversion-matrix\/latest\/index\.json/);

  const artifact = JSON.parse(await readFile(artifactIndex, 'utf8'));
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.scenario.id, 'native-voxel-conversion-public-consumer-matrix');
  assert.equal(artifact.scenario.task, 4595);
  assert.deepEqual(artifact.publicImports, ['@asha/contracts', '@asha/runtime-bridge']);
  assert.equal(artifact.runtime.mode, 'native_rust');
  assert.deepEqual(artifact.runtime.missingOperations, []);
  assert.ok(artifact.runtime.requiredOperations.includes('readVoxelModelInfo'));
  assert.equal(artifact.compatibility.contracts.compatibilityVersion, 'contracts.v0');
  assert.equal(artifact.compatibility.runtimeBridge.compatibilityVersion, 'runtime-bridge.v0');
  assert.match(artifact.sources.ashaEngine.commit, /^[0-9a-f]{40}$/);
  assert.match(artifact.sources.ashaTesting.commit, /^[0-9a-f]{40}$/);
  assert.match(artifact.nativeArtifact.artifactHash, /^sha256:[0-9a-f]{64}$/);

  assert.ok(artifact.registrations.every((registration) => registration.registered === true));
  assert.equal(artifact.facadeSurface.runtimeBridgeRegistrationMethod, 'registerVoxelConversionSource');
  assert.match(artifact.facadeSurface.runtimeSessionOnlyGap, /RuntimeBridge/);

  const accepted = artifact.cases.acceptedApplyAndModelInfo;
  assert.equal(accepted.plan.authorityVersion, 'svc-voxel-conversion.v0');
  assert.equal(accepted.plan.estimatedOutputVoxels, 3);
  assert.deepEqual(accepted.plan.diagnosticCodes, []);
  assert.equal(accepted.preview.outputVoxelCount, 3);
  assert.deepEqual(accepted.preview.materialIds, [1]);
  assert.equal(accepted.receipt.applied, true);
  assert.equal(accepted.receipt.outputVoxelCount, 3);
  assert.equal(accepted.modelInfo.resident, true);
  assert.equal(accepted.modelInfo.voxelCount, 3);
  assert.deepEqual(accepted.modelInfo.materialCounts, [{ material: 1, voxelCount: 3 }]);
  assert.deepEqual(accepted.modelInfo.evidenceKinds, ['plan', 'preview', 'apply_receipt']);
  assert.deepEqual(accepted.exportedEvidence.map((entry) => entry.kind), ['plan', 'preview', 'apply_receipt']);

  const larger = artifact.cases.largerMeshPlanPreview;
  assert.deepEqual(larger.sourceStats, { positions: 25, triangles: 32 });
  assert.equal(larger.plan.estimatedOutputVoxels, 25);
  assert.equal(larger.preview.outputVoxelCount, 25);
  assert.deepEqual(larger.preview.materialIds, [3, 5]);

  const materialFallback = artifact.cases.materialMappingFallback;
  assert.deepEqual(materialFallback.preview.materialIds, [3, 7]);
  assert.equal(materialFallback.materialMap.defaultVoxelMaterial, 7);

  assert.deepEqual(artifact.cases.negativeTopology.plan.diagnosticCodes, ['non_manifold_or_ambiguous_solid']);
  assert.deepEqual(artifact.cases.outputLimit.plan.diagnosticCodes, ['output_limit_exceeded']);
  assert.deepEqual(artifact.cases.sourceHashMismatch.plan.diagnosticCodes, ['source_hash_mismatch']);
  assert.deepEqual(artifact.cases.rejectedApply.receipt.diagnosticCodes, ['conversion_replay_mismatch']);
  assert.equal(artifact.cases.rejectedApply.receipt.applied, false);

  assert.equal(artifact.validations.boundaryCheck.status, 'passed');
  assert.ok(artifact.nonClaims.includes('not_studio_internal'));
  assert.ok(artifact.nonClaims.includes('not_runtime_session_source_registration_yet'));
  assert.match(artifact.artifactHash, /^sha256:[0-9a-f]{64}$/);
});
