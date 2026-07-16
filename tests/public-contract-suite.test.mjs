import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { createMockRuntimeBridge } from '@asha/runtime-bridge/reference';
import {
  classifyOptionalExecution,
  exercisePublicProvider,
} from '../scripts/run-public-contract-suite.mjs';

const repoRoot = new URL('..', import.meta.url);

test('public provider accepts a stored mutation, rejects a stale mutation, and replays deterministically', () => {
  const behavior = exercisePublicProvider();
  assert.equal(behavior.sceneMutation.accepted, true);
  assert.equal(behavior.sceneMutation.rejectionCode, 'stale-scene-object-snapshot');
  assert.equal(behavior.sceneMutation.rejectedStateUnchanged, true);
  assert.equal(behavior.inputReplay.deterministicAcrossFreshProviders, true);
  assert.equal(behavior.inputReplay.duplicateRejected, true);
  assert.match(behavior.inputReplay.recordHash, /^fnv1a64:[0-9a-f]{16}$/);
});

test('shape-compatible provider with broken stale-write behavior fails the local regression', () => {
  const brokenFactory = () => {
    const provider = createMockRuntimeBridge();
    return new Proxy(provider, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === 'applySceneObjectCommand') {
          return (request) => {
            const result = value.call(target, request);
            if (result.accepted) return result;
            return { ...result, accepted: true, rejection: null };
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  assert.throws(() => exercisePublicProvider(brokenFactory), /true !== false/);
});

test('optional execution states never turn absent or stale work green', () => {
  assert.equal(classifyOptionalExecution({ requested: false, available: true }).state, 'not_run');
  assert.equal(classifyOptionalExecution({ requested: true, available: false }).state, 'unavailable');
  assert.equal(classifyOptionalExecution({
    requested: true,
    available: true,
    currentRevision: 'a'.repeat(40),
    expectedRevision: 'b'.repeat(40),
  }).state, 'stale');
  assert.equal(classifyOptionalExecution({
    requested: true,
    available: true,
    currentRevision: 'a'.repeat(40),
    expectedRevision: 'a'.repeat(40),
  }).state, 'passed');
});

test('default CLI produces an ephemeral synthetic result with native not run', async () => {
  const artifact = new URL('../harness/out/synthetic/latest/index.json', import.meta.url);
  await rm(new URL('../harness/out/synthetic/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/run-public-contract-suite.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ASHA_TEST_NATIVE: '0' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(await readFile(artifact, 'utf8'));
  assert.equal(report.valid, true);
  assert.equal(report.productAcceptanceClaimed, false);
  assert.equal(report.claims.reference.state, 'passed');
  assert.equal(report.claims.native.state, 'not_run');
});
