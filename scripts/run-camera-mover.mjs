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
const outDir = path.join(repoRoot, 'harness/out/camera-mover/latest');
const artifactPath = path.join(outDir, 'index.json');

const requiredCameraOperations = [
  'createCamera',
  'applyFirstPersonCameraInput',
  'readCameraProjection',
];

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

function missingCameraOperations() {
  const facadeMethods = new Set(MANIFEST_OPERATIONS.map((operation) => operation.facadeMethod));
  return requiredCameraOperations.filter((operation) => !facadeMethods.has(operation));
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const bridge = createMockRuntimeBridge();
const engineHandle = bridge.initializeEngine({ seed: fixture.sceneId });
const composition = bridge.loadWorldBundle({
  bundleSchemaVersion: fixture.schemaVersion,
  protocolVersion: fixture.protocolVersion,
  sceneId: fixture.sceneId,
});
assert.equal(composition.blocksLoad, false);

// The current public runtime facade has no camera operation. We still run the
// strongest available public flow so the artifact proves the boundary remained
// intact while recording the missing engine surface honestly.
const commandResult = bridge.submitCommands({ commands: [fixture.command] });
const stepResult = bridge.stepSimulation(fixture.step);
const renderDiff = bridge.readRenderDiffs(frameCursor(fixture.render.frameCursor));
const finalStatus = bridge.getCompositionStatus();
const boundaryCheck = runBoundaryCheck();
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);

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
    kind: 'desiredFirstPersonCameraInput',
    publicSurface: 'missing',
    input: {
      move: { forward: 1, right: 0, up: 0 },
      look: { yawDeltaDegrees: 15, pitchDeltaDegrees: -5 },
      dtSeconds: 0.016666667,
    },
    result: 'not-submitted-no-public-camera-operation',
  },
  {
    order: 4,
    kind: 'readRenderDiffs',
    publicSurface: '@asha/runtime-bridge',
    frameCursor: fixture.render.frameCursor,
    result: renderDiff,
  },
];

const cameraEvidence = {
  status: 'blocked-by-missing-public-camera-surface',
  attemptedPublicSurface: '@asha/runtime-bridge MANIFEST_OPERATIONS',
  availableStableOperations: MANIFEST_OPERATIONS
    .filter((operation) => operation.surface === 'stable')
    .map((operation) => operation.facadeMethod),
  missingOperations: missingCameraOperations(),
  detail:
    'The first-person camera input is recorded as an intended command sequence but not submitted, because the current public contracts/runtime facade expose no camera input/pose/projection operation.',
  engineFeatureRequest: {
    project: 'asha',
    slug: 'first-person-camera-public-surface-request',
    taskId: 2561,
  },
};
assert.deepEqual(cameraEvidence.missingOperations, requiredCameraOperations);

const workflowEvidence = {
  engineHandle,
  fixture,
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
    description:
      'Attempts a first-person camera mover scenario from asha-demo using only public ASHA surfaces; records an engine feature request when the camera surface is absent.',
  },
  repo: {
    name: 'asha-demo',
    path: repoRoot,
  },
  publicImports: ['@asha/contracts', '@asha/runtime-bridge'],
  runtime: {
    mode: 'mock-public-facade',
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
