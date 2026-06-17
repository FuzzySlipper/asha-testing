#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '@asha/contracts';
import {
  MANIFEST_OPERATIONS,
  STABLE_OPERATION_COUNT,
  createMockRuntimeBridge,
  frameCursor,
} from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'harness/conformance/fixtures/minimal-world.json');
const contractsCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/contracts/compatibility.json');
const runtimeCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/runtime-bridge/compatibility.json');
const outDir = path.join(repoRoot, 'harness/out/camera-mover/latest');
const artifactPath = path.join(outDir, 'index.json');

const requiredCameraOperations = [
  'createCamera',
  'applyFirstPersonCameraInput',
  'readCameraProjection',
];

const cameraScenario = {
  initialPose: { position: [0, 1.6, 0], yawDegrees: 0, pitchDegrees: 0 },
  projection: { fovYDegrees: 60, near: 0.1, far: 1000 },
  viewport: { width: 1280, height: 720 },
  input: {
    moveForward: 1,
    moveRight: 0,
    moveUp: 0,
    yawDeltaDegrees: 15,
    pitchDeltaDegrees: -5,
    dtSeconds: 1 / 60,
    moveSpeedUnitsPerSecond: 3,
  },
  tick: 1,
};

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stateHash(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function runBoundaryCheck() {
  const result = spawnSync('npm', ['run', 'check:boundary'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return {
    command: 'npm run check:boundary',
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function gitOutput(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function readAshaSource() {
  const ashaPath = path.resolve(repoRoot, '../asha');
  return {
    path: ashaPath,
    branch: gitOutput(ashaPath, ['branch', '--show-current']),
    commit: gitOutput(ashaPath, ['rev-parse', 'HEAD']),
  };
}

function missingCameraOperations() {
  const facadeMethods = new Set(MANIFEST_OPERATIONS.map((operation) => operation.facadeMethod));
  return requiredCameraOperations.filter((operation) => !facadeMethods.has(operation));
}

async function readCompatibility(filePath) {
  const metadata = JSON.parse(await readFile(filePath, 'utf8'));
  return {
    surface: metadata.surface,
    compatibilityVersion: metadata.compatibilityVersion,
    packageVersion: metadata.packageVersion,
  };
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const ashaSource = readAshaSource();
const compatibility = {
  contracts: await readCompatibility(contractsCompatibilityPath),
  runtimeBridge: await readCompatibility(runtimeCompatibilityPath),
};
const bridge = createMockRuntimeBridge();
const engineHandle = bridge.initializeEngine({ seed: fixture.sceneId });
const composition = bridge.loadWorldBundle({
  bundleSchemaVersion: fixture.schemaVersion,
  protocolVersion: fixture.protocolVersion,
  sceneId: fixture.sceneId,
});
assert.equal(composition.blocksLoad, false);

const missingOperations = missingCameraOperations();
assert.deepEqual(missingOperations, []);

const commandResult = bridge.submitCommands({ commands: [fixture.command] });
const stepResult = bridge.stepSimulation(fixture.step);
const beforeCamera = bridge.createCamera({
  initialPose: cameraScenario.initialPose,
  projection: cameraScenario.projection,
  viewport: cameraScenario.viewport,
});
const afterCamera = bridge.applyFirstPersonCameraInput({
  camera: beforeCamera.camera,
  tick: cameraScenario.tick,
  input: cameraScenario.input,
});
const projectionSnapshot = bridge.readCameraProjection({ camera: afterCamera.camera, viewport: null });
const renderDiff = bridge.readRenderDiffs(frameCursor(fixture.render.frameCursor));
const finalStatus = bridge.getCompositionStatus();
const boundaryCheck = runBoundaryCheck();
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);
assert.notDeepEqual(afterCamera.pose, beforeCamera.pose);
assert.match(projectionSnapshot.projectionHash, /^fnv1a64:[0-9a-f]{16}$/);

const commandSequence = [
  {
    order: 1,
    kind: 'loadWorldBundle',
    publicSurface: '@asha/runtime-bridge',
    result: { loadedWorld: composition.loadedWorld, blocksLoad: composition.blocksLoad },
  },
  {
    order: 2,
    kind: 'submitCommands',
    publicSurface: '@asha/runtime-bridge',
    command: fixture.command,
    result: commandResult,
  },
  {
    order: 3,
    kind: 'createCamera',
    publicSurface: '@asha/runtime-bridge',
    input: {
      initialPose: cameraScenario.initialPose,
      projection: cameraScenario.projection,
      viewport: cameraScenario.viewport,
    },
    result: beforeCamera,
  },
  {
    order: 4,
    kind: 'applyFirstPersonCameraInput',
    publicSurface: '@asha/runtime-bridge',
    input: { camera: beforeCamera.camera, tick: cameraScenario.tick, input: cameraScenario.input },
    result: afterCamera,
  },
  {
    order: 5,
    kind: 'readCameraProjection',
    publicSurface: '@asha/runtime-bridge',
    input: { camera: afterCamera.camera, viewport: null },
    result: {
      camera: projectionSnapshot.camera,
      tick: projectionSnapshot.tick,
      projectionHash: projectionSnapshot.projectionHash,
    },
  },
  {
    order: 6,
    kind: 'readRenderDiffs',
    publicSurface: '@asha/runtime-bridge',
    frameCursor: fixture.render.frameCursor,
    result: renderDiff,
  },
];

const cameraEvidence = {
  status: 'public-camera-surface-produced-projection-evidence',
  publicSurface: '@asha/runtime-bridge',
  runtimeMode: 'mock-public-facade-deterministic-reference',
  availableStableOperations: MANIFEST_OPERATIONS
    .filter((operation) => operation.surface === 'stable')
    .map((operation) => operation.facadeMethod),
  missingOperations,
  inputSequence: cameraScenario,
  beforePose: beforeCamera.pose,
  afterPose: afterCamera.pose,
  beforeSnapshot: beforeCamera,
  afterSnapshot: afterCamera,
  projectionSnapshot,
};

const workflowEvidence = {
  engineHandle,
  fixture,
  compatibility,
  composition,
  commandSequence,
  stepResult,
  finalStatus,
  cameraEvidence,
};

const artifact = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
  scenario: {
    name: 'first-person-camera-mover-public-surface-prototype',
    task: 2540,
    followUpTask: 2566,
    description:
      'Runs a first-person camera mover scenario from asha-demo using only public ASHA contracts/runtime bridge surfaces and records deterministic movement/projection evidence.',
  },
  repo: {
    name: 'asha-demo',
    path: repoRoot,
  },
  ashaSource,
  compatibility,
  publicImports: ['@asha/contracts', '@asha/runtime-bridge'],
  runtime: {
    mode: 'mock-public-facade-deterministic-reference',
    nativeMode: 'not-used',
    stableOperationCount: STABLE_OPERATION_COUNT,
  },
  workflow: {
    loadedWorld: composition.loadedWorld,
    commandSequence,
    commandResult,
    stepResult,
    renderDiff,
    finalStatus,
  },
  cameraEvidence,
  artifacts: {
    fixture: path.relative(repoRoot, fixturePath),
    stateHash: stateHash(workflowEvidence),
  },
  boundaryCheck,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
