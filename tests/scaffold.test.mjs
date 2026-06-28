import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const repoRoot = new URL('..', import.meta.url);

test('scaffold depends only on Tier 1 ASHA public TypeScript surfaces', () => {
  assert.deepEqual(packageJson.dependencies, {
    '@asha/contracts': 'file:../asha/ts/packages/contracts',
    '@asha/devtools': 'file:../asha/ts/packages/devtools',
    '@asha/game-workspace': 'file:../asha/ts/packages/game-workspace',
    '@asha/runtime-bridge': 'file:../asha/ts/packages/runtime-bridge',
  });
});

test('repo declares itself private and non-product', () => {
  assert.equal(packageJson.private, true);
  assert.match(packageJson.description, /Boundary-proof reference consumer/);
});

test('boundary policy is machine-readable and owns the public ASHA allow list', async () => {
  const policy = JSON.parse(await readFile(new URL('../boundary-policy.json', import.meta.url), 'utf8'));
  assert.deepEqual(policy.typescript.allowedPackages, [
    '@asha/contracts',
    '@asha/runtime-bridge',
    '@asha/devtools',
    '@asha/game-workspace',
  ]);
  assert.deepEqual(policy.rust.allowedCrates, []);
  assert.match(policy.remediation, /public package roots/);
});

test('boundary checker accepts intended public package roots for game workflow', async () => {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const original = await readFile(packageJsonUrl, 'utf8');
  const srcDir = new URL('../src/', import.meta.url);
  const allowedFile = new URL('../src/allowed-public.mjs', import.meta.url);
  try {
    const mutated = JSON.parse(original);
    mutated.dependencies['@asha/devtools'] = 'file:../asha/ts/packages/devtools';
    mutated.dependencies['@asha/game-workspace'] = 'file:../asha/ts/packages/game-workspace';
    await writeFile(packageJsonUrl, `${JSON.stringify(mutated, null, 2)}\n`);
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      allowedFile,
      `import { ASHA_DEVTOOLS_PROTOCOL_VERSION } from '@asha/devtools';\nimport { parseAshaGameManifestToml } from '@asha/game-workspace';\nvoid ASHA_DEVTOOLS_PROTOCOL_VERSION;\nvoid parseAshaGameManifestToml;\n`,
    );

    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await writeFile(packageJsonUrl, original);
  }
});

test('boundary checker rejects forbidden CommonJS require imports', async () => {
  const srcDir = new URL('../src/', import.meta.url);
  const badFile = new URL('../src/bad.cjs', import.meta.url);
  const forbiddenPackage = '@asha/' + 'native-bridge';
  await mkdir(srcDir, { recursive: true });
  try {
    await writeFile(
      badFile,
      `const native = require('${forbiddenPackage}');\nmodule.exports = native;\n`,
    );
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(forbiddenPackage));
  } finally {
    await rm(srcDir, { recursive: true, force: true });
  }
});

test('boundary checker rejects forbidden ASHA package dependencies', async () => {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const original = await readFile(packageJsonUrl, 'utf8');
  const forbiddenPackage = '@asha/' + 'wasm-replay-bridge';
  try {
    const mutated = JSON.parse(original);
    mutated.dependencies[forbiddenPackage] = 'file:../asha/ts/packages/wasm-replay-bridge';
    await writeFile(packageJsonUrl, `${JSON.stringify(mutated, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(forbiddenPackage));
    assert.match(result.stderr, /public package roots/);
  } finally {
    await writeFile(packageJsonUrl, original);
  }
});

test('boundary checker rejects ASHA package-root dependency aliases', async () => {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const original = await readFile(packageJsonUrl, 'utf8');
  try {
    const mutated = JSON.parse(original);
    mutated.dependencies['evil-native'] = 'file:../asha/ts/packages/native-bridge';
    await writeFile(packageJsonUrl, `${JSON.stringify(mutated, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /evil-native/);
    assert.match(result.stderr, /native-bridge/);
    assert.match(result.stderr, /public package roots/);
  } finally {
    await writeFile(packageJsonUrl, original);
  }
});

test('boundary checker rejects npm alias specs for forbidden ASHA packages', async () => {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const original = await readFile(packageJsonUrl, 'utf8');
  const forbiddenPackage = '@asha/' + 'native-bridge';
  try {
    const mutated = JSON.parse(original);
    mutated.dependencies['evil-native'] = `npm:${forbiddenPackage}@1.0.0`;
    await writeFile(packageJsonUrl, `${JSON.stringify(mutated, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /evil-native/);
    assert.match(result.stderr, new RegExp(forbiddenPackage));
    assert.match(result.stderr, /public package roots/);
  } finally {
    await writeFile(packageJsonUrl, original);
  }
});

test('boundary checker rejects forbidden Rust Cargo path dependencies', async () => {
  const cargoToml = new URL('../Cargo.toml', import.meta.url);
  const forbiddenCrate = 'state-store';
  try {
    await writeFile(
      cargoToml,
      `[package]\nname = "asha-demo-boundary-probe"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\n${forbiddenCrate} = { path = "../asha/engine-rs/crates/state/state-store" }\n`,
    );
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /state-store/);
    assert.match(result.stderr, /public package roots/);
  } finally {
    await rm(cargoToml, { force: true });
  }
});

test('boundary checker rejects forbidden Rust Cargo dependency subtable paths', async () => {
  const cargoToml = new URL('../Cargo.toml', import.meta.url);
  const forbiddenCrate = 'state-store';
  try {
    await writeFile(
      cargoToml,
      `[package]\nname = "asha-demo-boundary-probe"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies.${forbiddenCrate}]\npath = "../asha/engine-rs/crates/state/state-store"\n`,
    );
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /state-store/);
    assert.match(result.stderr, /public package roots/);
  } finally {
    await rm(cargoToml, { force: true });
  }
});

test('boundary checker rejects private ASHA TypeScript source imports', async () => {
  const srcDir = new URL('../src/', import.meta.url);
  const badFile = new URL('../src/private-source.mjs', import.meta.url);
  const privateImport = '../asha/ts/packages/runtime-bridge' + '/src/index.ts';
  await mkdir(srcDir, { recursive: true });
  try {
    await writeFile(
      badFile,
      `import { createMockRuntimeBridge } from '${privateImport}';\nvoid createMockRuntimeBridge;\n`,
    );
    const result = spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /runtime-bridge\/src/);
    assert.match(result.stderr, /public package roots/);
  } finally {
    await rm(srcDir, { recursive: true, force: true });
  }
});

test('manifest checker validates the real asha.game.toml', () => {
  const result = spawnSync(process.execPath, ['scripts/check-manifest.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /manifest check: OK/);
});

test('manifest checker fails closed on invalid source-write roots', async () => {
  const manifestUrl = new URL('../asha.game.toml', import.meta.url);
  const original = await readFile(manifestUrl, 'utf8');
  try {
    await writeFile(
      manifestUrl,
      original.replace('allowed_source_writes = ["scenes", "assets", "packages/game-catalogs", "packages/game-policy"]', 'allowed_source_writes = ["../asha/engine-rs"]'),
    );
    const result = spawnSync(process.execPath, ['scripts/check-manifest.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /invalid_write_scope|invalid_path/);
  } finally {
    await writeFile(manifestUrl, original);
  }
});

test('asset catalog checker validates the real demo asset and dev resolution', () => {
  const result = spawnSync(process.execPath, ['scripts/check-assets.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /asset catalog check: OK/);
});

test('dev runtime exposes typed devtools endpoint for a separate headless client', async () => {
  const runtime = spawn(process.execPath, ['scripts/dev-runtime.mjs', '--port', '0'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  runtime.stdout.setEncoding('utf8');
  runtime.stderr.setEncoding('utf8');
  runtime.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  runtime.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const listening = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`dev runtime did not start\n${stdout}\n${stderr}`)), 5000);
      runtime.stdout.on('data', () => {
        const firstLine = stdout.trim().split('\n')[0];
        if (firstLine) {
          clearTimeout(timer);
          resolve(JSON.parse(firstLine));
        }
      });
      runtime.on('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`dev runtime exited before listening: code=${code} signal=${signal}\n${stdout}\n${stderr}`));
      });
    });
    assert.equal(listening.status, 'listening');
    assert.equal(listening.scene.name, 'ASHA Demo Minimal Cube');

    const client = spawnSync(process.execPath, ['scripts/check-devtools-endpoint.mjs', listening.endpoint], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(client.status, 0, client.stdout + client.stderr);
    const smoke = JSON.parse(client.stdout);
    assert.equal(smoke.status, 'ok');
    assert.equal(smoke.projection.worldHash, 'world:1001:1001');
    assert.equal(smoke.command.status, 'accepted');
    assert.equal(smoke.afterProjection.worldHash, 'world:1001:1001:commands:1');
  } finally {
    runtime.kill('SIGTERM');
  }
});

test('headless dev smoke starts runtime, reads endpoint, and writes evidence', async () => {
  await rm(new URL('../harness/out/dev-smoke/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/run-dev-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/dev-smoke\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/dev-smoke/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.scene.sceneId, 1001);
  assert.equal(artifact.scene.name, 'ASHA Demo Minimal Cube');
  assert.equal(artifact.client.status, 'ok');
  assert.equal(artifact.client.projection.worldHash, 'world:1001:1001');
  assert.equal(artifact.client.command.status, 'accepted');
  assert.equal(artifact.client.command.authorityHashAfter, 'authority:1001:commands:1');
  assert.equal(artifact.client.afterProjection.worldHash, 'world:1001:1001:commands:1');
  assert.equal(artifact.shutdown.exitCode, 0);
});

test('publish artifact build writes compiled scene catalog and asset payloads', async () => {
  await rm(new URL('../harness/out/publish/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/publish\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/publish/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_publish_artifact');
  assert.equal(artifact.artifactVersion, 'publish-artifact.v0');
  assert.equal(artifact.game.id, 'asha-demo');
  assert.equal(artifact.commands.publish, 'npm run publish:artifact');
  assert.equal(artifact.commands.verify, 'npm run conformance');
  assert.equal(artifact.scenes.at(0)?.scene.name, 'ASHA Demo Minimal Cube');
  assert.equal(artifact.publishAssets.entries.at(0)?.assetId, 'mesh.demo-cube');
  assert.equal(artifact.compiledAssets.at(0)?.outputKey, 'meshes/demo-cube.mesh.json');
  assert.equal(artifact.compiledAssets.at(0)?.payload.kind, 'inline-static-mesh');
  assert.deepEqual(artifact.nonClaims, [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
  ]);
  assert.match(artifact.artifactHash, /^sha256:/);
});

test('headless devtools client fails when endpoint is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/check-devtools-endpoint.mjs', 'ws://127.0.0.1:1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
});
