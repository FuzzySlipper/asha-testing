#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/publish-evidence/latest');
const evidencePath = path.join(outDir, 'index.json');
const publishArtifactPath = path.join(repoRoot, 'harness/out/publish/latest/index.json');
const publishSmokePath = path.join(repoRoot, 'harness/out/publish-smoke/latest/index.json');
const publishRunSmokePath = path.join(repoRoot, 'harness/out/publish-run-smoke/latest/index.json');
const publishBackendRunSmokePath = path.join(repoRoot, 'harness/out/publish-backend-run-smoke/latest/index.json');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 20000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function requirePassed(result) {
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
}

function parseJsonStdout(result) {
  requirePassed(result);
  return JSON.parse(result.stdout);
}

async function readJsonWithHash(filePath) {
  const text = await readFile(filePath, 'utf8');
  return {
    path: path.relative(repoRoot, filePath),
    hash: sha256(text),
    json: JSON.parse(text),
  };
}

const build = run('npm', ['run', 'publish:artifact']);
requirePassed(build);
const smokeRun = run(process.execPath, ['scripts/run-publish-smoke.mjs']);
requirePassed(smokeRun);
const readback = run(process.execPath, ['scripts/check-publish-artifact.mjs']);
const readbackSummary = parseJsonStdout(readback);
const runSmoke = run('npm', ['run', 'publish:run-smoke']);
requirePassed(runSmoke);
const backendRunSmoke = run('npm', ['run', 'publish:backend-run-smoke']);
requirePassed(backendRunSmoke);

const publishArtifact = await readJsonWithHash(publishArtifactPath);
const publishSmoke = await readJsonWithHash(publishSmokePath);
const publishRunSmoke = await readJsonWithHash(publishRunSmokePath);
const publishBackendRunSmoke = await readJsonWithHash(publishBackendRunSmokePath);

assert.equal(publishArtifact.json.artifactHash, readbackSummary.artifactHash);
assert.equal(publishSmoke.json.readback.artifactHash, readbackSummary.artifactHash);
assert.equal(publishSmoke.json.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
assert.equal(publishArtifact.json.compiledAssets.length, readbackSummary.compiledAssetCount);
assert.equal(publishRunSmoke.json.artifactKind, 'asha_demo_publish_run_smoke');
assert.equal(publishRunSmoke.json.runtime.runtimeMode, 'reference');
assert.equal(publishRunSmoke.json.commandProof.acceptedCommand.status, 'accepted');
assert.equal(publishRunSmoke.json.commandProof.rejectedCommand.status, 'rejected');
assert.equal(publishBackendRunSmoke.json.artifactKind, 'asha_demo_publish_backend_run_smoke');
assert.equal(publishBackendRunSmoke.json.runtime.runtimeMode, 'native');
assert.equal(publishBackendRunSmoke.json.commandProof.acceptedCommand.status, 'accepted');
assert.equal(publishBackendRunSmoke.json.commandProof.rejectedCommand.status, 'rejected');

const evidenceBody = {
  evidenceKind: 'asha_demo_publish_evidence_manifest',
  evidenceVersion: 'publish-evidence.v1',
  generatedAt: 'deterministic-as-structure-only',
  publishArtifact: {
    path: publishArtifact.path,
    fileHash: publishArtifact.hash,
    artifactId: publishArtifact.json.artifactId,
    artifactHash: publishArtifact.json.artifactHash,
    artifactVersion: publishArtifact.json.artifactVersion,
    compiledAssetCount: publishArtifact.json.compiledAssets.length,
    publishAssetCount: publishArtifact.json.publishAssets.entries.length,
    runnableTarget: publishArtifact.json.runnableArtifact.target,
    runnableEntrypointPath: publishArtifact.json.runnableArtifact.entrypointPath,
    runnableEntrypointHash: publishArtifact.json.runnableArtifact.entrypointHash,
    resourcePackManifestPath: publishArtifact.json.resourcePack.manifestPath,
    resourcePackManifestHash: publishArtifact.json.resourcePack.manifestHash,
    runtimeBackedTarget: publishArtifact.json.runtimeBackedArtifact.target,
    runtimeBackedBackendMode: publishArtifact.json.runtimeBackedArtifact.backendMode,
    runtimeBackedBackendProfile: publishArtifact.json.runtimeBackedArtifact.backendProfile,
    runtimeBackedBackendProofRefs: publishArtifact.json.runtimeBackedArtifact.backendProofRefs,
  },
  publishSmoke: {
    path: publishSmoke.path,
    fileHash: publishSmoke.hash,
    checks: publishSmoke.json.checks,
    readback: publishSmoke.json.readback,
  },
  publishRunSmoke: {
    path: publishRunSmoke.path,
    fileHash: publishRunSmoke.hash,
    runnableArtifact: publishRunSmoke.json.runnableArtifact,
    runtime: publishRunSmoke.json.runtime,
    projection: publishRunSmoke.json.projection,
    commandProof: publishRunSmoke.json.commandProof,
    resolvedResourceCount: publishRunSmoke.json.resolvedResources.length,
    checks: publishRunSmoke.json.checks,
  },
  publishBackendRunSmoke: {
    path: publishBackendRunSmoke.path,
    fileHash: publishBackendRunSmoke.hash,
    runtimeBackedArtifact: publishBackendRunSmoke.json.runtimeBackedArtifact,
    runtime: publishBackendRunSmoke.json.runtime,
    projection: publishBackendRunSmoke.json.projection,
    commandProof: publishBackendRunSmoke.json.commandProof,
    resolvedResourceCount: publishBackendRunSmoke.json.resolvedResources.length,
    checks: publishBackendRunSmoke.json.checks,
    noDevServerRequired: publishBackendRunSmoke.json.noDevServerRequired,
  },
  commands: {
    build,
    readback,
    smoke: smokeRun,
    runSmoke,
    backendRunSmoke,
  },
  validations: [
    'publish_artifact_hash_matches_readback',
    'publish_smoke_references_publish_artifact',
    'publish_run_smoke_references_runnable_artifact',
    'runnable_entrypoint_hash_recorded',
    'packed_resource_manifest_hash_recorded',
    'runtime_projection_readback_present',
    'packaged_command_proof_present',
    'backend_runtime_projection_readback_present',
    'backend_packaged_command_proof_present',
    'backend_no_dev_server_smoke_passed',
    'compiled_asset_count_matches_readback',
    'studio_dev_only_dependency_guard_passed',
  ],
  nonClaims: [
    'not_native_runtime_authority',
    'not_wasm_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
    'not_installer',
    'not_package_signing',
  ],
};

const evidenceHash = sha256(stableJson(evidenceBody));
const evidence = {
  ...evidenceBody,
  evidenceId: `asha-demo-publish-evidence:${evidenceHash}`,
  evidenceHash,
};

await mkdir(outDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
