#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASHA_GAME_WORKSPACE_COMPATIBILITY,
  buildAshaGamePublishAssetManifest,
  parseAshaGameManifestToml,
  validateAshaConsumerCompatibility,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'asha.game.toml');
const packageJsonPath = path.join(repoRoot, 'package.json');
const outDir = path.join(repoRoot, 'harness/out/publish/latest');
const artifactPath = path.join(outDir, 'index.json');

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

async function readJson(relativePath) {
  const text = await readFile(path.join(repoRoot, relativePath), 'utf8');
  return { relativePath, text, json: JSON.parse(text), sha256: sha256(text) };
}

function failClosed(message, diagnostics = []) {
  console.error('asha-demo publish artifact build failed:');
  console.error(`- ${message}`);
  for (const diagnostic of diagnostics) {
    console.error(`- ${diagnostic.code ?? 'diagnostic'} at ${diagnostic.path ?? 'unknown'}: ${diagnostic.message ?? JSON.stringify(diagnostic)}`);
  }
  process.exit(1);
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const manifestText = await readFile(manifestPath, 'utf8');
const parsed = parseAshaGameManifestToml(manifestText);
if (!parsed.ok) {
  failClosed('manifest did not parse', parsed.diagnostics);
}

const compatibility = validateAshaConsumerCompatibility(parsed.manifest, ASHA_GAME_WORKSPACE_COMPATIBILITY);
if (!compatibility.ok) {
  failClosed('manifest compatibility is not supported', compatibility.diagnostics);
}

const sceneFiles = await Promise.all(parsed.manifest.workspace.sceneRoots.map(root => readJson(path.join(root, 'minimal.scene.json'))));
const catalogFiles = await Promise.all(parsed.manifest.workspace.catalogPackages.map(root => readJson(path.join(root, 'catalog.json'))));
const primaryCatalog = catalogFiles[0]?.json;
if (primaryCatalog === undefined) {
  failClosed('no catalog package was declared');
}

const catalogValidation = validateAshaGameAssetCatalog(
  primaryCatalog,
  parsed.manifest,
  relativePath => existsSync(path.join(repoRoot, relativePath)),
);
if (!catalogValidation.ok) {
  failClosed('asset catalog did not validate', catalogValidation.diagnostics);
}

const publishAssetManifest = buildAshaGamePublishAssetManifest(primaryCatalog);
const assetFiles = await Promise.all(
  publishAssetManifest.entries.map(async entry => {
    const source = await readJson(entry.sourcePath);
    return {
      assetId: entry.assetId,
      kind: entry.kind,
      sourcePath: entry.sourcePath,
      outputKey: entry.outputKey,
      sourceHash: source.sha256,
      payload: source.json,
    };
  }),
);

const artifactBody = {
  artifactKind: 'asha_demo_publish_artifact',
  artifactVersion: parsed.manifest.asha.publishArtifactFormatVersion,
  generatedAt: 'deterministic-as-structure-only',
  game: {
    id: packageJson.name,
    version: packageJson.version,
    private: packageJson.private,
  },
  compatibility: {
    engineVersion: parsed.manifest.asha.engineVersion,
    contractsPackageVersion: parsed.manifest.asha.contractsVersion,
    runtimeBridgePackageVersion: parsed.manifest.asha.runtimeBridgeVersion,
    devtoolsProtocolVersion: parsed.manifest.asha.devtoolsProtocolVersion,
    publishArtifactFormatVersion: parsed.manifest.asha.publishArtifactFormatVersion,
    expectedPublicSurfaces: ASHA_GAME_WORKSPACE_COMPATIBILITY,
  },
  sourceManifest: {
    path: path.relative(repoRoot, manifestPath),
    hash: sha256(manifestText),
    workspace: parsed.manifest.workspace,
    runtimeEntry: parsed.manifest.runtime.wasmOrNativeEntry,
  },
  scenes: sceneFiles.map(scene => ({
    path: scene.relativePath,
    hash: scene.sha256,
    scene: scene.json,
  })),
  catalogs: catalogFiles.map(catalog => ({
    path: catalog.relativePath,
    hash: catalog.sha256,
    catalog: catalog.json,
  })),
  publishAssets: publishAssetManifest,
  compiledAssets: assetFiles,
  commands: {
    dev: parsed.manifest.runtime.devCommand,
    publish: parsed.manifest.publish.command,
    verify: parsed.manifest.publish.verifyCommand,
  },
  nonClaims: [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
  ],
};

const artifactHash = sha256(stableJson(artifactBody));
const artifact = {
  ...artifactBody,
  artifactId: `asha-demo-publish:${artifactHash}`,
  artifactHash,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
