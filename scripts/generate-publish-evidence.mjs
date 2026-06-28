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
const readback = run(process.execPath, ['scripts/check-publish-artifact.mjs']);
const readbackSummary = parseJsonStdout(readback);
const smokeRun = run(process.execPath, ['scripts/run-publish-smoke.mjs']);
requirePassed(smokeRun);

const publishArtifact = await readJsonWithHash(publishArtifactPath);
const publishSmoke = await readJsonWithHash(publishSmokePath);

assert.equal(publishArtifact.json.artifactHash, readbackSummary.artifactHash);
assert.equal(publishSmoke.json.readback.artifactHash, readbackSummary.artifactHash);
assert.equal(publishSmoke.json.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
assert.equal(publishArtifact.json.compiledAssets.length, readbackSummary.compiledAssetCount);

const evidenceBody = {
  evidenceKind: 'asha_demo_publish_evidence_manifest',
  evidenceVersion: 'publish-evidence.v0',
  generatedAt: 'deterministic-as-structure-only',
  publishArtifact: {
    path: publishArtifact.path,
    fileHash: publishArtifact.hash,
    artifactId: publishArtifact.json.artifactId,
    artifactHash: publishArtifact.json.artifactHash,
    artifactVersion: publishArtifact.json.artifactVersion,
    compiledAssetCount: publishArtifact.json.compiledAssets.length,
    publishAssetCount: publishArtifact.json.publishAssets.entries.length,
  },
  publishSmoke: {
    path: publishSmoke.path,
    fileHash: publishSmoke.hash,
    checks: publishSmoke.json.checks,
    readback: publishSmoke.json.readback,
  },
  commands: {
    build,
    readback,
    smoke: smokeRun,
  },
  validations: [
    'publish_artifact_hash_matches_readback',
    'publish_smoke_references_publish_artifact',
    'compiled_asset_count_matches_readback',
    'studio_dev_only_dependency_guard_passed',
  ],
  nonClaims: [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
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
