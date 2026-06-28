#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outDir = join(repoRoot, 'harness/out/assets-v1/latest');
const artifactPath = join(outDir, 'index.json');

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    name,
    status: 'passed',
    command: [command, ...args].join(' '),
    stdout: result.stdout.trim().split('\n').filter(Boolean),
    stderr: result.stderr.trim() === '' ? [] : result.stderr.trim().split('\n'),
  };
}

const commands = {
  manifest: run('manifest', process.execPath, ['scripts/check-manifest.mjs']),
  catalog: run('catalog', process.execPath, ['scripts/check-assets.mjs']),
  proofScenes: run('proof-scenes', process.execPath, ['scripts/check-proof-scenes.mjs']),
  publishArtifact: run('publish-artifact', process.execPath, ['scripts/build-publish-artifact.mjs']),
  publishReadback: run('publish-readback', process.execPath, ['scripts/check-publish-artifact.mjs']),
  inventory: run('asset-inventory', process.execPath, ['scripts/build-asset-inventory.mjs']),
};

const publishArtifactText = await readFile(join(repoRoot, 'harness/out/publish/latest/index.json'), 'utf8');
const publishArtifact = JSON.parse(publishArtifactText);
const inventoryText = await readFile(join(repoRoot, 'harness/out/asset-inventory/latest/index.json'), 'utf8');
const inventory = JSON.parse(inventoryText);

assert.equal(inventory.status, 'ok');
assert.equal(publishArtifact.resourcePack.entryCount, 3);
assert.deepEqual(inventory.dependencyOrder, ['texture.demo-checker', 'material.demo-copper', 'mesh.demo-cube']);

const artifact = {
  artifactKind: 'asha_demo_assets_v1_verification',
  artifactVersion: 'assets-v1-verification.v1',
  generatedAt: 'deterministic-as-structure-only',
  commands,
  artifacts: {
    publishArtifact: {
      path: 'harness/out/publish/latest/index.json',
      sha256: sha256(publishArtifactText),
      resourcePackManifestPath: publishArtifact.resourcePack.manifestPath,
      resourcePackManifestHash: publishArtifact.resourcePack.manifestHash,
      resourcePackEntryCount: publishArtifact.resourcePack.entryCount,
    },
    assetInventory: {
      path: 'harness/out/asset-inventory/latest/index.json',
      sha256: sha256(inventoryText),
      entryCount: inventory.entries.length,
      dependencyOrder: inventory.dependencyOrder,
    },
  },
  validations: [
    'manifest_profiles_valid',
    'catalog_dependencies_valid',
    'dev_import_metadata_clean',
    'proof_scene_catalog_refs_valid',
    'resource_pack_readback_valid',
    'asset_inventory_read_model_valid',
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${artifactPath.replace(`${repoRoot}/`, '')}`);
