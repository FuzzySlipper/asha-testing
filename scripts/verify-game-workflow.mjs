#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioRoot = path.resolve(repoRoot, '../asha-studio');
const outDir = path.join(repoRoot, 'harness/out/game-workflow/latest');
const artifactPath = path.join(outDir, 'index.json');

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

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
  });
  return {
    command: [command, ...args].join(' '),
    cwd: path.relative(repoRoot, cwd) || '.',
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function readArtifact(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const text = await readFile(absolutePath, 'utf8');
  return {
    path: relativePath,
    fileHash: sha256(text),
    json: JSON.parse(text),
  };
}

function requirePassed(result) {
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
}

if (!existsSync(studioRoot)) {
  throw new Error(`missing sibling Studio repo: ${studioRoot}`);
}

const commands = {
  manifest: run('npm', ['run', 'check:manifest']),
  assets: run('npm', ['run', 'check:assets']),
  publicArtifacts: run('npm', ['run', 'check:public-artifacts']),
  boundary: run('npm', ['run', 'check:boundary']),
  devSmoke: run('npm', ['run', 'dev:smoke']),
  publishEvidence: run('npm', ['run', 'publish:evidence']),
  studioTests: run('pnpm', ['run', 'test'], studioRoot),
  studioBoundaries: run('pnpm', ['run', 'check:boundaries'], studioRoot),
};

for (const result of Object.values(commands)) {
  requirePassed(result);
}

const devSmoke = await readArtifact('harness/out/dev-smoke/latest/index.json');
const publishEvidence = await readArtifact('harness/out/publish-evidence/latest/index.json');
assert.equal(devSmoke.json.client.status, 'ok');
assert.equal(devSmoke.json.client.command.status, 'accepted');
assert.equal(publishEvidence.json.publishSmoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');

const body = {
  artifactKind: 'asha_demo_game_workflow_verification',
  artifactVersion: 'game-workflow-verification.v0',
  generatedAt: 'deterministic-as-structure-only',
  commands,
  artifacts: {
    devSmoke: {
      path: devSmoke.path,
      fileHash: devSmoke.fileHash,
      worldHash: devSmoke.json.client.projection.worldHash,
      afterCommandWorldHash: devSmoke.json.client.afterProjection.worldHash,
    },
    publishEvidence: {
      path: publishEvidence.path,
      fileHash: publishEvidence.fileHash,
      evidenceId: publishEvidence.json.evidenceId,
      evidenceHash: publishEvidence.json.evidenceHash,
      publishArtifactHash: publishEvidence.json.publishArtifact.artifactHash,
    },
  },
  validations: [
    'manifest_valid',
    'assets_valid',
    'public_artifacts_available',
    'demo_boundary_passed',
    'devtools_attach_smoke_passed',
    'publish_evidence_passed',
    'studio_attach_tests_passed',
    'studio_boundaries_passed',
  ],
  nonClaims: [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
  ],
};

const artifactHash = sha256(stableJson(body));
const artifact = {
  ...body,
  artifactId: `asha-demo-game-workflow:${artifactHash}`,
  artifactHash,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
