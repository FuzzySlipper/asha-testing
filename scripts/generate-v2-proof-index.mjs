#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioRoot = path.resolve(repoRoot, '../asha-studio');
const outDir = path.join(repoRoot, 'harness/out/v2-proof-index/latest');
const indexPath = path.join(outDir, 'index.json');

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
    timeout: 600000,
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

function requirePassed(result) {
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
}

async function readArtifact(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const text = await readFile(absolutePath, 'utf8');
  return {
    path: relativePath,
    sha256: sha256(text),
    json: JSON.parse(text),
  };
}

function ref(kind, artifact, summary = {}) {
  return {
    kind,
    path: artifact.path,
    sha256: artifact.sha256,
    ...summary,
  };
}

const commands = {
  backendAuthority: run('npm', ['run', 'backend:authority-smoke']),
  publishEvidence: run('npm', ['run', 'publish:evidence']),
  publishEvidenceCheck: run('npm', ['run', 'publish:evidence-check']),
  studioLive: run('pnpm', ['run', 'proof:v2-live-backend-evidence'], studioRoot),
  aggregateV1: run('npm', ['run', 'verify:workflow:v1']),
};
for (const result of Object.values(commands)) {
  requirePassed(result);
}

const backendAuthority = await readArtifact('harness/out/backend-authority-smoke/latest/index.json');
const commandEvidence = await readArtifact(backendAuthority.json.artifacts.commandEvidence.path);
const replay = await readArtifact(backendAuthority.json.artifacts.replay.path);
const publishEvidence = await readArtifact('harness/out/publish-evidence/latest/index.json');
const publishBackendRunSmoke = await readArtifact('harness/out/publish-backend-run-smoke/latest/index.json');
const publishArtifact = await readArtifact('harness/out/publish/latest/index.json');
const aggregateV1 = await readArtifact('harness/out/game-workflow-v1/latest/index.json');
const studioLive = await readArtifact('../asha-studio/artifacts/v2-runtime-proof/latest/index.json');

const backendProofRefs = publishArtifact.json.runtimeBackedArtifact.backendProofRefs;
assert.ok(backendProofRefs.length > 0, 'V2 proof index requires backend proof refs');

const indexBody = {
  artifactKind: 'asha_demo_v2_proof_index',
  artifactVersion: 'v2-proof-index.v1',
  generatedAt: 'deterministic-as-structure-only',
  campaign: {
    id: 'asha-v2-runtime-publish-3697',
    projectId: 'asha',
    parentTaskId: 3697,
    taskIds: [3708, 3709, 3710, 3711, 3712, 3713, 3714, 3715, 3716, 3717, 3718],
  },
  commands,
  runtime: {
    mode: publishBackendRunSmoke.json.runtime.runtimeMode,
    launcherName: publishBackendRunSmoke.json.runtime.launcherName,
    backendProfile: publishArtifact.json.runtimeBackedArtifact.backendProfile,
    backendProofRefs,
  },
  proofGroups: {
    backendAuthority: {
      required: true,
      refs: [
        ref('backend-authority-smoke', backendAuthority, {
          runtimeMode: backendAuthority.json.runtime.runtimeMode,
          backendProfile: backendAuthority.json.backend.profile,
        }),
      ],
    },
    replayHash: {
      required: true,
      refs: [
        ref('dev-runtime-command-evidence', commandEvidence),
        ref('command-replay', replay),
      ],
    },
    studioLive: {
      required: true,
      refs: [
        ref('studio-v2-live-backend-evidence', studioLive, {
          runtimeMode: studioLive.json.backend?.mode ?? studioLive.json.backendMode ?? 'native',
        }),
      ],
    },
    publishBackend: {
      required: true,
      refs: [
        ref('publish-artifact', publishArtifact, {
          target: publishArtifact.json.runtimeBackedArtifact.target,
        }),
        ref('publish-evidence', publishEvidence),
        ref('publish-backend-run-smoke', publishBackendRunSmoke, {
          runtimeMode: publishBackendRunSmoke.json.runtime.runtimeMode,
        }),
      ],
    },
    aggregate: {
      required: true,
      refs: [
        ref('game-workflow-v1', aggregateV1),
      ],
    },
  },
  validations: [
    'backend_authority_ref_fresh',
    'replay_hash_ref_fresh',
    'studio_live_backend_ref_fresh',
    'publish_backend_ref_fresh',
    'aggregate_v1_ref_fresh',
    'backend_proof_refs_present',
    'den_summary_is_data_only',
  ],
  nonClaims: [
    'not_runtime_den_dependency',
    'not_store_submission',
    'not_installer',
    'not_package_signing',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
  denIngestableSummary: {
    dataOnly: true,
    projectId: 'asha',
    parentTaskId: 3697,
    completedTaskIds: [3711, 3712, 3713, 3714, 3715, 3716, 3717],
    currentTaskId: 3718,
    artifactPath: 'harness/out/v2-proof-index/latest/index.json',
  },
};

const indexHash = sha256(stableJson(indexBody));
const index = {
  ...indexBody,
  indexId: `asha-demo-v2-proof-index:${indexHash}`,
  indexHash,
};

await mkdir(outDir, { recursive: true });
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, indexPath)}`);
