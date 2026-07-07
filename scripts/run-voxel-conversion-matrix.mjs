#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_OPERATIONS, STABLE_OPERATION_COUNT, createNativeRuntimeBridge, createRuntimeSessionFacade } from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = path.resolve(repoRoot, '../asha-engine');
const nativeCrateManifest = path.join(engineRoot, 'engine-rs/crates/bridge/native-bridge/Cargo.toml');
const nativeBuildArtifact = path.join(engineRoot, 'engine-rs/crates/bridge/native-bridge/target/release/libnative_bridge.so');
const nativePackageArtifact = path.join(engineRoot, 'ts/packages/native-bridge/dist/native-bridge.node');
const contractsCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/contracts/compatibility.json');
const runtimeCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/runtime-bridge/compatibility.json');
const outDir = path.join(repoRoot, 'harness/out/voxel-conversion-matrix/latest');
const artifactPath = path.join(outDir, 'index.json');

const publicImports = ['@asha/contracts', '@asha/runtime-bridge'];
const requiredOperations = [
  'registerVoxelConversionSource',
  'planVoxelConversion',
  'previewVoxelConversion',
  'applyVoxelConversion',
  'exportVoxelConversionEvidence',
  'readVoxelModelInfo',
];
const identityTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
  });
  return {
    command: [command, ...args].join(' '),
    cwd: options.cwd ?? repoRoot,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function gitOutput(cwd, args) {
  return mustRun('git', args, { cwd, timeout: 15000 }).stdout;
}

function readSource(root, name) {
  return {
    name,
    path: root,
    branch: gitOutput(root, ['branch', '--show-current']),
    commit: gitOutput(root, ['rev-parse', 'HEAD']),
  };
}

async function readCompatibility(filePath) {
  const metadata = JSON.parse(await readFile(filePath, 'utf8'));
  return {
    surface: metadata.surface,
    compatibilityVersion: metadata.compatibilityVersion,
    packageVersion: metadata.packageVersion,
    sourceOfTruth: metadata.sourceOfTruth,
  };
}

async function ensureNativeBridgeArtifact() {
  const build = mustRun('cargo', ['build', '--release', '--manifest-path', nativeCrateManifest], {
    cwd: repoRoot,
    timeout: 180000,
  });
  assert.equal(existsSync(nativeBuildArtifact), true, `native bridge cdylib missing at ${nativeBuildArtifact}`);
  await mkdir(path.dirname(nativePackageArtifact), { recursive: true });
  await copyFile(nativeBuildArtifact, nativePackageArtifact);
  return {
    build,
    source: path.relative(repoRoot, nativeBuildArtifact),
    destination: path.relative(repoRoot, nativePackageArtifact),
    artifactHash: sha256(await readFile(nativePackageArtifact)),
  };
}

function sourceRef(source) {
  return {
    assetId: source.assetId,
    assetKind: 'mesh',
    assetVersion: source.assetVersion ?? 1,
    sourceHash: source.sourceHash,
    meshPrimitive: source.meshPrimitive ?? null,
  };
}

function sourceRegistration(source) {
  return {
    source: sourceRef(source),
    positions: source.positions,
    triangles: source.triangles,
    materialSlots: source.materialSlots,
  };
}

function tessellatedPlaneSource(size) {
  const positions = [];
  for (let y = 0; y <= size; y += 1) {
    for (let x = 0; x <= size; x += 1) positions.push([x, y, 0]);
  }
  const row = size + 1;
  const triangles = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const a = y * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      const sourceMaterialSlot = (x + y) % 2;
      triangles.push({ indices: [a, b, d], sourceMaterialSlot });
      triangles.push({ indices: [a, d, c], sourceMaterialSlot });
    }
  }
  return {
    assetId: `mesh/tessellated-plane-${size}`,
    assetVersion: 1,
    sourceHash: `sha256:tessellated-plane-${size}`,
    meshPrimitive: null,
    positions,
    triangles,
    materialSlots: [
      { sourceMaterialSlot: 0, sourceMaterialId: 'mat/a' },
      { sourceMaterialSlot: 1, sourceMaterialId: 'mat/b' },
    ],
  };
}

function cubeSource() {
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const faces = [
    [[0, 1, 2], [0, 2, 3]],
    [[4, 6, 5], [4, 7, 6]],
    [[0, 4, 5], [0, 5, 1]],
    [[1, 5, 6], [1, 6, 2]],
    [[2, 6, 7], [2, 7, 3]],
    [[3, 7, 4], [3, 4, 0]],
  ];
  return {
    assetId: 'mesh/cube',
    assetVersion: 1,
    sourceHash: 'sha256:cube',
    meshPrimitive: null,
    positions,
    triangles: faces.flatMap(([a, b]) => [
      { indices: a, sourceMaterialSlot: 0 },
      { indices: b, sourceMaterialSlot: 0 },
    ]),
    materialSlots: [{ sourceMaterialSlot: 0, sourceMaterialId: 'mat/a' }],
  };
}

function studioTriangleSource() {
  return {
    assetId: 'mesh.demo-cube',
    assetVersion: 1,
    sourceHash: 'sha256:22b58100010034f72eb504d7722aec14b819438bce47e80bf361b3444e238117',
    meshPrimitive: 'default',
    positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    triangles: [{ indices: [0, 1, 2], sourceMaterialSlot: 0 }],
    materialSlots: [{ sourceMaterialSlot: 0, sourceMaterialId: 'material.demo-copper' }],
  };
}

function requestFor(source, overrides = {}) {
  const mode = overrides.mode ?? 'surface';
  const resolution = overrides.resolution ?? [4, 4, 1];
  const maxOutputVoxels = overrides.maxOutputVoxels ?? 16;
  const materialMap = overrides.materialMap ?? {
    entries: [
      { sourceMaterialSlot: 0, sourceMaterialId: 'mat/a', voxelMaterial: 3 },
      { sourceMaterialSlot: 1, sourceMaterialId: 'mat/b', voxelMaterial: 5 },
    ],
    defaultVoxelMaterial: null,
  };
  return {
    source: sourceRef(source),
    target: {
      grid: overrides.grid ?? 7,
      volumeAssetId: overrides.volumeAssetId ?? 'voxel/generated',
      origin: overrides.origin ?? { x: 0, y: 0, z: 0 },
    },
    settings: {
      mode,
      fitPolicy: overrides.fitPolicy ?? 'contain',
      originPolicy: overrides.originPolicy ?? 'target_min',
      resolution,
      voxelSize: overrides.voxelSize ?? 1,
      maxOutputVoxels,
      transform: overrides.transform ?? identityTransform,
      materialMap,
    },
  };
}

function diagnosticCodes(value) {
  return (value.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

function evidenceKinds(rows) {
  return rows.map((entry) => entry.kind);
}

function summaryForPlan(plan) {
  return {
    planId: plan.planId,
    planHash: plan.planHash,
    authorityVersion: plan.authorityVersion,
    estimatedOutputVoxels: plan.estimatedOutputVoxels,
    estimatedBounds: plan.estimatedBounds,
    diagnosticCodes: diagnosticCodes(plan),
    evidence: plan.evidence,
  };
}

function summaryForPreview(preview) {
  return {
    planId: preview.planId,
    outputHash: preview.outputHash,
    outputVoxelCount: preview.outputVoxelCount,
    outputBounds: preview.outputBounds,
    materialIds: [...new Set(preview.sampleVoxels.map((voxel) => voxel.material))].sort((a, b) => a - b),
    sampleCount: preview.sampleVoxels.length,
    diagnosticCodes: diagnosticCodes(preview),
    evidence: preview.evidence,
  };
}

function summaryForReceipt(receipt) {
  return {
    planId: receipt.planId,
    applied: receipt.applied,
    outputHash: receipt.outputHash,
    outputVoxelCount: receipt.outputVoxelCount,
    outputBounds: receipt.outputBounds,
    diagnosticCodes: diagnosticCodes(receipt),
    evidence: receipt.evidence,
  };
}

const nativeArtifact = await ensureNativeBridgeArtifact();
const compatibility = {
  contracts: await readCompatibility(contractsCompatibilityPath),
  runtimeBridge: await readCompatibility(runtimeCompatibilityPath),
};
const sources = {
  ashaEngine: readSource(engineRoot, 'asha-engine'),
  ashaTesting: readSource(repoRoot, 'asha-testing'),
};
const missingOperations = requiredOperations.filter((method) => !MANIFEST_OPERATIONS.some((operation) => operation.facadeMethod === method));
assert.deepEqual(missingOperations, []);

const bridge = createNativeRuntimeBridge();
const session = createRuntimeSessionFacade({ bridge, mode: 'rust' });
session.initialize({
  sessionId: 'asha-testing.voxel-conversion-matrix.native',
  seed: 17,
  project: { gameId: 'asha-testing', workspaceId: 'workspace.local' },
  projectBundle: { bundleSchemaVersion: 1, protocolVersion: 1, sceneId: 42 },
});

const registeredSources = [studioTriangleSource(), tessellatedPlaneSource(4), cubeSource()];
const registrations = registeredSources.map((source) => bridge.registerVoxelConversionSource(sourceRegistration(source)));
assert.ok(registrations.every((registration) => registration.registered));

const acceptedRequest = requestFor(registeredSources[0], {
  grid: 1,
  resolution: [8, 8, 8],
  voxelSize: 0.25,
  maxOutputVoxels: 1024,
  materialMap: {
    entries: [{ sourceMaterialSlot: 0, sourceMaterialId: 'material.demo-copper', voxelMaterial: 1 }],
    defaultVoxelMaterial: 1,
  },
});
const acceptedPlan = session.planVoxelConversion(acceptedRequest);
const acceptedPreview = session.previewVoxelConversion({
  planId: acceptedPlan.planId,
  expectedPlanHash: acceptedPlan.planHash,
});
const acceptedReceipt = session.applyVoxelConversion({
  planId: acceptedPlan.planId,
  expectedPlanHash: acceptedPlan.planHash,
  expectedPreviewHash: acceptedPreview.outputHash,
});
assert.equal(acceptedReceipt.applied, true);
const modelInfo = session.readVoxelModelInfo({
  grid: acceptedRequest.target.grid,
  volumeAssetId: acceptedRequest.target.volumeAssetId,
  includeMaterialCounts: true,
});
assert.equal(modelInfo.resident, true);
const exportedEvidence = session.exportVoxelConversionEvidence([
  ...acceptedPlan.evidence,
  ...acceptedPreview.evidence,
  ...acceptedReceipt.evidence,
]);

const largerPlan = session.planVoxelConversion(requestFor(registeredSources[1], {
  resolution: [5, 5, 1],
  maxOutputVoxels: 32,
}));
const largerPreview = session.previewVoxelConversion({
  planId: largerPlan.planId,
  expectedPlanHash: largerPlan.planHash,
});
assert.equal(largerPlan.estimatedOutputVoxels, 25);

const materialFallbackRequest = requestFor(registeredSources[1], {
  resolution: [5, 5, 1],
  maxOutputVoxels: 32,
  materialMap: {
    entries: [{ sourceMaterialSlot: 0, sourceMaterialId: 'mat/a', voxelMaterial: 3 }],
    defaultVoxelMaterial: 7,
  },
});
const materialFallbackPlan = session.planVoxelConversion(materialFallbackRequest);
const materialFallbackPreview = session.previewVoxelConversion({
  planId: materialFallbackPlan.planId,
  expectedPlanHash: materialFallbackPlan.planHash,
});

const invalidSolidPlan = session.planVoxelConversion(requestFor(registeredSources[1], {
  mode: 'solid',
  resolution: [5, 5, 2],
  maxOutputVoxels: 64,
}));
const overBudgetPlan = session.planVoxelConversion(requestFor(registeredSources[2], {
  mode: 'solid',
  resolution: [2, 2, 2],
  maxOutputVoxels: 7,
}));
const staleSourceRequest = requestFor(registeredSources[2], {
  mode: 'solid',
  resolution: [2, 2, 2],
  maxOutputVoxels: 8,
});
staleSourceRequest.source.sourceHash = 'sha256:stale';
const staleSourcePlan = session.planVoxelConversion(staleSourceRequest);

const rejectedApplyPlan = session.planVoxelConversion(requestFor(registeredSources[1], {
  grid: 1,
  resolution: [5, 5, 1],
  maxOutputVoxels: 32,
}));
const rejectedApplyPreview = session.previewVoxelConversion({
  planId: rejectedApplyPlan.planId,
  expectedPlanHash: rejectedApplyPlan.planHash,
});
const rejectedApplyReceipt = session.applyVoxelConversion({
  planId: rejectedApplyPlan.planId,
  expectedPlanHash: rejectedApplyPlan.planHash,
  expectedPreviewHash: rejectedApplyPreview.outputHash,
});
assert.equal(rejectedApplyReceipt.applied, false);

const boundaryCheck = mustRun('npm', ['run', 'check:boundary'], { cwd: repoRoot, timeout: 30000 });

const cases = {
  acceptedApplyAndModelInfo: {
    source: acceptedRequest.source,
    target: acceptedRequest.target,
    plan: summaryForPlan(acceptedPlan),
    preview: summaryForPreview(acceptedPreview),
    receipt: summaryForReceipt(acceptedReceipt),
    modelInfo: {
      resident: modelInfo.resident,
      modelId: modelInfo.modelId,
      bounds: modelInfo.bounds,
      voxelCount: modelInfo.voxelCount,
      materialCounts: modelInfo.materialCounts,
      latestPlanId: modelInfo.latestPlanId,
      latestOutputHash: modelInfo.latestOutputHash,
      sessionHash: modelInfo.sessionHash,
      replayHash: modelInfo.replayHash,
      evidenceKinds: evidenceKinds(modelInfo.evidence),
      diagnosticCodes: diagnosticCodes(modelInfo),
    },
    exportedEvidence,
  },
  largerMeshPlanPreview: {
    sourceStats: { positions: registeredSources[1].positions.length, triangles: registeredSources[1].triangles.length },
    plan: summaryForPlan(largerPlan),
    preview: summaryForPreview(largerPreview),
  },
  materialMappingFallback: {
    plan: summaryForPlan(materialFallbackPlan),
    preview: summaryForPreview(materialFallbackPreview),
    materialMap: materialFallbackRequest.settings.materialMap,
  },
  negativeTopology: {
    plan: summaryForPlan(invalidSolidPlan),
  },
  outputLimit: {
    plan: summaryForPlan(overBudgetPlan),
  },
  sourceHashMismatch: {
    plan: summaryForPlan(staleSourcePlan),
  },
  rejectedApply: {
    plan: summaryForPlan(rejectedApplyPlan),
    preview: summaryForPreview(rejectedApplyPreview),
    receipt: summaryForReceipt(rejectedApplyReceipt),
  },
};

const artifact = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
  scenario: {
    id: 'native-voxel-conversion-public-consumer-matrix',
    task: 4595,
    parentTask: 4554,
    description: 'Runnable asha-testing evidence matrix for native voxel conversion through public ASHA package roots.',
  },
  publicImports,
  facadeSurface: {
    runtimeSessionMethods: requiredOperations.filter((method) => method !== 'registerVoxelConversionSource'),
    runtimeBridgeRegistrationMethod: 'registerVoxelConversionSource',
    runtimeSessionOnlyGap: 'source registration is still exposed on public RuntimeBridge, not RuntimeSessionFacade',
  },
  runtime: {
    mode: 'native_rust',
    publicPackageRoot: '@asha/runtime-bridge',
    stableOperationCount: STABLE_OPERATION_COUNT,
    requiredOperations,
    missingOperations,
    manifestOperations: MANIFEST_OPERATIONS
      .filter((operation) => requiredOperations.includes(operation.facadeMethod))
      .map((operation) => ({ manifestName: operation.manifestName, facadeMethod: operation.facadeMethod, surface: operation.surface })),
  },
  sources,
  compatibility,
  nativeArtifact,
  registrations,
  cases,
  validations: {
    boundaryCheck: {
      command: boundaryCheck.command,
      status: boundaryCheck.status,
    },
  },
  nonClaims: [
    'not_studio_internal',
    'not_reference_mock_authority',
    'not_renderer_texture_sampling_authority',
    'not_runtime_session_source_registration_yet',
  ],
};

const artifactHash = sha256(artifact);
await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify({ ...artifact, artifactHash }, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
console.log(`artifact hash ${artifactHash}`);
