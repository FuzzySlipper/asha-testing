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
    '@asha/runtime-bridge': 'file:../asha/ts/packages/runtime-bridge',
  });
});

test('repo declares itself private and non-product', () => {
  assert.equal(packageJson.private, true);
  assert.match(packageJson.description, /Boundary-proof reference consumer/);
});

test('boundary policy is machine-readable and owns the public ASHA allow list', async () => {
  const policy = JSON.parse(await readFile(new URL('../boundary-policy.json', import.meta.url), 'utf8'));
  assert.deepEqual(policy.typescript.allowedPackages, ['@asha/contracts', '@asha/runtime-bridge']);
  assert.deepEqual(policy.rust.allowedCrates, []);
  assert.match(policy.remediation, /public facade/);
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
    assert.match(result.stderr, /public facade/);
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
    assert.match(result.stderr, /public facade/);
  } finally {
    await rm(cargoToml, { force: true });
  }
});

test('full conformance harness is intentionally pending #2539', { skip: 'Task #2537 only creates the repo scaffold; #2539 owns load/apply/render/save conformance.' }, () => {
  // Pending by design: no fake engine success in the scaffold task.
});
