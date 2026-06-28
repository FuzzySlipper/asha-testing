import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const repoRoot = new URL('..', import.meta.url);

test('scaffold depends only on Tier 1 ASHA public TypeScript surfaces', () => {
  assert.deepEqual(packageJson.dependencies, {
    '@asha/contracts': 'file:../asha/ts/packages/contracts',
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
