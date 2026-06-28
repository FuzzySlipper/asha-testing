#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outDir = join(repoRoot, 'harness/out/dev-authority-smoke/latest');
const artifactPath = join(outDir, 'index.json');

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout.trim().split('\n').filter(Boolean),
    stderr: result.stderr.trim() === '' ? [] : result.stderr.trim().split('\n'),
  };
}

const devSmokeRun = run(process.execPath, ['scripts/run-dev-smoke.mjs']);
const evidenceCheckRun = run(process.execPath, ['scripts/check-dev-runtime-command-evidence.mjs']);

const devSmokeText = await readFile(join(repoRoot, 'harness/out/dev-smoke/latest/index.json'), 'utf8');
const devSmoke = JSON.parse(devSmokeText);
const evidenceText = await readFile(join(repoRoot, devSmoke.client.evidence.path), 'utf8');
const evidence = JSON.parse(evidenceText);

assert.equal(devSmoke.client.runtime.runtimeMode, 'reference');
assert.equal(devSmoke.client.command.status, 'accepted');
assert.equal(devSmoke.client.rejectedCommand.status, 'rejected');
assert.notEqual(devSmoke.client.command.authorityHashBefore, devSmoke.client.command.authorityHashAfter);
assert.equal(devSmoke.client.rejectedCommand.authorityHashBefore, devSmoke.client.rejectedCommand.authorityHashAfter);

const artifact = {
  artifactKind: 'asha_demo_dev_authority_smoke',
  artifactVersion: 'dev-authority-smoke.v1',
  generatedAt: 'deterministic-as-structure-only',
  commands: {
    devSmoke: devSmokeRun,
    evidenceCheck: evidenceCheckRun,
  },
  runtime: devSmoke.client.runtime,
  acceptedCommand: devSmoke.client.command,
  rejectedCommand: devSmoke.client.rejectedCommand,
  projection: {
    beforeWorldHash: devSmoke.client.projection.worldHash,
    afterAcceptedWorldHash: devSmoke.client.afterProjection.worldHash,
    commandEvidenceProjectionHash: evidence.projection.worldHash,
  },
  artifacts: {
    devSmoke: {
      path: 'harness/out/dev-smoke/latest/index.json',
      sha256: sha256(devSmokeText),
    },
    replay: devSmoke.client.replay,
    commandEvidence: {
      ...devSmoke.client.evidence,
      sha256: sha256(evidenceText),
    },
  },
  validations: [
    'runtime_mode_reference',
    'accepted_command_mutated_authority',
    'rejected_command_preserved_authority',
    'command_evidence_readback_passed',
    'non_claims_present',
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${artifactPath.replace(`${repoRoot}/`, '')}`);
