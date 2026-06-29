#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputProofPath = path.join(repoRoot, 'harness/out/browser-input-proof/latest/index.json');
const replayOutDir = path.join(repoRoot, 'harness/out/browser-input-replay/latest');
const replayPath = path.join(replayOutDir, 'replay.json');
const outDir = path.join(repoRoot, 'harness/out/browser-input-correlation/latest');
const artifactPath = path.join(outDir, 'index.json');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function stateHash(value) {
  return sha256(stableJson(value));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

const inputRun = run('npm', ['run', 'browser:input-proof']);
assert.equal(inputRun.status, 'passed', `${inputRun.stdout}\n${inputRun.stderr}`);
const inputProofText = await readFile(inputProofPath, 'utf8');
const inputProof = JSON.parse(inputProofText);
const inputEvents = inputProof.browserInput.inputEvents;
const typedRequests = inputProof.browserInput.typedRequests;
const gameplayReadbacks = inputProof.browserInput.gameplayReadbacks;

assert.equal(inputEvents.length, typedRequests.length);
assert.equal(typedRequests.length, gameplayReadbacks.length);
const frames = inputEvents.map((event, index) => {
  const request = typedRequests[index];
  const readback = gameplayReadbacks[index];
  assert.equal(event.sequenceId, request.sequenceId);
  assert.equal(request.sequenceId, readback.sequenceId);
  return {
    frameIndex: index,
    sequenceId: event.sequenceId,
    inputSource: event.source,
    typedOperation: request.operation,
    requestHash: stateHash(request),
    readbackHash: stateHash(readback),
  };
});

const replayBody = {
  artifactKind: 'asha_demo_browser_input_replay',
  artifactVersion: 'asha-demo-browser-input-replay.v0',
  generatedAt: 'deterministic-as-structure-only',
  sourceProof: {
    path: 'harness/out/browser-input-proof/latest/index.json',
    artifactHash: inputProof.artifactHash,
    sha256: sha256(inputProofText),
  },
  replayMode: 'browser_input_readback_replay',
  frames,
  finalGameplay: inputProof.browserInput.finalGameplay,
  replayHash: stateHash({ frames, finalGameplay: inputProof.browserInput.finalGameplay }),
  nonClaims: [
    'not_runtime_authority_replay',
    'not_native_runtime_replay',
    'not_command_authority_replay',
  ],
};
const replay = { ...replayBody, artifactHash: stateHash(replayBody) };
const replayText = `${JSON.stringify(replay, null, 2)}\n`;

await mkdir(replayOutDir, { recursive: true });
await writeFile(replayPath, replayText);

const artifactBody = {
  artifactKind: 'asha_demo_browser_input_correlation',
  artifactVersion: 'asha-demo-browser-input-correlation.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run browser:input-correlation',
  commandOutputs: [
    { command: inputRun.command, status: inputRun.status, stdout: inputRun.stdout, stderr: inputRun.stderr },
  ],
  evidenceRefs: [
    {
      kind: 'browser-input-proof',
      path: 'harness/out/browser-input-proof/latest/index.json',
      sha256: sha256(inputProofText),
      artifactHash: inputProof.artifactHash,
    },
    {
      kind: 'browser-input-replay',
      path: 'harness/out/browser-input-replay/latest/replay.json',
      sha256: sha256(replayText),
      artifactHash: replay.artifactHash,
    },
  ],
  correlation: {
    frameCount: frames.length,
    inputSequenceIds: inputEvents.map((event) => event.sequenceId),
    typedRequestSequenceIds: typedRequests.map((request) => request.sequenceId),
    readbackSequenceIds: gameplayReadbacks.map((readback) => readback.sequenceId),
    operations: typedRequests.map((request) => request.operation),
    replayHash: replay.replayHash,
  },
  checks: {
    inputProofArtifactPresent: inputProof.artifactKind === 'asha_demo_browser_input_proof',
    oneTypedRequestPerInputEvent: typedRequests.length === inputEvents.length,
    oneReadbackPerTypedRequest: gameplayReadbacks.length === typedRequests.length,
    sequenceIdsAligned: frames.every((frame, index) =>
      frame.sequenceId === inputEvents[index].sequenceId
      && frame.sequenceId === typedRequests[index].sequenceId
      && frame.sequenceId === gameplayReadbacks[index].sequenceId
    ),
    replayRefHashFresh: true,
  },
  validations: [
    'browser_input_proof_child_passed',
    'browser_input_replay_written',
    'input_typed_request_readback_sequences_aligned',
    'evidence_refs_hashes_recorded',
    'replay_ref_hash_fresh',
  ],
  nonClaims: [
    'not_runtime_authority',
    'not_native_runtime_authority',
    'not_command_authority_replay',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};
const artifact = { ...artifactBody, artifactHash: stateHash(artifactBody) };

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'browser-input-correlation-ready',
  artifact: 'harness/out/browser-input-correlation/latest/index.json',
  replay: 'harness/out/browser-input-replay/latest/replay.json',
  frameCount: frames.length,
}));
