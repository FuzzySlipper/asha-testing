#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/publish-smoke/latest');
const artifactPath = path.join(outDir, 'index.json');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
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

function parseJsonStdout(result) {
  assert.equal(result.status, 'passed', `${result.command}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const build = run('npm', ['run', 'publish:artifact']);
assert.equal(build.status, 'passed', `${build.stdout}\n${build.stderr}`);

const readback = run(process.execPath, ['scripts/check-publish-artifact.mjs']);
const summary = parseJsonStdout(readback);
assert.equal(summary.status, 'ok');
assert.equal(summary.compiledAssetCount, summary.publishAssetCount);
assert.ok(summary.artifactHash.startsWith('sha256:'));
assert.equal(summary.packedResourceProfile.outputDir, 'publish_resource_profile.output_dir');
assert.equal(summary.packedResourceProfile.resourceManifestPath, 'harness/out/publish/runnable/latest/resources/manifest.json');
assert.equal(summary.packedResources.length, summary.publishAssetCount);
assert.ok(summary.dependencyGuard.inspectedRunnableFiles.includes('harness/out/publish/runnable/latest/index.html'));
for (const resource of summary.packedResources) {
  assert.ok(resource.outputKey.length > 0);
  assert.match(resource.sourceHash, /^sha256:/);
  assert.match(resource.packedHash, /^sha256:/);
  assert.match(resource.runnableHash, /^sha256:/);
}

const smoke = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
  build,
  readback: summary,
  checks: [
    'publish_artifact_built',
    'artifact_hash_recomputed',
    'compiled_assets_match_sources',
    'packed_resources_match_publish_profile',
    'no_dev_local_resource_reads',
    'runnable_dependency_guard_passed',
    'non_claims_preserved',
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(smoke, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
