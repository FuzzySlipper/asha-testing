#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '@asha/contracts';
import {
  RuntimeBridgeError,
  STABLE_OPERATION_COUNT,
  createMockRuntimeBridge,
  createNativeRuntimeBridge,
  frameCursor,
} from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'harness/conformance/fixtures/minimal-world.json');
const outDir = path.join(repoRoot, 'harness/out/conformance/latest');
const artifactPath = path.join(outDir, 'index.json');

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

function classifyNativeAvailability() {
  try {
    const native = createNativeRuntimeBridge();
    native.initializeEngine({ seed: 1 });
    try {
      native.submitCommands({ commands: [] });
      return { status: 'available', detail: 'native facade initialized and submitCommands returned' };
    } catch (error) {
      if (error instanceof RuntimeBridgeError && error.kind === 'operation_unimplemented') {
        return { status: 'unavailable-or-unwired', detail: error.message };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof RuntimeBridgeError && error.kind === 'native_unavailable') {
      return { status: 'unavailable-or-unwired', detail: error.message };
    }
    throw error;
  }
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

const commandResult = bridge.submitCommands({ commands: [fixture.command] });
const stepResult = bridge.stepSimulation(fixture.step);
const renderDiff = bridge.readRenderDiffs(frameCursor(fixture.render.frameCursor));
const saveSummary = bridge.saveCurrentWorld();
const finalStatus = bridge.getCompositionStatus();
const boundaryCheck = runBoundaryCheck();
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);

const workflowEvidence = {
  engineHandle: engineHandle,
  fixture,
  composition,
  commandResult,
  stepResult,
  renderDiff,
  saveSummary,
  finalStatus,
};

const artifact = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
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
    commandResult,
    stepResult,
    renderDiff,
    saveSummary,
    finalStatus,
  },
  artifacts: {
    fixture: path.relative(repoRoot, fixturePath),
    stateHash: stateHash(workflowEvidence),
  },
  boundaryCheck,
  gaps: {
    nativeAuthority: {
      ...classifyNativeAvailability(),
      followUpTask: 2559,
    },
    renderEvidence: {
      status: 'public-render-diff-only',
      followUpTask: 2509,
      detail: 'Task #2509 headless screenshot/render-evidence service is still planned; this harness records deterministic public render diff evidence instead.',
    },
    compatibilityMetadata: {
      status: 'pending-task-2536',
      followUpTask: 2536,
      detail: 'Consumer compatibility metadata is a planned dependency; this artifact records structural evidence without pretending version migration metadata exists.',
    },
  },
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
