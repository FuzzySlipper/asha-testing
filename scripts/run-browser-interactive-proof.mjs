#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/browser-interactive-proof/latest');
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

async function loadArtifact(relativePath, expectedKind) {
  const text = await readFile(path.join(repoRoot, relativePath), 'utf8');
  const artifact = JSON.parse(text);
  assert.equal(artifact.artifactKind, expectedKind);
  assert.equal(typeof artifact.artifactHash, 'string');
  return {
    path: relativePath,
    artifact,
    sha256: sha256(text),
    artifactHash: artifact.artifactHash,
  };
}

const launchRun = run('npm', ['run', 'browser:demo']);
assert.equal(launchRun.status, 'passed', `${launchRun.stdout}\n${launchRun.stderr}`);
const inputRun = run('npm', ['run', 'browser:input-proof']);
assert.equal(inputRun.status, 'passed', `${inputRun.stdout}\n${inputRun.stderr}`);
const correlationRun = run('npm', ['run', 'browser:input-correlation']);
assert.equal(correlationRun.status, 'passed', `${correlationRun.stdout}\n${correlationRun.stderr}`);
const boundaryRun = run('npm', ['run', 'check:boundary']);
assert.equal(boundaryRun.status, 'passed', `${boundaryRun.stdout}\n${boundaryRun.stderr}`);

const launch = await loadArtifact('harness/out/browser-demo/latest/index.json', 'asha_demo_browser_launch_target');
const input = await loadArtifact('harness/out/browser-input-proof/latest/index.json', 'asha_demo_browser_input_proof');
const correlation = await loadArtifact('harness/out/browser-input-correlation/latest/index.json', 'asha_demo_browser_input_correlation');
const replay = await loadArtifact('harness/out/browser-input-replay/latest/replay.json', 'asha_demo_browser_input_replay');

assert.equal(input.artifact.browserInput.typedRequestCount, input.artifact.browserInput.inputEventCount);
assert.equal(correlation.artifact.checks.sequenceIdsAligned, true);
assert.equal(correlation.artifact.correlation.frameCount, replay.artifact.frames.length);

const artifactBody = {
  artifactKind: 'asha_demo_browser_interactive_proof',
  artifactVersion: 'asha-demo-browser-interactive-proof.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run browser:interactive-proof',
  childArtifacts: [
    { kind: launch.artifact.artifactKind, path: launch.path, sha256: launch.sha256, artifactHash: launch.artifactHash },
    { kind: input.artifact.artifactKind, path: input.path, sha256: input.sha256, artifactHash: input.artifactHash },
    { kind: correlation.artifact.artifactKind, path: correlation.path, sha256: correlation.sha256, artifactHash: correlation.artifactHash },
    { kind: replay.artifact.artifactKind, path: replay.path, sha256: replay.sha256, artifactHash: replay.artifactHash },
  ],
  commandOutputs: [
    { command: launchRun.command, status: launchRun.status, stdout: launchRun.stdout, stderr: launchRun.stderr },
    { command: inputRun.command, status: inputRun.status, stdout: inputRun.stdout, stderr: inputRun.stderr },
    { command: correlationRun.command, status: correlationRun.status, stdout: correlationRun.stdout, stderr: correlationRun.stderr },
    { command: boundaryRun.command, status: boundaryRun.status, stdout: boundaryRun.stdout, stderr: boundaryRun.stderr },
  ],
  browserProof: {
    pagePath: launch.artifact.page.path,
    inputEventCount: input.artifact.browserInput.inputEventCount,
    typedRequestCount: input.artifact.browserInput.typedRequestCount,
    gameplayReadbackCount: input.artifact.browserInput.gameplayReadbackCount,
    operations: correlation.artifact.correlation.operations,
    replayHash: correlation.artifact.correlation.replayHash,
    finalGameplay: input.artifact.browserInput.finalGameplay,
  },
  checks: {
    launchPageReady: launch.artifact.validations.includes('browser_page_written'),
    domInputProofReady: input.artifact.validations.includes('typed_requests_recorded_from_dom_events'),
    replayCorrelationReady: correlation.artifact.validations.includes('input_typed_request_readback_sequences_aligned'),
    boundaryGuardPassed: boundaryRun.status === 'passed',
    childHashesRecorded: true,
  },
  validations: [
    'browser_launch_child_passed',
    'browser_input_child_passed',
    'browser_replay_correlation_child_passed',
    'boundary_guard_passed',
    'child_artifact_hashes_recorded',
    'interactive_browser_readback_ready',
  ],
  nonClaims: [
    'not_runtime_authority',
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
  ],
};
const artifact = { ...artifactBody, artifactHash: stateHash(artifactBody) };

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'browser-interactive-proof-ready',
  artifact: 'harness/out/browser-interactive-proof/latest/index.json',
  inputEventCount: artifact.browserProof.inputEventCount,
}));
