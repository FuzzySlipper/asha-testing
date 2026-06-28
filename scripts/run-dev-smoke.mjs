#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outDir = join(repoRoot, 'harness/out/dev-smoke/latest');
const artifactPath = join(outDir, 'index.json');

function waitForListening(runtime, logs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`dev runtime did not start\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`));
    }, 5000);

    runtime.stdout.on('data', () => {
      const firstLine = logs.stdout.trim().split('\n')[0];
      if (firstLine) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(firstLine));
        } catch (error) {
          reject(error);
        }
      }
    });
    runtime.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`dev runtime exited before listening: code=${code} signal=${signal}\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`));
    });
  });
}

async function stopRuntime(runtime) {
  if (runtime.exitCode !== null || runtime.signalCode !== null) return;
  runtime.kill('SIGTERM');
  await new Promise((resolve) => runtime.once('exit', resolve));
}

const logs = { stdout: '', stderr: '' };
const runtime = spawn(process.execPath, ['scripts/dev-runtime.mjs', '--port', '0'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
runtime.stdout.setEncoding('utf8');
runtime.stderr.setEncoding('utf8');
runtime.stdout.on('data', (chunk) => {
  logs.stdout += chunk;
});
runtime.stderr.on('data', (chunk) => {
  logs.stderr += chunk;
});

let listening;
let client;
try {
  listening = await waitForListening(runtime, logs);
  client = spawnSync(process.execPath, ['scripts/check-devtools-endpoint.mjs', listening.endpoint], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(client.status, 0, client.stdout + client.stderr);
} finally {
  await stopRuntime(runtime);
}

const clientSummary = JSON.parse(client.stdout);
const artifact = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
  endpoint: listening.endpoint,
  scene: listening.scene,
  loadedWorld: listening.loadedWorld,
  client: clientSummary,
  logs: {
    runtimeStdout: logs.stdout.trim().split('\n'),
    runtimeStderr: logs.stderr.trim() === '' ? [] : logs.stderr.trim().split('\n'),
  },
  shutdown: {
    exitCode: runtime.exitCode,
    signal: runtime.signalCode,
  },
};

assert.equal(artifact.scene.sceneId, 1001);
assert.equal(artifact.client.projection.worldHash, 'world:1001:1001');
assert.equal(artifact.client.command.status, 'accepted');
assert.equal(artifact.client.afterProjection.worldHash, 'world:1001:1001:commands:1');
assert.equal(artifact.shutdown.exitCode, 0);
assert.equal(artifact.shutdown.signal, null);

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${artifactPath.replace(`${repoRoot}/`, '')}`);
