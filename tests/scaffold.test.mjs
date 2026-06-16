import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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

test('full conformance harness is intentionally pending #2539', { skip: 'Task #2537 only creates the repo scaffold; #2539 owns load/apply/render/save conformance.' }, () => {
  // Pending by design: no fake engine success in the scaffold task.
});
