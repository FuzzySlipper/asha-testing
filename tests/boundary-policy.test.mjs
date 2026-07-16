import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url);

function boundaryCheck() {
  return spawnSync(process.execPath, ['scripts/check-boundary.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('repository depends only on focused public ASHA roots', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.dependencies, {
    '@asha/contracts': 'file:../asha-engine/ts/packages/contracts',
    '@asha/runtime-bridge': 'file:../asha-engine/ts/packages/runtime-bridge',
  });
  assert.equal(packageJson.private, true);
  const result = boundaryCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('boundary checker rejects a raw transport import', async () => {
  const sourceDirectory = new URL('../src/', import.meta.url);
  const source = new URL('../src/raw-transport.mjs', import.meta.url);
  const forbiddenPackage = '@asha/' + 'native-bridge';
  await mkdir(sourceDirectory, { recursive: true });
  try {
    await writeFile(source, `import '${forbiddenPackage}';\n`);
    const result = boundaryCheck();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(forbiddenPackage));
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
  }
});

test('boundary checker rejects an engine authority path dependency', async () => {
  const cargo = new URL('../Cargo.toml', import.meta.url);
  try {
    await writeFile(cargo,
      '[package]\nname = "forbidden-boundary-fixture"\nversion = "0.0.0"\n' +
      'edition = "2021"\n\n[dependencies]\n' +
      'state-store = { path = "../asha-engine/engine-rs/crates/state/state-store" }\n');
    const result = boundaryCheck();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /state-store/);
  } finally {
    await rm(cargo, { force: true });
  }
});
