import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);
const artifactIndex = new URL('../harness/out/conformance/latest/index.json', import.meta.url);

test('public boundary conformance harness emits deterministic artifact metadata', async () => {
  await rm(new URL('../harness/out/conformance/', import.meta.url), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['scripts/run-conformance.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/conformance\/latest\/index\.json/);

  const artifact = JSON.parse(await readFile(artifactIndex, 'utf8'));
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.runtime.mode, 'mock-public-facade');
  assert.equal(artifact.workflow.loadedWorld, 1001);
  assert.deepEqual(artifact.workflow.commandResult, {
    accepted: 1,
    rejected: 0,
    rejections: [],
  });
  assert.deepEqual(artifact.workflow.stepResult, { tick: 1, diffCount: 1 });
  assert.deepEqual(artifact.workflow.renderDiff, { ops: [] });
  assert.equal(artifact.workflow.saveSummary.artifactsWritten, 3);
  assert.match(artifact.artifacts.stateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.boundaryCheck.command, 'npm run check:boundary');
  assert.equal(artifact.boundaryCheck.status, 'passed');
  assert.deepEqual(artifact.publicImports, ['@asha/contracts', '@asha/runtime-bridge']);
  assert.equal(artifact.gaps.nativeAuthority.status, 'unavailable-or-unwired');
  assert.equal(artifact.gaps.nativeAuthority.followUpTask, 2559);
  assert.equal(artifact.gaps.renderEvidence.status, 'public-render-diff-only');
  assert.equal(artifact.gaps.renderEvidence.followUpTask, 2509);
  assert.equal(artifact.gaps.compatibilityMetadata.followUpTask, 2536);
});
