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

test('publish artifact smoke verifies hashes payloads and writes readback evidence', async () => {
  await rm(new URL('../harness/out/publish-smoke/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/run-publish-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/publish-smoke\/latest\/index\.json/);
  const smoke = JSON.parse(await readFile(new URL('../harness/out/publish-smoke/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(smoke.build.status, 'passed');
  assert.equal(smoke.readback.status, 'ok');
  assert.equal(smoke.readback.compiledAssetCount, 1);
  assert.equal(smoke.readback.publishAssetCount, 1);
  assert.equal(smoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
  assert.ok(smoke.checks.includes('artifact_hash_recomputed'));
  assert.ok(smoke.checks.includes('compiled_assets_match_sources'));
});

test('publish artifact checker rejects dev-only Studio leakage', async () => {
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const original = await readFile(artifactUrl, 'utf8');
  try {
    const artifact = JSON.parse(original);
    artifact.debugOnlyStudioProbe = '../asha-studio';
    await writeFile(artifactUrl, `${JSON.stringify(artifact, null, 2)}\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0);
    assert.match(check.stderr + check.stdout, /dev-only Studio\/attach fragment/);
  } finally {
    await writeFile(artifactUrl, original);
  }
});

test('publish evidence manifest validates build smoke and dependency guard correlation', async () => {
  await rm(new URL('../harness/out/publish-evidence/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/generate-publish-evidence.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/publish-evidence\/latest\/index\.json/);
  const evidence = JSON.parse(await readFile(new URL('../harness/out/publish-evidence/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(evidence.evidenceKind, 'asha_demo_publish_evidence_manifest');
  assert.equal(evidence.evidenceVersion, 'publish-evidence.v0');
  assert.equal(evidence.publishArtifact.artifactVersion, 'publish-artifact.v0');
  assert.equal(evidence.publishArtifact.compiledAssetCount, 1);
  assert.equal(evidence.publishArtifact.artifactHash, evidence.publishSmoke.readback.artifactHash);
  assert.equal(evidence.publishSmoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
  assert.ok(evidence.validations.includes('publish_artifact_hash_matches_readback'));
  assert.ok(evidence.validations.includes('studio_dev_only_dependency_guard_passed'));
  assert.deepEqual(evidence.nonClaims, [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
  ]);
  assert.match(evidence.evidenceId, /^asha-demo-publish-evidence:sha256:/);
  assert.match(evidence.evidenceHash, /^sha256:/);
});

test('aggregate game workflow verification gates dev Studio attach and publish', async () => {
  await rm(new URL('../harness/out/game-workflow/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/verify-game-workflow.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 90000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/game-workflow\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/game-workflow/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_game_workflow_verification');
  assert.equal(artifact.commands.devSmoke.status, 'passed');
  assert.equal(artifact.commands.publishEvidence.status, 'passed');
  assert.equal(artifact.commands.studioTests.status, 'passed');
  assert.equal(artifact.commands.studioBoundaries.status, 'passed');
  assert.equal(artifact.artifacts.devSmoke.worldHash, 'world:1001:1001');
  assert.equal(artifact.artifacts.devSmoke.afterCommandWorldHash, 'world:1001:1001:commands:1');
  assert.match(artifact.artifacts.publishEvidence.evidenceHash, /^sha256:/);
  assert.ok(artifact.validations.includes('devtools_attach_smoke_passed'));
  assert.ok(artifact.validations.includes('studio_attach_tests_passed'));
  assert.ok(artifact.validations.includes('publish_evidence_passed'));
  assert.match(artifact.artifactId, /^asha-demo-game-workflow:sha256:/);
});

test('publish artifact checker fails closed on stale artifact hashes', async () => {
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const original = await readFile(artifactUrl, 'utf8');
  try {
    const artifact = JSON.parse(original);
    artifact.artifactHash = 'sha256:stale';
    await writeFile(artifactUrl, `${JSON.stringify(artifact, null, 2)}\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0);
    assert.match(check.stderr + check.stdout, /sha256:stale/);
  } finally {
    await writeFile(artifactUrl, original);
  }
});

test('headless devtools client fails when endpoint is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/check-devtools-endpoint.mjs', 'ws://127.0.0.1:1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
});
