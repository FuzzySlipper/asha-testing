import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import {
  buildAshaAuthoringPersistenceContract,
  parseAshaGameManifestToml,
  resolveAshaAuthoringWriteTarget,
} from '@asha/game-workspace';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const repoRoot = new URL('..', import.meta.url);

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

function rehashPublishArtifact(artifact) {
  const { artifactHash, artifactId, ...body } = artifact;
  void artifactHash;
  void artifactId;
  const nextHash = sha256(stableJson(body));
  return {
    ...artifact,
    artifactId: `asha-demo-publish:${nextHash}`,
    artifactHash: nextHash,
  };
}

function rehashV2ProofIndex(index) {
  const { indexHash, indexId, ...body } = index;
  void indexHash;
  void indexId;
  const nextHash = sha256(stableJson(body));
  return {
    ...index,
    indexId: `asha-demo-v2-proof-index:${nextHash}`,
    indexHash: nextHash,
  };
}

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

test('boundary checker rejects forbidden raw runtime transport ESM imports', async () => {
  const srcDir = new URL('../src/', import.meta.url);
  const badFile = new URL('../src/raw-transport.mjs', import.meta.url);
  const forbiddenPackage = '@asha/' + 'wasm-replay-bridge';
  await mkdir(srcDir, { recursive: true });
  try {
    await writeFile(
      badFile,
      `import * as replayTransport from '${forbiddenPackage}';\nvoid replayTransport;\n`,
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

test('asset catalog checker fails closed on unsupported asset kind', async () => {
  const catalogUrl = new URL('../packages/game-catalogs/catalog.json', import.meta.url);
  const original = await readFile(catalogUrl, 'utf8');
  try {
    const catalog = JSON.parse(original);
    catalog.entries[0].kind = 'shader';
    await writeFile(catalogUrl, `${JSON.stringify(catalog, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-assets.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /unsupported_asset_kind/);
  } finally {
    await writeFile(catalogUrl, original);
  }
});

test('asset catalog checker fails closed on stale import metadata', async () => {
  const catalogUrl = new URL('../packages/game-catalogs/catalog.json', import.meta.url);
  const original = await readFile(catalogUrl, 'utf8');
  try {
    const catalog = JSON.parse(original);
    catalog.entries[0].importMetadata.sourceHash = 'sha256:stale';
    await writeFile(catalogUrl, `${JSON.stringify(catalog, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-assets.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /stale_import_metadata/);
  } finally {
    await writeFile(catalogUrl, original);
  }
});

test('asset catalog checker fails closed on missing dependency', async () => {
  const catalogUrl = new URL('../packages/game-catalogs/catalog.json', import.meta.url);
  const original = await readFile(catalogUrl, 'utf8');
  try {
    const catalog = JSON.parse(original);
    catalog.entries[0].dependencies = ['asset.missing'];
    await writeFile(catalogUrl, `${JSON.stringify(catalog, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-assets.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /missing_asset_dependency/);
  } finally {
    await writeFile(catalogUrl, original);
  }
});

test('proof scene checker validates named scenes and catalog references', () => {
  const result = spawnSync('npm', ['run', 'scene:proof'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /proof scene check: OK/);
});

test('proof scene checker fails closed on missing catalog references', async () => {
  const sceneUrl = new URL('../scenes/material-proof.scene.json', import.meta.url);
  const original = await readFile(sceneUrl, 'utf8');
  try {
    const scene = JSON.parse(original);
    scene.catalogAssetIds.push('asset.missing');
    await writeFile(sceneUrl, `${JSON.stringify(scene, null, 2)}\n`);
    const result = spawnSync(process.execPath, ['scripts/check-proof-scenes.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /asset\.missing/);
  } finally {
    await writeFile(sceneUrl, original);
  }
});

test('asset inventory read model reports dev and publish resolution', async () => {
  const publish = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(publish.status, 0, publish.stdout + publish.stderr);
  const result = spawnSync('npm', ['run', 'asset:inventory'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/asset-inventory\/latest\/index\.json/);
  const inventory = JSON.parse(await readFile(new URL('../harness/out/asset-inventory/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(inventory.artifactKind, 'asha_demo_asset_inventory');
  assert.equal(inventory.status, 'ok');
  assert.deepEqual(inventory.dependencyOrder, ['texture.demo-checker', 'material.demo-copper', 'mesh.demo-cube']);
  const mesh = inventory.entries.find((entry) => entry.assetId === 'mesh.demo-cube');
  assert.equal(mesh.devResolution.importStatus, 'clean');
  assert.match(mesh.devResolution.sourceHash, /^sha256:/);
  assert.equal(mesh.publishResolution.outputKey, 'meshes/demo-cube.mesh.json');
  assert.match(mesh.publishResolution.packedHash, /^sha256:/);
  assert.equal(mesh.evidenceRefs.some((ref) => ref.kind === 'source'), true);
});

test('asset inventory read model carries missing asset and stale metadata diagnostics', async () => {
  const catalogUrl = new URL('../packages/game-catalogs/catalog.json', import.meta.url);
  const badUrl = new URL('../harness/out/asset-inventory/bad-catalog.json', import.meta.url);
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
  catalog.entries[1].importMetadata.sourceHash = 'sha256:stale';
  catalog.entries[2].source = 'assets/textures/missing.texture.json';
  await mkdir(new URL('../harness/out/asset-inventory/', import.meta.url), { recursive: true });
  await writeFile(badUrl, `${JSON.stringify(catalog, null, 2)}\n`);
  const result = spawnSync(process.execPath, ['scripts/build-asset-inventory.mjs', 'harness/out/asset-inventory/bad-catalog.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const inventory = JSON.parse(await readFile(new URL('../harness/out/asset-inventory/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(inventory.status, 'diagnostics');
  assert.equal(inventory.diagnostics.some((diagnostic) => diagnostic.code === 'missing_asset_file'), true);
  assert.equal(inventory.diagnostics.some((diagnostic) => diagnostic.code === 'stale_import_metadata'), true);
  await rm(badUrl, { force: true });
});

test('asset/resource V1 aggregate verification writes evidence', async () => {
  await rm(new URL('../harness/out/assets-v1/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'verify:assets-v1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/assets-v1\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/assets-v1/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_assets_v1_verification');
  assert.equal(artifact.artifacts.publishArtifact.resourcePackEntryCount, 3);
  assert.equal(artifact.artifacts.assetInventory.entryCount, 3);
  assert.ok(artifact.validations.includes('resource_pack_readback_valid'));
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
    assert.equal(listening.proofScenes.some((scene) => scene.name === 'ASHA Demo Material Proof'), true);

    const client = spawnSync(process.execPath, ['scripts/check-devtools-endpoint.mjs', listening.endpoint], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(client.status, 0, client.stdout + client.stderr);
    const smoke = JSON.parse(client.stdout);
    assert.equal(smoke.status, 'ok');
    assert.equal(smoke.runtime.runtimeMode, 'native');
    assert.equal(smoke.runtime.launcherName, 'native-game-runtime-launcher');
    assert.equal(smoke.runtime.backendProfile, 'native.napi.launcher.v1');
    assert.equal(smoke.projection.worldHash, 'native-world:asha-demo:1001:accepted:0');
    assert.equal(smoke.command.status, 'accepted');
    assert.equal(smoke.rejectedCommand.status, 'rejected');
    assert.equal(smoke.rejectedCommand.authorityHashAfter, smoke.command.authorityHashAfter);
    assert.equal(smoke.afterProjection.worldHash, 'native-world:asha-demo:1001:accepted:1');
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
  assert.deepEqual(
    artifact.proofScenes.find((scene) => scene.name === 'ASHA Demo Material Proof')?.catalogAssetIds,
    ['mesh.demo-cube', 'material.demo-copper', 'texture.demo-checker'],
  );
  assert.equal(artifact.client.status, 'ok');
  assert.equal(artifact.client.runtime.runtimeMode, 'native');
  assert.equal(artifact.client.runtime.launcherName, 'native-game-runtime-launcher');
  assert.equal(artifact.client.runtime.backendProfile, 'native.napi.launcher.v1');
  assert.equal(artifact.client.projection.worldHash, 'native-world:asha-demo:1001:accepted:0');
  assert.equal(artifact.client.command.status, 'accepted');
  assert.equal(artifact.client.command.authorityHashAfter, 'native-authority:workspace.local:1001:accepted:1');
  assert.equal(artifact.client.rejectedCommand.status, 'rejected');
  assert.equal(artifact.client.rejectedCommand.authorityHashAfter, artifact.client.command.authorityHashAfter);
  assert.equal(artifact.client.afterProjection.worldHash, 'native-world:asha-demo:1001:accepted:1');
  assert.equal(artifact.client.replay.path, 'harness/out/replay/dev-smoke-command-path.json');
  assert.equal(artifact.client.evidence.path, 'harness/out/devtools/latest/index.json');
  assert.equal(artifact.shutdown.exitCode, 0);
});

test('dev runtime command evidence readback fails closed on missing authority hashes', async () => {
  const smoke = spawnSync(process.execPath, ['scripts/run-dev-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);

  const good = spawnSync(process.execPath, ['scripts/check-dev-runtime-command-evidence.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /dev runtime command evidence check: OK/);

  const evidenceUrl = new URL('../harness/out/devtools/latest/index.json', import.meta.url);
  const badUrl = new URL('../harness/out/devtools/latest/bad-missing-before.json', import.meta.url);
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  delete evidence.commandReceipts[0].authorityHashBefore;
  await writeFile(badUrl, `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    const bad = spawnSync(process.execPath, ['scripts/check-dev-runtime-command-evidence.mjs', 'harness/out/devtools/latest/bad-missing-before.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /authorityHashBefore/);
  } finally {
    await rm(badUrl, { force: true });
  }

  const missingBackendProofUrl = new URL('../harness/out/devtools/latest/bad-missing-backend-proof.json', import.meta.url);
  const missingBackendProof = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  delete missingBackendProof.runtime.nativeProofRef;
  missingBackendProof.runtime.backendProofRefs = [];
  await writeFile(missingBackendProofUrl, `${JSON.stringify(missingBackendProof, null, 2)}\n`);
  try {
    const bad = spawnSync(process.execPath, ['scripts/check-dev-runtime-command-evidence.mjs', 'harness/out/devtools/latest/bad-missing-backend-proof.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /nativeProofRef|backendProofRefs/);
  } finally {
    await rm(missingBackendProofUrl, { force: true });
  }

  const nativeNoProofUrl = new URL('../harness/out/devtools/latest/bad-native-no-proof.json', import.meta.url);
  const nativeNoProof = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  nativeNoProof.projection.authorityHash = 'reference-authority:workspace.local:1001:accepted:1';
  nativeNoProof.projection.worldHash = 'reference-world:asha-demo:1001:accepted:1';
  await writeFile(nativeNoProofUrl, `${JSON.stringify(nativeNoProof, null, 2)}\n`);
  try {
    const bad = spawnSync(process.execPath, ['scripts/check-dev-runtime-command-evidence.mjs', 'harness/out/devtools/latest/bad-native-no-proof.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /native runtimeMode must not export reference authority hashes/);
  } finally {
    await rm(nativeNoProofUrl, { force: true });
  }
});

test('focused dev authority smoke records runtime mode, command hashes, and evidence paths', async () => {
  await rm(new URL('../harness/out/dev-authority-smoke/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'dev:authority-smoke'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/dev-authority-smoke\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/dev-authority-smoke/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_dev_authority_smoke');
  assert.equal(artifact.runtime.runtimeMode, 'native');
  assert.equal(artifact.runtime.launcherName, 'native-game-runtime-launcher');
  assert.equal(artifact.backend.profile, 'native.napi.launcher.v1');
  assert.equal(artifact.acceptedCommand.status, 'accepted');
  assert.equal(artifact.rejectedCommand.status, 'rejected');
  assert.notEqual(artifact.acceptedCommand.authorityHashBefore, artifact.acceptedCommand.authorityHashAfter);
  assert.equal(artifact.rejectedCommand.authorityHashBefore, artifact.rejectedCommand.authorityHashAfter);
  assert.equal(artifact.artifacts.replay.path, 'harness/out/replay/dev-smoke-command-path.json');
  assert.equal(artifact.artifacts.commandEvidence.path, 'harness/out/devtools/latest/index.json');
  assert.ok(artifact.validations.includes('command_evidence_readback_passed'));
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
  assert.equal(artifact.game.id, 'asha-testing');
  assert.equal(artifact.commands.publish, 'npm run publish:artifact');
  assert.equal(artifact.commands.verify, 'npm run conformance');
  assert.deepEqual(artifact.scenes.map((entry) => entry.scene.name), [
    'ASHA Demo Material Proof',
    'ASHA Demo Minimal Cube',
  ]);
  assert.deepEqual(artifact.publishAssets.entries.map((entry) => entry.assetId), [
    'mesh.demo-cube',
    'material.demo-copper',
    'texture.demo-checker',
  ]);
  assert.deepEqual(artifact.publishAssets.dependencyOrder, [
    'texture.demo-checker',
    'material.demo-copper',
    'mesh.demo-cube',
  ]);
  assert.deepEqual(artifact.compiledAssets.map((entry) => entry.outputKey), [
    'meshes/demo-cube.mesh.json',
    'materials/demo-copper.material.json',
    'textures/demo-checker.texture.json',
  ]);
  assert.deepEqual(artifact.compiledAssets.map((entry) => entry.payload.kind), [
    'inline-static-mesh',
    'inline-material',
    'inline-texture',
  ]);
  assert.equal(artifact.resourcePack.entryCount, 3);
  assert.equal(artifact.resourcePack.manifestPath, 'harness/out/publish/resources/manifest.json');
  assert.deepEqual(artifact.resourcePack.entries.map((entry) => entry.outputKey), [
    'meshes/demo-cube.mesh.json',
    'materials/demo-copper.material.json',
    'textures/demo-checker.texture.json',
  ]);
  assert.equal(artifact.runnableArtifact.target, 'asha-demo-static-reference.v1');
  assert.equal(artifact.runnableArtifact.entrypointPath, 'harness/out/publish/runnable/latest/index.html');
  assert.equal(artifact.runnableArtifact.runtimeMetadataPath, 'harness/out/publish/runnable/latest/runtime/reference-runtime.json');
  assert.equal(artifact.runnableArtifact.resourceManifestPath, 'harness/out/publish/runnable/latest/resources/manifest.json');
  assert.equal(artifact.runnableArtifact.resourceEntryCount, 3);
  assert.equal(artifact.runtimeBackedArtifact.target, 'asha-demo-staged-backend-native.v2');
  assert.equal(artifact.runtimeBackedArtifact.directory, 'harness/out/publish/backend-native/latest');
  assert.equal(artifact.runtimeBackedArtifact.backendMode, 'native');
  assert.equal(artifact.runtimeBackedArtifact.backendProfile, 'native.napi.launcher.v1');
  assert.deepEqual(artifact.runtimeBackedArtifact.backendProofRefs, ['proof:dev-authority-smoke']);
  assert.equal(artifact.runtimeBackedArtifact.resourceEntryCount, 3);
  assert.equal(artifact.runtimeBackedArtifact.readbackPath, 'harness/out/publish/backend-native/latest/readback/index.json');
  assert.deepEqual(artifact.runtimeBackedArtifact.evidenceRefs.map((entry) => entry.kind), [
    'backend-authority-smoke',
    'dev-runtime-command-evidence',
    'publish-artifact',
    'publish-smoke',
    'dependency-guard',
  ]);
  const backendReadback = JSON.parse(await readFile(
    new URL('../harness/out/publish/backend-native/latest/readback/index.json', import.meta.url),
    'utf8',
  ));
  assert.equal(backendReadback.target, 'asha-demo-staged-backend-native.v2');
  assert.equal(backendReadback.backend.backendMode, 'native');
  assert.deepEqual(backendReadback.backend.backendProofRefs, ['proof:dev-authority-smoke']);
  assert.ok(backendReadback.nonClaims.includes('not_private_runtime_transport'));
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
  assert.equal(smoke.readback.compiledAssetCount, 3);
  assert.equal(smoke.readback.publishAssetCount, 3);
  assert.equal(smoke.readback.packedResources.length, 3);
  assert.equal(smoke.readback.packedResources.at(0)?.assetId, 'mesh.demo-cube');
  assert.match(smoke.readback.packedResources.at(0)?.packedHash, /^sha256:/);
  assert.ok(smoke.readback.dependencyGuard.inspectedRunnableFiles.includes('harness/out/publish/runnable/latest/index.html'));
  assert.ok(smoke.readback.dependencyGuard.inspectedBackendFiles.includes('harness/out/publish/backend-native/latest/runtime/runtime-metadata.json'));
  assert.ok(smoke.readback.dependencyGuard.forbiddenBackendFragments.includes('@asha/native-bridge'));
  assert.equal(smoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
  assert.ok(smoke.checks.includes('artifact_hash_recomputed'));
  assert.ok(smoke.checks.includes('compiled_assets_match_sources'));
  assert.ok(smoke.checks.includes('packed_resources_match_publish_profile'));
  assert.ok(smoke.checks.includes('no_dev_local_resource_reads'));
  assert.ok(smoke.checks.includes('runnable_dependency_guard_passed'));
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

test('publish artifact checker rejects missing packed resource files', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const packedUrl = new URL('../harness/out/publish/resources/meshes/demo-cube.mesh.json', import.meta.url);
  await rm(packedUrl, { force: true });
  const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stderr + check.stdout, /demo-cube\.mesh\.json/);
});

test('publish artifact checker rejects runnable resources that read dev-local source roots', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const manifestUrl = new URL('../harness/out/publish/runnable/latest/resources/manifest.json', import.meta.url);
  const original = await readFile(manifestUrl, 'utf8');
  try {
    const manifest = JSON.parse(original);
    manifest.entries[0].path = 'assets/meshes/demo-cube.mesh.json';
    await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /dev-local source root/);
  } finally {
    await writeFile(manifestUrl, original);
  }
});

test('publish artifact checker rejects forbidden markers inside runnable files', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const entrypointUrl = new URL('../harness/out/publish/runnable/latest/index.html', import.meta.url);
  const original = await readFile(entrypointUrl, 'utf8');
  try {
    await writeFile(entrypointUrl, `${original}\n<!-- ../asha-studio forbidden marker -->\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /forbidden fragment/);
  } finally {
    await writeFile(entrypointUrl, original);
  }
});

test('publish artifact checker rejects stale runtime-backed evidence refs', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const readbackUrl = new URL('../harness/out/publish/backend-native/latest/readback/index.json', import.meta.url);
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const original = await readFile(readbackUrl, 'utf8');
  const originalArtifact = await readFile(artifactUrl, 'utf8');
  try {
    const readback = JSON.parse(original);
    readback.evidenceRefs[0].sha256 = 'sha256:stale';
    const nextReadback = `${JSON.stringify(readback, null, 2)}\n`;
    await writeFile(readbackUrl, nextReadback);
    const artifact = JSON.parse(originalArtifact);
    artifact.runtimeBackedArtifact.readbackHash = sha256(nextReadback);
    await writeFile(artifactUrl, `${JSON.stringify(rehashPublishArtifact(artifact), null, 2)}\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /evidence ref is stale/);
  } finally {
    await writeFile(readbackUrl, original);
    await writeFile(artifactUrl, originalArtifact);
  }
});

test('publish artifact checker rejects missing runtime-backed backend proof refs', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const original = await readFile(artifactUrl, 'utf8');
  try {
    const artifact = JSON.parse(original);
    artifact.runtimeBackedArtifact.backendProofRefs = [];
    await writeFile(artifactUrl, `${JSON.stringify(rehashPublishArtifact(artifact), null, 2)}\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /backend proof refs/);
  } finally {
    await writeFile(artifactUrl, original);
  }
});

test('publish artifact checker rejects forbidden markers inside runtime-backed files', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const runtimeMetadataUrl = new URL('../harness/out/publish/backend-native/latest/runtime/runtime-metadata.json', import.meta.url);
  const readbackUrl = new URL('../harness/out/publish/backend-native/latest/readback/index.json', import.meta.url);
  const originalArtifact = await readFile(artifactUrl, 'utf8');
  const originalRuntimeMetadata = await readFile(runtimeMetadataUrl, 'utf8');
  const originalReadback = await readFile(readbackUrl, 'utf8');
  try {
    const runtimeMetadata = JSON.parse(originalRuntimeMetadata);
    runtimeMetadata.forbiddenProbe = '@asha/native-bridge';
    const nextRuntimeMetadata = `${JSON.stringify(runtimeMetadata, null, 2)}\n`;
    await writeFile(runtimeMetadataUrl, nextRuntimeMetadata);

    const readback = JSON.parse(originalReadback);
    readback.runtimeMetadataHash = sha256(nextRuntimeMetadata);
    const nextReadback = `${JSON.stringify(readback, null, 2)}\n`;
    await writeFile(readbackUrl, nextReadback);

    const artifact = JSON.parse(originalArtifact);
    artifact.runtimeBackedArtifact.runtimeMetadataHash = sha256(nextRuntimeMetadata);
    artifact.runtimeBackedArtifact.readbackHash = sha256(nextReadback);
    await writeFile(artifactUrl, `${JSON.stringify(rehashPublishArtifact(artifact), null, 2)}\n`);

    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /runtime-backed artifact file .*forbidden fragment/);
  } finally {
    await writeFile(runtimeMetadataUrl, originalRuntimeMetadata);
    await writeFile(readbackUrl, originalReadback);
    await writeFile(artifactUrl, originalArtifact);
  }
});

test('publish artifact checker rejects runtime-backed resources that read dev-local source roots', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const manifestUrl = new URL('../harness/out/publish/backend-native/latest/resources/manifest.json', import.meta.url);
  const readbackUrl = new URL('../harness/out/publish/backend-native/latest/readback/index.json', import.meta.url);
  const originalArtifact = await readFile(artifactUrl, 'utf8');
  const originalManifest = await readFile(manifestUrl, 'utf8');
  const originalReadback = await readFile(readbackUrl, 'utf8');
  try {
    const manifest = JSON.parse(originalManifest);
    manifest.entries[0].path = 'assets/meshes/demo-cube.mesh.json';
    const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestUrl, nextManifest);

    const readback = JSON.parse(originalReadback);
    readback.resourceManifestHash = sha256(nextManifest);
    const nextReadback = `${JSON.stringify(readback, null, 2)}\n`;
    await writeFile(readbackUrl, nextReadback);

    const artifact = JSON.parse(originalArtifact);
    artifact.runtimeBackedArtifact.resourceManifestHash = sha256(nextManifest);
    artifact.runtimeBackedArtifact.readbackHash = sha256(nextReadback);
    await writeFile(artifactUrl, `${JSON.stringify(rehashPublishArtifact(artifact), null, 2)}\n`);

    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /resources\/|dev-local source root/);
  } finally {
    await writeFile(manifestUrl, originalManifest);
    await writeFile(readbackUrl, originalReadback);
    await writeFile(artifactUrl, originalArtifact);
  }
});

test('publish artifact checker rejects stale runtime-backed module hashes', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const moduleRefUrl = new URL('../harness/out/publish/backend-native/latest/runtime/module-ref.json', import.meta.url);
  const original = await readFile(moduleRefUrl, 'utf8');
  try {
    const moduleRef = JSON.parse(original);
    moduleRef.moduleRefHash = 'sha256:stale';
    await writeFile(moduleRefUrl, `${JSON.stringify(moduleRef, null, 2)}\n`);
    const check = spawnSync(process.execPath, ['scripts/check-publish-artifact.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /module ref hash is stale/);
  } finally {
    await writeFile(moduleRefUrl, original);
  }
});

test('publish runnable artifact smoke starts without a dev server', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const result = spawnSync('npm', ['run', 'publish:run-smoke'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/publish-run-smoke\/latest\/index\.json/);
  const smoke = JSON.parse(await readFile(new URL('../harness/out/publish-run-smoke/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(smoke.artifactKind, 'asha_demo_publish_run_smoke');
  assert.equal(smoke.runtime.runtimeMode, 'reference');
  assert.equal(smoke.resolvedResources.length, 3);
  assert.match(smoke.projection.worldHash, /^reference-world:/);
  assert.equal(smoke.commandProof.acceptedCommand.status, 'accepted');
  assert.notEqual(
    smoke.commandProof.acceptedCommand.authorityHashBefore,
    smoke.commandProof.acceptedCommand.authorityHashAfter,
  );
  assert.equal(smoke.commandProof.rejectedCommand.status, 'rejected');
  assert.equal(
    smoke.commandProof.rejectedCommand.authorityHashBefore,
    smoke.commandProof.rejectedCommand.authorityHashAfter,
  );
  assert.equal(smoke.commandProof.rejectedCommand.diagnostics[0].code, 'command_rejected');
  assert.ok(smoke.checks.includes('no_devtools_endpoint_required'));
  assert.ok(smoke.checks.includes('packaged_runtime_accepted_command_mutated_projection'));
});

test('publish backend artifact smoke starts without a dev server', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const result = spawnSync('npm', ['run', 'publish:backend-run-smoke'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/publish-backend-run-smoke\/latest\/index\.json/);
  const smoke = JSON.parse(await readFile(new URL('../harness/out/publish-backend-run-smoke/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(smoke.artifactKind, 'asha_demo_publish_backend_run_smoke');
  assert.equal(smoke.noDevServerRequired, true);
  assert.equal(smoke.runtimeBackedArtifact.target, 'asha-demo-staged-backend-native.v2');
  assert.equal(smoke.runtime.runtimeMode, 'native');
  assert.equal(smoke.runtime.launcherName, 'native-game-runtime-launcher');
  assert.equal(smoke.resolvedResources.length, 3);
  assert.match(smoke.projection.worldHash, /^native-world:/);
  assert.equal(smoke.commandProof.acceptedCommand.status, 'accepted');
  assert.notEqual(
    smoke.commandProof.acceptedCommand.authorityHashBefore,
    smoke.commandProof.acceptedCommand.authorityHashAfter,
  );
  assert.equal(smoke.commandProof.rejectedCommand.status, 'rejected');
  assert.equal(
    smoke.commandProof.rejectedCommand.authorityHashBefore,
    smoke.commandProof.rejectedCommand.authorityHashAfter,
  );
  assert.ok(smoke.checks.includes('reference_runtime_fallback_rejected'));
  assert.ok(smoke.checks.includes('native_backend_accepted_command_mutated_projection'));
});

test('publish backend artifact smoke rejects reference fallback claiming backend mode', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const artifactUrl = new URL('../harness/out/publish/latest/index.json', import.meta.url);
  const runtimeMetadataUrl = new URL('../harness/out/publish/backend-native/latest/runtime/runtime-metadata.json', import.meta.url);
  const readbackUrl = new URL('../harness/out/publish/backend-native/latest/readback/index.json', import.meta.url);
  const originalArtifact = await readFile(artifactUrl, 'utf8');
  const originalRuntimeMetadata = await readFile(runtimeMetadataUrl, 'utf8');
  const originalReadback = await readFile(readbackUrl, 'utf8');
  try {
    const runtimeMetadata = JSON.parse(originalRuntimeMetadata);
    runtimeMetadata.runtimeMode = 'reference';
    runtimeMetadata.launcherName = 'reference-game-runtime-launcher';
    const nextRuntimeMetadata = `${JSON.stringify(runtimeMetadata, null, 2)}\n`;
    await writeFile(runtimeMetadataUrl, nextRuntimeMetadata);

    const readback = JSON.parse(originalReadback);
    readback.runtimeMetadataHash = sha256(nextRuntimeMetadata);
    const nextReadback = `${JSON.stringify(readback, null, 2)}\n`;
    await writeFile(readbackUrl, nextReadback);

    const artifact = JSON.parse(originalArtifact);
    artifact.runtimeBackedArtifact.runtimeMetadataHash = sha256(nextRuntimeMetadata);
    artifact.runtimeBackedArtifact.readbackHash = sha256(nextReadback);
    await writeFile(artifactUrl, `${JSON.stringify(rehashPublishArtifact(artifact), null, 2)}\n`);

    const result = spawnSync(process.execPath, ['scripts/run-publish-backend-run-smoke.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr + result.stdout, /rejects reference runtime fallback|native/);
  } finally {
    await writeFile(runtimeMetadataUrl, originalRuntimeMetadata);
    await writeFile(readbackUrl, originalReadback);
    await writeFile(artifactUrl, originalArtifact);
  }
});

test('publish runnable artifact smoke fails when entrypoint is missing', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-publish-artifact.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const entrypointUrl = new URL('../harness/out/publish/runnable/latest/index.html', import.meta.url);
  await rm(entrypointUrl, { force: true });
  const result = spawnSync(process.execPath, ['scripts/run-publish-run-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr + result.stdout, /index\.html|ENOENT/);
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
  assert.equal(evidence.evidenceVersion, 'publish-evidence.v1');
  assert.equal(evidence.publishArtifact.artifactVersion, 'publish-artifact.v0');
  assert.equal(evidence.publishArtifact.compiledAssetCount, 3);
  assert.equal(evidence.publishArtifact.runnableTarget, 'asha-demo-static-reference.v1');
  assert.equal(evidence.publishArtifact.artifactHash, evidence.publishSmoke.readback.artifactHash);
  assert.equal(evidence.publishSmoke.readback.publishDependencyGuard, 'no-studio-dev-only-fragments');
  assert.equal(evidence.publishRunSmoke.runtime.runtimeMode, 'reference');
  assert.equal(evidence.publishRunSmoke.commandProof.acceptedCommand.status, 'accepted');
  assert.equal(evidence.publishBackendRunSmoke.runtime.runtimeMode, 'native');
  assert.equal(evidence.publishBackendRunSmoke.commandProof.acceptedCommand.status, 'accepted');
  assert.equal(evidence.publishBackendRunSmoke.commandProof.rejectedCommand.status, 'rejected');
  assert.equal(evidence.publishBackendRunSmoke.noDevServerRequired, true);
  assert.ok(evidence.validations.includes('publish_artifact_hash_matches_readback'));
  assert.ok(evidence.validations.includes('runtime_projection_readback_present'));
  assert.ok(evidence.validations.includes('packaged_command_proof_present'));
  assert.ok(evidence.validations.includes('backend_runtime_projection_readback_present'));
  assert.ok(evidence.validations.includes('backend_packaged_command_proof_present'));
  assert.ok(evidence.validations.includes('backend_no_dev_server_smoke_passed'));
  assert.ok(evidence.validations.includes('studio_dev_only_dependency_guard_passed'));
  assert.deepEqual(evidence.nonClaims, [
    'not_native_runtime_authority',
    'not_wasm_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
    'not_installer',
    'not_package_signing',
  ]);
  assert.match(evidence.evidenceId, /^asha-demo-publish-evidence:sha256:/);
  assert.match(evidence.evidenceHash, /^sha256:/);
  const check = spawnSync('npm', ['run', 'publish:evidence-check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /publish evidence check: OK/);
});

test('publish evidence readback fails closed on missing launch projection', async () => {
  const generate = spawnSync(process.execPath, ['scripts/generate-publish-evidence.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(generate.status, 0, generate.stdout + generate.stderr);
  const evidenceUrl = new URL('../harness/out/publish-evidence/latest/index.json', import.meta.url);
  const badUrl = new URL('../harness/out/publish-evidence/latest/bad-missing-projection.json', import.meta.url);
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  delete evidence.publishRunSmoke.projection;
  await writeFile(badUrl, `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    const check = spawnSync(process.execPath, ['scripts/check-publish-evidence.mjs', 'harness/out/publish-evidence/latest/bad-missing-projection.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /projection|readback/);
  } finally {
    await rm(badUrl, { force: true });
  }
});

test('publish evidence readback fails closed on stale backend smoke hash', async () => {
  const generate = spawnSync(process.execPath, ['scripts/generate-publish-evidence.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(generate.status, 0, generate.stdout + generate.stderr);
  const evidenceUrl = new URL('../harness/out/publish-evidence/latest/index.json', import.meta.url);
  const badUrl = new URL('../harness/out/publish-evidence/latest/bad-stale-backend-smoke.json', import.meta.url);
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  evidence.publishBackendRunSmoke.fileHash = 'sha256:stale';
  await writeFile(badUrl, `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    const check = spawnSync(process.execPath, ['scripts/check-publish-evidence.mjs', 'harness/out/publish-evidence/latest/bad-stale-backend-smoke.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /backend run smoke child artifact hash is stale/);
  } finally {
    await rm(badUrl, { force: true });
  }
});

test('publish evidence readback fails closed on missing backend proof refs', async () => {
  const generate = spawnSync(process.execPath, ['scripts/generate-publish-evidence.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(generate.status, 0, generate.stdout + generate.stderr);
  const evidenceUrl = new URL('../harness/out/publish-evidence/latest/index.json', import.meta.url);
  const badUrl = new URL('../harness/out/publish-evidence/latest/bad-missing-backend-proof-refs.json', import.meta.url);
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  evidence.publishBackendRunSmoke.runtimeBackedArtifact.backendProofRefs = [];
  await writeFile(badUrl, `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    const check = spawnSync(process.execPath, ['scripts/check-publish-evidence.mjs', 'harness/out/publish-evidence/latest/bad-missing-backend-proof-refs.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /backend proof refs|proof refs/);
  } finally {
    await rm(badUrl, { force: true });
  }
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
  assert.equal(artifact.commands.assetsV1.status, 'passed');
  assert.equal(artifact.commands.publishEvidence.status, 'passed');
  assert.equal(artifact.commands.studioTests.status, 'passed');
  assert.equal(artifact.commands.studioBoundaries.status, 'passed');
  assert.equal(artifact.artifacts.devSmoke.worldHash, 'native-world:asha-demo:1001:accepted:0');
  assert.equal(artifact.artifacts.devSmoke.afterCommandWorldHash, 'native-world:asha-demo:1001:accepted:1');
  assert.equal(artifact.artifacts.devSmoke.replayPath, 'harness/out/replay/dev-smoke-command-path.json');
  assert.equal(artifact.artifacts.devSmoke.commandEvidencePath, 'harness/out/devtools/latest/index.json');
  assert.equal(artifact.artifacts.assetsV1.resourcePackEntryCount, 3);
  assert.equal(artifact.artifacts.assetsV1.inventoryEntryCount, 3);
  assert.match(artifact.artifacts.publishEvidence.evidenceHash, /^sha256:/);
  assert.equal(artifact.artifacts.publishEvidence.backendRunSmokeRuntimeMode, 'native');
  assert.ok(artifact.validations.includes('devtools_attach_smoke_passed'));
  assert.ok(artifact.validations.includes('assets_v1_verification_passed'));
  assert.ok(artifact.validations.includes('studio_attach_tests_passed'));
  assert.ok(artifact.validations.includes('publish_evidence_passed'));
  assert.match(artifact.artifactId, /^asha-demo-game-workflow:sha256:/);
});

test('aggregate V1 workflow verification records runtime assets publish and Studio cockpit evidence', async () => {
  await rm(new URL('../harness/out/game-workflow-v1/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'verify:workflow:v1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/game-workflow-v1\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/game-workflow-v1/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_game_workflow_v1_verification');
  assert.equal(artifact.artifactVersion, 'game-workflow-v1-verification.v1');
  assert.equal(artifact.commands.runtimeAuthoritySmoke.status, 'passed');
  assert.equal(artifact.commands.assetsV1.status, 'passed');
  assert.equal(artifact.commands.publishEvidence.status, 'passed');
  assert.equal(artifact.commands.publishEvidenceCheck.status, 'passed');
  assert.equal(artifact.commands.studioTests.status, 'passed');
  assert.equal(artifact.commands.studioBoundaries.status, 'passed');
  assert.equal(artifact.commands.studioTypecheck.status, 'passed');
  assert.equal(artifact.artifacts.runtimeAuthority.runtimeMode, 'native');
  assert.equal(artifact.artifacts.runtimeAuthority.backendProfile, 'native.napi.launcher.v1');
  assert.notEqual(
    artifact.artifacts.runtimeAuthority.acceptedAuthorityHashBefore,
    artifact.artifacts.runtimeAuthority.acceptedAuthorityHashAfter,
  );
  assert.equal(
    artifact.artifacts.runtimeAuthority.rejectedAuthorityHashBefore,
    artifact.artifacts.runtimeAuthority.rejectedAuthorityHashAfter,
  );
  assert.equal(artifact.artifacts.assets.resourcePackEntryCount, 3);
  assert.equal(artifact.artifacts.assets.inventoryEntryCount, 3);
  assert.equal(artifact.artifacts.publish.publishTarget, 'asha-demo-static-reference.v1');
  assert.equal(artifact.artifacts.publish.dependencyGuard, 'no-studio-dev-only-fragments');
  assert.equal(artifact.artifacts.publish.runSmokeRuntimeMode, 'reference');
  assert.equal(artifact.artifacts.publish.backendRunSmokeRuntimeMode, 'native');
  assert.equal(artifact.artifacts.publish.backendRunSmokeTarget, 'asha-demo-staged-backend-native.v2');
  assert.equal(artifact.artifacts.studio.cockpitArtifactKind, 'studio_workspace_cockpit_evidence');
  assert.ok(artifact.artifacts.studio.markers.includes('studio-workspace-cockpit-evidence'));
  assert.ok(artifact.validations.includes('runtime_authority_child_hashes_fresh'));
  assert.ok(artifact.validations.includes('publish_child_hashes_fresh'));
  assert.ok(artifact.validations.includes('studio_cockpit_markers_present'));
  assert.ok(artifact.nonClaims.includes('not_studio_publish_builder'));
  assert.match(artifact.artifactId, /^asha-demo-game-workflow-v1:sha256:/);
});

test('aggregate V2 workflow verification records proof index and backend publish evidence', async () => {
  await rm(new URL('../harness/out/game-workflow-v2/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'verify:workflow:v2'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/game-workflow-v2\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/game-workflow-v2/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_game_workflow_v2_verification');
  assert.equal(artifact.artifactVersion, 'game-workflow-v2-verification.v1');
  assert.equal(artifact.commands.manifest.status, 'passed');
  assert.equal(artifact.commands.demoBoundary.status, 'passed');
  assert.equal(artifact.commands.v2ProofIndex.status, 'passed');
  assert.equal(artifact.commands.v2ProofIndexCheck.status, 'passed');
  assert.match(artifact.artifacts.proofIndex.indexHash, /^sha256:/);
  assert.equal(artifact.artifacts.backendAuthority.runtimeMode, 'native');
  assert.deepEqual(artifact.artifacts.backendAuthority.backendProofRefs, ['proof:dev-authority-smoke']);
  assert.equal(artifact.artifacts.publishBackend.backendMode, 'native');
  assert.equal(artifact.artifacts.publishBackend.backendProfile, 'native.napi.launcher.v1');
  assert.equal(artifact.artifacts.publishBackend.dependencyGuard, 'no-studio-dev-only-fragments');
  assert.equal(artifact.artifacts.aggregateV1.remainsRunnable, true);
  assert.ok(artifact.validations.includes('v2_proof_index_check_passed'));
  assert.ok(artifact.validations.includes('v1_aggregate_remains_runnable'));
  assert.match(artifact.artifactId, /^asha-demo-game-workflow-v2:sha256:/);
});

test('backend authority smoke records selected native command and hash evidence', async () => {
  await rm(new URL('../harness/out/backend-authority-smoke/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'backend:authority-smoke'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/backend-authority-smoke\/latest\/index\.json/);
  const artifact = JSON.parse(await readFile(new URL('../harness/out/backend-authority-smoke/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_backend_authority_smoke');
  assert.equal(artifact.backend.mode, 'native');
  assert.deepEqual(artifact.backend.proofRefs, ['proof:dev-authority-smoke']);
  assert.equal(artifact.runtime.runtimeMode, 'native');
  assert.equal(artifact.acceptedCommand.status, 'accepted');
  assert.equal(artifact.rejectedCommand.status, 'rejected');
  assert.notEqual(artifact.acceptedCommand.authorityHashBefore, artifact.acceptedCommand.authorityHashAfter);
  assert.equal(artifact.rejectedCommand.authorityHashBefore, artifact.rejectedCommand.authorityHashAfter);
  assert.equal(artifact.referenceComparison.status, 'normalized_hash_match');
  assert.ok(artifact.nonClaims.includes('not_wasm_authority'));
});

test('dev runtime evidence checker rejects native claims with reference hashes', async () => {
  const tempUrl = new URL('../harness/out/devtools/stale-native-claim.json', import.meta.url);
  const stale = {
    artifactKind: 'asha_demo_dev_runtime_command_evidence',
    artifactVersion: 'dev-runtime-command-evidence.v1',
    manifestHash: 'sha256:manifest',
    scene: { sceneId: 1001 },
    runtime: {
      runtimeMode: 'native',
      nativeProofRef: 'proof:dev-authority-smoke',
      backendProofRefs: ['proof:dev-authority-smoke'],
    },
    nonClaims: ['not_wasm_authority'],
    commandReceipts: [
      {
        sequenceId: 'seq-1',
        status: 'accepted',
        authorityHashBefore: 'reference-authority:workspace.local:1001:accepted:0',
        authorityHashAfter: 'reference-authority:workspace.local:1001:accepted:1',
      },
      {
        sequenceId: 'seq-2',
        status: 'rejected',
        authorityHashBefore: 'reference-authority:workspace.local:1001:accepted:1',
        authorityHashAfter: 'reference-authority:workspace.local:1001:accepted:1',
      },
    ],
    projectionDiffSummary: {
      acceptedCommandChangedAuthority: true,
      rejectedCommandPreservedAuthority: true,
    },
    projection: {
      authorityHash: 'reference-authority:workspace.local:1001:accepted:1',
      worldHash: 'reference-world:asha-demo:1001:accepted:1',
    },
  };
  await mkdir(new URL('../harness/out/devtools/', import.meta.url), { recursive: true });
  await writeFile(tempUrl, `${JSON.stringify(stale, null, 2)}\n`);
  try {
    const result = spawnSync(process.execPath, ['scripts/check-dev-runtime-command-evidence.mjs', tempUrl.pathname], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /native runtimeMode must not export reference authority hashes/);
  } finally {
    await rm(tempUrl, { force: true });
  }
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

test('runtime-backed publish target V2 doc pins staged backend layout and non-claims', async () => {
  const doc = await readFile(new URL('../docs/runtime-backed-publish-target-v2.md', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../docs/game-workflow.md', import.meta.url), 'utf8');

  assert.match(doc, /asha-demo-staged-backend-native\.v2/);
  assert.match(doc, /harness\/out\/publish\/backend-native\/latest\//);
  assert.match(doc, /runtime\/runtime-metadata\.json/);
  assert.match(doc, /resources\/manifest\.json/);
  assert.match(doc, /backend-authority-smoke\.json/);
  assert.match(doc, /dev-runtime-command-evidence\.json/);
  assert.match(doc, /no-dev-server smoke/i);
  assert.match(doc, /fail closed/i);
  assert.match(doc, /not_store_submission/);
  assert.match(doc, /not_installer/);
  assert.match(doc, /not_private_runtime_transport/);
  assert.match(doc, /WASM remains a deferred target/);
  assert.match(workflow, /runtime-backed-publish-target-v2\.md/);
});

test('M0 demo proof inventory records current authoring runtime and browser seams', async () => {
  const doc = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3735`/);
  assert.match(doc, /parseAshaGameManifestToml/);
  assert.match(doc, /validateAshaGameAssetCatalog/);
  assert.match(doc, /StudioSceneObjectSnapshot/);
  assert.match(doc, /createNativeGameRuntimeLauncher/);
  assert.match(doc, /pnpm run proof:v2-live-backend-evidence/);
  assert.match(doc, /npm run publish:backend-run-smoke/);
  assert.match(doc, /npm run proof:v2-index/);
  assert.match(doc, /Browser interaction proof prototypes/);
  assert.match(doc, /Scene and catalog save formats/);
  assert.match(doc, /Do not add arbitrary JSON command hatches/);
  assert.match(doc, /not infer WASM, hardware GPU, performance, store submission, installer, or\s+signing readiness/);
});

test('authoring save contract pins source formats write scope and readback requirements', async () => {
  const doc = await readFile(new URL('../docs/authoring-save-contract.md', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3736`/);
  assert.match(doc, /scenes\/\*\.scene\.json/);
  assert.match(doc, /packages\/game-catalogs\/catalog\.json/);
  assert.match(doc, /assets\/\*\*/);
  assert.match(doc, /packages\/game-policy\/\*\*/);
  assert.match(doc, /allowed_source_writes = \["scenes", "assets", "packages\/game-catalogs", "packages\/game-policy"\]/);
  assert.match(doc, /contains `\.\.`/);
  assert.match(doc, /targets `harness\/out`/);
  assert.match(doc, /validateAshaGameAssetCatalog/);
  assert.match(doc, /previous file hash or `null`/);
  assert.match(doc, /next file hash/);
  assert.match(doc, /deterministic semantic diff summary/);
  assert.match(doc, /No private Studio asset database/);
  assert.match(doc, /does not approve:\n\n- a browser runtime writing directly to source roots/);
  assert.match(inventory, /authoring-save-contract\.md/);
});

test('authoring public API lanes separate file saves from runtime proposals', async () => {
  const doc = await readFile(new URL('../docs/authoring-public-api-lanes.md', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3737`/);
  assert.match(doc, /File-authoring APIs are about committed game-owned source files/);
  assert.match(doc, /Runtime command proposals are about a launched runtime session/);
  assert.match(doc, /@asha\/game-workspace/);
  assert.match(doc, /@asha\/runtime-bridge/);
  assert.match(doc, /asha-studio/);
  assert.match(doc, /AshaAuthoringSaveRequest/);
  assert.match(doc, /AshaAuthoringSaveResult/);
  assert.match(doc, /AshaAuthoringPersistenceContract/);
  assert.match(doc, /buildAshaAuthoringPersistenceContract/);
  assert.match(doc, /resolveAshaAuthoringWriteTarget/);
  assert.match(doc, /authoring\.scene\.save_source/);
  assert.match(doc, /authoring\.catalog\.save_source/);
  assert.match(doc, /unsupported_operation/);
  assert.match(doc, /stale_file_hash/);
  assert.match(doc, /invalid_schema/);
  assert.match(doc, /disallowed_path/);
  assert.match(doc, /private_mutation_path/);
  assert.match(doc, /Studio sends file-authoring requests to the public authoring API/);
  assert.match(inventory, /authoring-public-api-lanes\.md/);
});

test('M1.1 bounded workspace persistence contract is public and fail-closed', async () => {
  const manifestText = await readFile(new URL('../asha.game.toml', import.meta.url), 'utf8');
  const saveContract = await readFile(new URL('../docs/authoring-save-contract.md', import.meta.url), 'utf8');
  const parsed = parseAshaGameManifestToml(manifestText);
  assert.equal(parsed.ok, true);
  const manifest = parsed.manifest;
  const contract = buildAshaAuthoringPersistenceContract(manifest);

  assert.match(saveContract, /authoring-persistence\.v0/);
  assert.match(saveContract, /public `@asha\/game-workspace` authoring contract/);
  assert.equal(contract.contractVersion, 'authoring-persistence.v0');
  assert.deepEqual(contract.writeScopes.map((scope) => scope.operationKind), [
    'authoring.scene.save_source',
    'authoring.catalog.save_source',
    'authoring.asset.save_source',
    'authoring.policy.save_source',
  ]);
  assert.deepEqual(contract.writeScopes.map((scope) => scope.allowedRoots), [
    ['scenes'],
    ['packages/game-catalogs'],
    ['assets'],
    ['packages/game-policy'],
  ]);
  assert.ok(contract.forbiddenRoots.includes('harness/out'));
  assert.ok(contract.nonClaims.includes('not_repo_crawler'));
  assert.ok(contract.nonClaims.includes('not_private_asset_database'));
  assert.ok(contract.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported_operation'));

  const scene = resolveAshaAuthoringWriteTarget(manifest, {
    operationKind: 'authoring.scene.save_source',
    relativePath: './scenes/demo.scene.json',
  });
  assert.equal(scene.ok, true);
  assert.equal(scene.normalizedPath, 'scenes/demo.scene.json');
  assert.equal(scene.format, 'proof-scene-json.v1');

  const catalog = resolveAshaAuthoringWriteTarget(manifest, {
    operationKind: 'authoring.catalog.save_source',
    relativePath: 'packages/game-catalogs/catalog.json',
  });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.requiredValidator, 'validateAshaGameAssetCatalog');

  for (const [relativePath, code] of [
    ['harness/out/generated.scene.json', 'forbidden_generated_path'],
    ['../asha/private/catalog.json', 'disallowed_path'],
    ['assets/mesh.txt', 'invalid_extension'],
    ['assets/@asha/native-bridge/native-bridge.node', 'private_transport_hint'],
    ['packages/game-policy/rules.json', 'unsupported_operation'],
  ]) {
    const result = resolveAshaAuthoringWriteTarget(manifest, {
      operationKind: relativePath.startsWith('packages/game-policy')
        ? 'authoring.policy.save_source'
        : relativePath.startsWith('assets/')
          ? 'authoring.asset.save_source'
          : 'authoring.scene.save_source',
      relativePath,
    });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === code), `${relativePath} should report ${code}`);
  }
});

test('browser interactive proof contract requires real input and typed ASHA readback', async () => {
  const doc = await readFile(new URL('../docs/browser-interactive-proof-contract.md', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3738`/);
  assert.match(doc, /keyboard events/);
  assert.match(doc, /mouse or pointer events/);
  assert.match(doc, /gamepad state/);
  assert.match(doc, /headless browser automation/);
  assert.match(doc, /typed public ASHA request/);
  assert.match(doc, /@asha\/runtime-bridge/);
  assert.match(doc, /ordered browser event log/);
  assert.match(doc, /before and after projection/);
  assert.match(doc, /replay or command evidence/);
  assert.match(doc, /proof markers exist but no browser input event log exists/);
  assert.ok(doc.includes(`call(${['methodName', 'json'].join(', ')})`));
  assert.match(doc, /headless automation mutates page globals directly/);
  assert.match(doc, /npm run voxel:interaction/);
  assert.match(inventory, /browser-interactive-proof-contract\.md/);
});

test('Studio live debug inspector contract pins surfaces freshness and negative smokes', async () => {
  const doc = await readFile(new URL('../docs/studio-live-debug-inspector-contract.md', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3739`/);
  assert.match(doc, /Scene \| scene id\/hash/);
  assert.match(doc, /Entity \| selected entity id/);
  assert.match(doc, /Asset \| catalog asset id/);
  assert.match(doc, /Runtime \| session id/);
  assert.match(doc, /Debug command \| command identity/);
  assert.match(doc, /Telemetry \| sequence id or sample cursor/);
  assert.match(doc, /attach/);
  assert.match(doc, /read/);
  assert.match(doc, /update/);
  assert.match(doc, /event/);
  assert.match(doc, /selection\.set_active_entity/);
  assert.match(doc, /scene\.apply_object_command/);
  assert.match(doc, /GameRuntimeSession\.proposeCommands/);
  assert.ok(doc.includes(`call(${['methodName', 'json'].join(', ')})`));
  assert.match(doc, /missing_live_session/);
  assert.match(doc, /stale_fixture_readback/);
  assert.match(doc, /unsupported_debug_command/);
  assert.match(doc, /private_transport_hint/);
  assert.match(doc, /pnpm run proof:v2-live-backend-evidence/);
  assert.match(inventory, /studio-live-debug-inspector-contract\.md/);
});

test('round-trip evidence contract pins artifact vocabulary hashes and non-claims', async () => {
  const doc = await readFile(new URL('../docs/round-trip-evidence-contract.md', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3740`/);
  assert.match(doc, /asha_demo_authoring_save_evidence/);
  assert.match(doc, /harness\/out\/authoring-save\/latest\/index\.json/);
  assert.match(doc, /asha_demo_browser_interaction_evidence/);
  assert.match(doc, /asha_demo_studio_live_debug_evidence/);
  assert.match(doc, /asha_demo_round_trip_evidence/);
  assert.match(doc, /asha_demo_m0_capstone_verification/);
  assert.match(doc, /saved file hash/);
  assert.match(doc, /runtime loaded resource manifest hash/);
  assert.match(doc, /projection\/world hash/);
  assert.match(doc, /authority hash/);
  assert.match(doc, /replay or command evidence hash/);
  assert.match(doc, /stale child artifact hash/);
  assert.match(doc, /browser event log missing or marker-only interaction/);
  assert.match(doc, /Studio live debug readback older than attach\/update/);
  assert.match(doc, /not_hardware_gpu_evidence/);
  assert.match(doc, /not_product_readiness/);
  assert.match(doc, /not_multiplayer_evidence/);
  assert.match(doc, /not_runtime_den_dependency/);
  assert.match(inventory, /round-trip-evidence-contract\.md/);
});

test('M0 contract consolidates proof docs and validates milestone tree handoff', async () => {
  const doc = await readFile(new URL('../docs/demo-proof-m0-contract.md', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('../docs/demo-proof-m0-inventory.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3741`/);
  assert.match(doc, /demo-proof-m0-inventory\.md/);
  assert.match(doc, /authoring-save-contract\.md/);
  assert.match(doc, /authoring-public-api-lanes\.md/);
  assert.match(doc, /browser-interactive-proof-contract\.md/);
  assert.match(doc, /studio-live-debug-inspector-contract\.md/);
  assert.match(doc, /round-trip-evidence-contract\.md/);
  for (const taskId of [3728, 3729, 3730, 3731, 3732, 3733, 3734, 3744, 3783]) {
    assert.match(doc, new RegExp(`asha#${taskId}`));
  }
  assert.match(doc, /M1\.1 Add bounded workspace persistence contract/);
  assert.match(doc, /no arbitrary JSON command hatch/);
  assert.match(doc, /no browser marker-only interaction proof/);
  assert.match(doc, /no stale fixture readback presented as live debug evidence/);
  assert.match(doc, /npm run verify:workflow:v2/);
  assert.match(inventory, /demo-proof-m0-contract\.md/);
});

test('M1 persistence closeout records aggregate proof hashes and non-claims', async () => {
  const doc = await readFile(new URL('../docs/demo-proof-m1-persistence-closeout.md', import.meta.url), 'utf8');

  assert.match(doc, /Task: `asha#3749`/);
  assert.match(doc, /studio_persistence_m1_proof/);
  assert.match(doc, /proof:workspace-open-read/);
  assert.match(doc, /proof:scene-save-roundtrip/);
  assert.match(doc, /proof:catalog-save-roundtrip/);
  assert.match(doc, /proof:persistence-m1/);
  assert.match(doc, /sha256:902f5cd022e7e46cad230c14812ef93005666e80f1e8fcd1d257cbcbc1e9e776/);
  assert.match(doc, /studio_workspace_open_read_proof/);
  assert.match(doc, /studio_scene_save_roundtrip_proof/);
  assert.match(doc, /studio_catalog_save_roundtrip_proof/);
  assert.match(doc, /validateAshaGameAssetCatalog/);
  assert.match(doc, /reject duplicate ids, stale base hashes, invalid asset refs, and\s+disallowed paths/);
  assert.match(doc, /does not claim runtime authority, product readiness, hardware GPU evidence/);
});

test('V2 proof index records backend Studio publish and aggregate evidence refs', async () => {
  const result = spawnSync('npm', ['run', 'proof:v2-index'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wrote harness\/out\/v2-proof-index\/latest\/index\.json/);
  const index = JSON.parse(await readFile(new URL('../harness/out/v2-proof-index/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(index.artifactKind, 'asha_demo_v2_proof_index');
  assert.equal(index.campaign.parentTaskId, 3697);
  assert.equal(index.runtime.mode, 'native');
  assert.deepEqual(index.runtime.backendProofRefs, ['proof:dev-authority-smoke']);
  assert.ok(index.proofGroups.backendAuthority.refs.some((ref) => ref.kind === 'backend-authority-smoke'));
  assert.ok(index.proofGroups.replayHash.refs.some((ref) => ref.kind === 'command-replay'));
  assert.ok(index.proofGroups.studioLive.refs.some((ref) => ref.kind === 'studio-v2-live-backend-evidence'));
  assert.ok(index.proofGroups.publishBackend.refs.some((ref) => ref.kind === 'publish-backend-run-smoke'));
  assert.ok(index.proofGroups.aggregate.refs.some((ref) => ref.kind === 'game-workflow-v1'));
  assert.equal(index.denIngestableSummary.dataOnly, true);
  assert.ok(index.nonClaims.includes('not_runtime_den_dependency'));
  const check = spawnSync('npm', ['run', 'proof:v2-index-check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /V2 proof index check: OK/);
});

test('V2 proof index checker rejects stale child refs', async () => {
  const generate = spawnSync('npm', ['run', 'proof:v2-index'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(generate.status, 0, generate.stdout + generate.stderr);
  const indexUrl = new URL('../harness/out/v2-proof-index/latest/index.json', import.meta.url);
  const badUrl = new URL('../harness/out/v2-proof-index/latest/bad-stale-child.json', import.meta.url);
  const index = JSON.parse(await readFile(indexUrl, 'utf8'));
  index.proofGroups.publishBackend.refs[0].sha256 = 'sha256:stale';
  await writeFile(badUrl, `${JSON.stringify(rehashV2ProofIndex(index), null, 2)}\n`);
  try {
    const check = spawnSync(process.execPath, ['scripts/check-v2-proof-index.mjs', 'harness/out/v2-proof-index/latest/bad-stale-child.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /child ref is stale/);
  } finally {
    await rm(badUrl, { force: true });
  }
});

test('V2 proof index checker rejects missing proof groups', async () => {
  const generate = spawnSync('npm', ['run', 'proof:v2-index'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(generate.status, 0, generate.stdout + generate.stderr);
  const indexUrl = new URL('../harness/out/v2-proof-index/latest/index.json', import.meta.url);
  const badUrl = new URL('../harness/out/v2-proof-index/latest/bad-missing-group.json', import.meta.url);
  const index = JSON.parse(await readFile(indexUrl, 'utf8'));
  delete index.proofGroups.studioLive;
  await writeFile(badUrl, `${JSON.stringify(rehashV2ProofIndex(index), null, 2)}\n`);
  try {
    const check = spawnSync(process.execPath, ['scripts/check-v2-proof-index.mjs', 'harness/out/v2-proof-index/latest/bad-missing-group.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr + check.stdout, /missing proof group studioLive/);
  } finally {
    await rm(badUrl, { force: true });
  }
});

test('browser demo launch target emits a standalone page and launch artifact', async () => {
  assert.equal(packageJson.scripts['browser:demo'], 'node scripts/run-browser-demo-launch.mjs');
  const result = spawnSync('npm', ['run', 'browser:demo'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /browser-demo-launch-ready/);

  const artifact = JSON.parse(await readFile(new URL('../harness/out/browser-demo/latest/index.json', import.meta.url), 'utf8'));
  const page = await readFile(new URL('../harness/out/browser-demo/latest/index.html', import.meta.url), 'utf8');
  assert.equal(artifact.artifactKind, 'asha_demo_browser_launch_target');
  assert.equal(artifact.page.path, 'harness/out/browser-demo/latest/index.html');
  assert.equal(artifact.checks.boundaryCheck.status, 'passed');
  assert.equal(artifact.checks.pageImportsStudio, false);
  assert.equal(artifact.checks.acceptsArbitraryCommandHatch, false);
  assert.deepEqual(artifact.controlSurface.acceptedInputSources, ['keyboard', 'pointer', 'mousemove', 'wheel']);
  assert.deepEqual(artifact.controlSurface.missingOperations, []);
  assert.ok(artifact.controlSurface.typedMappings.some((mapping) => mapping.operation === 'selectVoxel'));
  assert.ok(artifact.controlSurface.typedMappings.some((mapping) => mapping.operation === 'applyFirstPersonCameraInput'));
  assert.equal(artifact.gameplayLoop.loopDriver, 'requestAnimationFrame');
  assert.equal(artifact.gameplayLoop.consumesTypedRequestSequences, true);
  assert.equal(artifact.gameplayLoop.mutationBoundary, 'browser-local-readback-only');
  assert.equal(artifact.firstPersonController.scene.seed, 'asha-demo-m4-walkable-blockers-v0');
  assert.equal(artifact.firstPersonController.scene.blockers[0].id, 'blocker.forward-lane');
  assert.equal(artifact.firstPersonController.initialPlayer.collider.radius, 0.35);
  assert.ok(artifact.validations.includes('browser_page_written'));
  assert.ok(artifact.validations.includes('runtime_launched_through_public_runtime_bridge'));
  assert.ok(artifact.validations.includes('browser_controls_registered'));
  assert.ok(artifact.validations.includes('first_person_walkable_plane_registered'));
  assert.ok(artifact.validations.includes('cube_collision_readback_registered'));
  assert.ok(artifact.validations.includes('typed_control_mapping_declared'));
  assert.ok(artifact.validations.includes('browser_gameplay_loop_registered'));
  assert.ok(artifact.validations.includes('typed_requests_drive_browser_local_readback'));
  assert.ok(artifact.nonClaims.includes('not_browser_input_proof'));
  assert.ok(artifact.nonClaims.includes('not_runtime_mutation_proof'));
  assert.match(page, /data-asha-browser-demo-ready="true"/);
  assert.match(page, /data-browser-controls-ready="true"/);
  assert.match(page, /data-browser-gameplay-loop-ready="true"/);
  assert.match(page, /data-first-person-controller-ready="true"/);
  assert.match(page, /data-human-play-mode/);
  assert.match(page, /humanPlayMode/);
  assert.match(page, /asha-demo-controller-readout/);
  assert.match(page, /browser-demo-launch-ready/);
  assert.match(page, /window\.ashaDemoBrowserLaunch/);
  assert.match(page, /addEventListener\('keydown'/);
  assert.match(page, /addEventListener\('pointerdown'/);
  assert.match(page, /pointerlockchange/);
  assert.match(page, /mousemove/);
  assert.match(page, /player_blocked_by_cube/);
  assert.match(page, /requestAnimationFrame\(renderGameplayFrame\)/);
  assert.match(page, /gameplayReadbacks/);
  assert.match(page, /operation: 'selectVoxel'/);
  assert.match(page, /operation: 'applyFirstPersonCameraInput'/);
  assert.equal(page.includes('call(methodName'), false);
  assert.equal(page.includes('commandJson'), false);
});

test('browser input proof dispatches DOM events and records typed ASHA requests', async () => {
  assert.equal(packageJson.scripts['browser:input-proof'], 'node scripts/run-browser-input-proof.mjs');
  const result = spawnSync('npm', ['run', 'browser:input-proof'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /browser-input-proof-ready/);

  const artifact = JSON.parse(await readFile(new URL('../harness/out/browser-input-proof/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_browser_input_proof');
  assert.equal(artifact.browserInput.inputEventCount, artifact.browserInput.typedRequestCount);
  assert.equal(artifact.browserInput.gameplayReadbackCount, artifact.browserInput.typedRequestCount);
  assert.ok(artifact.browserInput.inputEvents.some((event) => event.source === 'keyboard'));
  assert.ok(artifact.browserInput.inputEvents.some((event) => event.source === 'pointer'));
  assert.ok(artifact.browserInput.inputEvents.some((event) => event.source === 'wheel'));
  assert.ok(artifact.browserInput.typedRequests.some((request) => request.operation === 'applyFirstPersonCameraInput'));
  assert.ok(artifact.browserInput.typedRequests.some((request) => request.operation === 'selectVoxel'));
  assert.equal(artifact.checks.noDirectPageMutationCall, true);
  assert.equal(artifact.checks.typedRequestsMatchInputEvents, true);
  assert.equal(artifact.checks.gameplayReadbacksMatchTypedRequests, true);
  assert.ok(artifact.validations.includes('dom_keyboard_events_dispatched'));
  assert.ok(artifact.validations.includes('typed_requests_recorded_from_dom_events'));
  assert.ok(artifact.nonClaims.includes('not_replay_correlated_yet'));
});

test('browser input correlation records replay and evidence refs', async () => {
  assert.equal(packageJson.scripts['browser:input-correlation'], 'node scripts/run-browser-input-correlation.mjs');
  const result = spawnSync('npm', ['run', 'browser:input-correlation'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /browser-input-correlation-ready/);

  const artifact = JSON.parse(await readFile(new URL('../harness/out/browser-input-correlation/latest/index.json', import.meta.url), 'utf8'));
  const replay = JSON.parse(await readFile(new URL('../harness/out/browser-input-replay/latest/replay.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_browser_input_correlation');
  assert.equal(replay.artifactKind, 'asha_demo_browser_input_replay');
  assert.equal(artifact.evidenceRefs.length, 2);
  assert.equal(artifact.checks.oneTypedRequestPerInputEvent, true);
  assert.equal(artifact.checks.oneReadbackPerTypedRequest, true);
  assert.equal(artifact.checks.sequenceIdsAligned, true);
  assert.equal(artifact.correlation.frameCount, replay.frames.length);
  assert.ok(artifact.correlation.operations.includes('selectVoxel'));
  assert.ok(artifact.correlation.operations.includes('applyFirstPersonCameraInput'));
  assert.match(artifact.correlation.replayHash, /^sha256:/);
  assert.ok(artifact.validations.includes('browser_input_replay_written'));
  assert.ok(artifact.nonClaims.includes('not_command_authority_replay'));
});

test('browser interactive aggregate proof records launch input and replay evidence', async () => {
  assert.equal(packageJson.scripts['browser:interactive-proof'], 'node scripts/run-browser-interactive-proof.mjs');
  const result = spawnSync('npm', ['run', 'browser:interactive-proof'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /browser-interactive-proof-ready/);

  const artifact = JSON.parse(await readFile(new URL('../harness/out/browser-interactive-proof/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_browser_interactive_proof');
  assert.equal(artifact.childArtifacts.length, 4);
  assert.equal(artifact.checks.launchPageReady, true);
  assert.equal(artifact.checks.domInputProofReady, true);
  assert.equal(artifact.checks.replayCorrelationReady, true);
  assert.equal(artifact.checks.boundaryGuardPassed, true);
  assert.ok(artifact.browserProof.operations.includes('selectVoxel'));
  assert.ok(artifact.browserProof.operations.includes('applyFirstPersonCameraInput'));
  assert.match(artifact.browserProof.replayHash, /^sha256:/);
  assert.ok(artifact.validations.includes('interactive_browser_readback_ready'));
  assert.ok(artifact.nonClaims.includes('not_runtime_authority'));
});

test('browser first-person controller proof script is registered', () => {
  assert.equal(
    packageJson.scripts['browser:first-person-controller-proof'],
    'node scripts/run-first-person-controller-proof.mjs',
  );
  assert.equal(
    packageJson.scripts['browser:play'],
    'node scripts/serve-browser-play.mjs',
  );
  const source = fs.readFileSync(new URL('../scripts/run-first-person-controller-proof.mjs', import.meta.url), 'utf8');
  const serveSource = fs.readFileSync(new URL('../scripts/serve-browser-play.mjs', import.meta.url), 'utf8');
  assert.match(source, /asha_demo_first_person_controller_proof/);
  assert.match(source, /pointer_lock_requested_by_viewport_click/);
  assert.match(source, /cube_collision_prevents_penetration/);
  assert.match(source, /not_runtime_authoritative_collision/);
  assert.match(serveSource, /0\.0\.0\.0/);
  assert.match(serveSource, /index\.html\?play=1/);
});

test('authored round-trip fixture loads into browser runtime readback', async () => {
  assert.equal(packageJson.scripts['roundtrip:runtime-load'], 'node scripts/run-authored-runtime-load.mjs');
  const result = spawnSync('npm', ['run', 'roundtrip:runtime-load'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /authored-runtime-load-ready/);

  const artifact = JSON.parse(await readFile(new URL('../harness/out/authored-runtime-load/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_authored_runtime_load');
  assert.equal(artifact.fixture.fixtureVersion, 'studio-authored-roundtrip-fixture.v0');
  assert.equal(artifact.authoredRuntimeLoad.objectId, 'scene-node:9401');
  assert.equal(artifact.authoredRuntimeLoad.assetId, 'material.studio-authored-roundtrip');
  assert.equal(artifact.runtime.runtimeMode, 'reference');
  assert.match(artifact.runtime.resourceManifestHash, /^sha256:/);
  assert.equal(artifact.browser.loadedObjectId, artifact.authoredRuntimeLoad.objectId);
  assert.equal(artifact.browser.loadedAssetId, artifact.authoredRuntimeLoad.assetId);
  assert.ok(artifact.validations.includes('runtime_launched_through_public_runtime_bridge'));
  assert.ok(artifact.validations.includes('browser_page_loaded_with_authored_readback'));
  assert.equal(artifact.negativeSmokes.at(0)?.ok, false);
  assert.equal(artifact.negativeSmokes.at(1)?.ok, false);
  assert.ok(artifact.nonClaims.includes('not_browser_interaction_evidence'));
});

test('authored browser interaction dispatches DOM input against loaded content', async () => {
  assert.equal(packageJson.scripts['roundtrip:browser-interaction'], 'node scripts/run-authored-browser-interaction.mjs');
  const result = spawnSync('npm', ['run', 'roundtrip:browser-interaction'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /authored-browser-interaction-ready/);

  const artifact = JSON.parse(await readFile(new URL('../harness/out/authored-browser-interaction/latest/index.json', import.meta.url), 'utf8'));
  assert.equal(artifact.artifactKind, 'asha_demo_authored_browser_interaction');
  assert.equal(artifact.interaction.authoredObjectId, 'scene-node:9401');
  assert.equal(artifact.interaction.authoredAssetId, 'material.studio-authored-roundtrip');
  assert.equal(artifact.interaction.inputEventCount, 3);
  assert.equal(artifact.interaction.typedRequestCount, artifact.interaction.inputEventCount);
  assert.equal(artifact.interaction.readbackCount, artifact.interaction.typedRequestCount);
  assert.equal(artifact.interaction.finalReadback.selectedObjectId, artifact.interaction.authoredObjectId);
  assert.ok(artifact.interaction.inputEvents.some((event) => event.source === 'pointer'));
  assert.ok(artifact.interaction.inputEvents.some((event) => event.source === 'keyboard'));
  assert.ok(artifact.interaction.inputEvents.some((event) => event.source === 'wheel'));
  assert.ok(artifact.validations.includes('authored_selection_readback_matches_loaded_object'));
  assert.equal(artifact.negativeSmokes.at(0)?.ok, false);
  assert.equal(artifact.negativeSmokes.at(1)?.ok, false);
  assert.ok(artifact.nonClaims.includes('not_runtime_mutation_proof'));
});

test('M3 browser interactive closeout records aggregate proof path and non-claims', async () => {
  const doc = await readFile(new URL('../docs/demo-proof-m3-browser-interactive-closeout.md', import.meta.url), 'utf8');
  assert.match(doc, /npm run browser:interactive-proof/);
  assert.match(doc, /harness\/out\/browser-interactive-proof\/latest\/index\.json/);
  assert.match(doc, /not a runtime authority claim/);
  assert.match(doc, /does not depend on `asha-studio`/);
});

test('headless devtools client fails when endpoint is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/check-devtools-endpoint.mjs', 'ws://127.0.0.1:1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
});
