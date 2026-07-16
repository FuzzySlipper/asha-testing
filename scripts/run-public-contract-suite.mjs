#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RuntimeBridgeError,
  createDefaultBrowserInputCatalog,
  createNativeRuntimeBridge,
} from '@asha/runtime-bridge';
import { createMockRuntimeBridge } from '@asha/runtime-bridge/reference';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(repoRoot, 'harness/out/synthetic/latest/index.json');

export const EXECUTION_STATES = Object.freeze([
  'passed',
  'failed',
  'not_run',
  'unavailable',
  'stale',
]);

function gitRevision(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

export function classifyOptionalExecution({ requested, available, currentRevision, expectedRevision }) {
  if (!requested) return { state: 'not_run', reason: 'optional execution was not selected' };
  if (!available) return { state: 'unavailable', reason: 'selected provider prerequisite is absent' };
  if (expectedRevision && currentRevision !== expectedRevision) {
    return {
      state: 'stale',
      reason: `expected engine ${expectedRevision}, found ${currentRevision ?? 'unknown'}`,
    };
  }
  return { state: 'passed', reason: 'selected provider behavior executed at the current revision' };
}

function inputReplayRun(createBridge) {
  const bridge = createBridge();
  bridge.initializeEngine({ seed: 7 });
  const session = bridge.configureInputSession({
    catalog: createDefaultBrowserInputCatalog(),
    initialContexts: ['gameplay'],
  });
  const resolved = bridge.submitRawInput({
    sequence: 0,
    platformKind: 'keyboardKey',
    control: 'KeyW',
    phase: 'pressed',
    value: { kind: 'button', pressed: true },
  });
  assert.equal(resolved.accepted, true);
  assert.equal(resolved.action?.actionId, 'gameplay.move.forward');
  assert.ok(resolved.record);

  const replayed = bridge.replayResolvedInputAction(resolved.record);
  assert.equal(replayed.accepted, true);
  assert.deepEqual(replayed.action, resolved.action);
  assert.equal(replayed.recordHash, resolved.record.recordHash);

  const duplicate = bridge.replayResolvedInputAction(resolved.record);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.diagnostics[0]?.code, 'replayAlreadyDelivered');

  return { session, resolved, replayed, duplicate };
}

export function exercisePublicProvider(createBridge = createMockRuntimeBridge) {
  const bridge = createBridge();
  bridge.initializeEngine({ seed: 11 });

  const before = bridge.readSceneObjectSnapshot();
  const root = before.objects[0];
  assert.ok(root, 'reference scene has a root object');

  const accepted = bridge.applySceneObjectCommand({
    expectedDocumentHash: before.documentHash,
    command: { kind: 'rename', id: root.id, label: 'Synthetic renamed root' },
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.rejection, null);
  assert.equal(accepted.outcome?.snapshot.objects[0]?.label, 'Synthetic renamed root');
  assert.notEqual(accepted.outcome?.snapshot.documentHash, before.documentHash);

  const afterAccepted = bridge.readSceneObjectSnapshot();
  assert.equal(afterAccepted.documentHash, accepted.outcome?.snapshot.documentHash);
  assert.equal(afterAccepted.objects[0]?.label, 'Synthetic renamed root');

  const rejected = bridge.applySceneObjectCommand({
    expectedDocumentHash: before.documentHash,
    command: { kind: 'select', id: root.id },
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.rejection?.code, 'stale-scene-object-snapshot');
  assert.deepEqual(bridge.readSceneObjectSnapshot(), afterAccepted);

  const firstReplay = inputReplayRun(createBridge);
  const secondReplay = inputReplayRun(createBridge);
  assert.deepEqual(secondReplay.resolved.record, firstReplay.resolved.record);
  assert.equal(secondReplay.replayed.replayHash, firstReplay.replayed.replayHash);
  assert.equal(secondReplay.duplicate.replayHash, firstReplay.duplicate.replayHash);

  return {
    sceneMutation: {
      beforeHash: before.documentHash,
      afterHash: afterAccepted.documentHash,
      accepted: accepted.accepted,
      rejectionCode: rejected.rejection?.code,
      rejectedStateUnchanged: true,
    },
    inputReplay: {
      recordHash: firstReplay.resolved.record.recordHash,
      replayHash: firstReplay.replayed.replayHash,
      duplicateReplayHash: firstReplay.duplicate.replayHash,
      deterministicAcrossFreshProviders: true,
      duplicateRejected: true,
    },
  };
}

function optionalNativeClaim() {
  const requested = process.env.ASHA_TEST_NATIVE === '1';
  const expectedRevision = process.env.ASHA_EXPECTED_ENGINE_SHA || null;
  const currentRevision = gitRevision(path.resolve(repoRoot, '../asha-engine'));
  if (!requested) {
    return {
      claimClass: 'provider_integration_execution',
      ...classifyOptionalExecution({ requested, available: false, currentRevision, expectedRevision }),
    };
  }

  try {
    const behavior = exercisePublicProvider(createNativeRuntimeBridge);
    return {
      claimClass: 'provider_integration_execution',
      ...classifyOptionalExecution({ requested, available: true, currentRevision, expectedRevision }),
      behavior,
    };
  } catch (error) {
    if (error instanceof RuntimeBridgeError && error.kind === 'native_unavailable') {
      return {
        claimClass: 'provider_integration_execution',
        ...classifyOptionalExecution({ requested, available: false, currentRevision, expectedRevision }),
        detail: error.message,
      };
    }
    return {
      claimClass: 'provider_integration_execution',
      state: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runSuite() {
  let reference;
  try {
    reference = {
      claimClass: 'synthetic_conformance',
      state: 'passed',
      contract: 'public scene mutation and input replay behavior',
      behavior: exercisePublicProvider(),
    };
  } catch (error) {
    reference = {
      claimClass: 'synthetic_conformance',
      state: 'failed',
      contract: 'public scene mutation and input replay behavior',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const native = optionalNativeClaim();
  const nativeWasRequired = process.env.ASHA_TEST_NATIVE === '1';
  const valid = reference.state === 'passed' && (!nativeWasRequired || native.state === 'passed');
  const report = {
    schemaVersion: 1,
    valid,
    productAcceptanceClaimed: false,
    engineRevision: gitRevision(path.resolve(repoRoot, '../asha-engine')),
    claims: { reference, native },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await runSuite();
  console.log(`synthetic public-contract suite: ${report.valid ? 'OK' : 'FAILED'}`);
  console.log(`reference=${report.claims.reference.state} native=${report.claims.native.state}`);
  console.log(`wrote ${path.relative(repoRoot, outputPath)}`);
  if (!report.valid) process.exitCode = 1;
}
