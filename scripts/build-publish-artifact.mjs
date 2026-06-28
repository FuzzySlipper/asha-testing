#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

const scenePaths = (
  await Promise.all(parsed.manifest.workspace.sceneRoots.map(async root =>
    (await readdir(path.join(repoRoot, root)))
      .filter(name => name.endsWith('.scene.json'))
      .sort()
      .map(name => path.join(root, name)),
  ))
).flat().sort();
const sceneFiles = await Promise.all(scenePaths.map(scenePath => readJson(scenePath)));
const catalogFiles = await Promise.all(parsed.manifest.workspace.catalogPackages.map(root => readJson(path.join(root, 'catalog.json'))));
const primaryCatalog = catalogFiles[0]?.json;
if (primaryCatalog === undefined) {
  failClosed('no catalog package was declared');
}

const catalogValidation = validateAshaGameAssetCatalog(
  primaryCatalog,
  parsed.manifest,
  relativePath => existsSync(path.join(repoRoot, relativePath)),
  { sourceHash: relativePath => existsSync(path.join(repoRoot, relativePath)) ? sha256(readFileSync(path.join(repoRoot, relativePath))) : null },
);
if (!catalogValidation.ok) {
  failClosed('asset catalog did not validate', catalogValidation.diagnostics);
}

const publishAssetManifest = buildAshaGamePublishAssetManifest(primaryCatalog);
const assetFiles = await Promise.all(
  publishAssetManifest.entries.map(async entry => {
    const source = await readJson(entry.sourcePath);
    const catalogEntry = primaryCatalog.entries.find(candidate => candidate.id === entry.assetId);
    return {
      assetId: entry.assetId,
      kind: entry.kind,
      sourcePath: entry.sourcePath,
      outputKey: entry.outputKey,
      sourceHash: source.sha256,
      devImport: {
        cacheKey: catalogEntry?.importMetadata?.cacheKey ?? null,
        generatedArtifactVersion: catalogEntry?.importMetadata?.generatedArtifactVersion ?? null,
        importStatus: catalogEntry?.importMetadata?.sourceHash === source.sha256 ? 'clean' : 'stale',
      },
      payload: source.json,
    };
  }),
);
const resourcePackEntries = [];
for (const asset of assetFiles) {
  const packedPath = path.join(parsed.manifest.publishResourceProfile.outputDir, asset.outputKey);
  const packedText = `${JSON.stringify(asset.payload, null, 2)}\n`;
  await mkdir(path.dirname(path.join(repoRoot, packedPath)), { recursive: true });
  await writeFile(path.join(repoRoot, packedPath), packedText);
  resourcePackEntries.push({
    assetId: asset.assetId,
    kind: asset.kind,
    outputKey: asset.outputKey,
    packedPath,
    sourceHash: asset.sourceHash,
    packedHash: sha256(packedText),
    packedBytes: Buffer.byteLength(packedText),
  });
}
const resourcePackManifest = {
  schemaVersion: 1,
  profile: parsed.manifest.publishResourceProfile,
  dependencyOrder: publishAssetManifest.dependencyOrder,
  entries: resourcePackEntries,
};
const resourcePackManifestText = `${JSON.stringify(resourcePackManifest, null, 2)}\n`;
const resourcePackManifestPath = path.join(parsed.manifest.publishResourceProfile.outputDir, 'manifest.json');
await mkdir(path.dirname(path.join(repoRoot, resourcePackManifestPath)), { recursive: true });
await writeFile(path.join(repoRoot, resourcePackManifestPath), resourcePackManifestText);
const runnableDir = 'harness/out/publish/runnable/latest';
const runnableResourceEntries = [];
for (const asset of assetFiles) {
  const runnablePackedPath = path.join(runnableDir, 'resources', asset.outputKey);
  const packedText = `${JSON.stringify(asset.payload, null, 2)}\n`;
  await mkdir(path.dirname(path.join(repoRoot, runnablePackedPath)), { recursive: true });
  await writeFile(path.join(repoRoot, runnablePackedPath), packedText);
  runnableResourceEntries.push({
    assetId: asset.assetId,
    kind: asset.kind,
    outputKey: asset.outputKey,
    path: path.join('resources', asset.outputKey),
    hash: sha256(packedText),
    bytes: Buffer.byteLength(packedText),
  });
}
const runnableResourceManifest = {
  schemaVersion: 1,
  target: 'asha-demo-static-reference.v1',
  dependencyOrder: publishAssetManifest.dependencyOrder,
  entries: runnableResourceEntries,
};
const runnableResourceManifestText = `${JSON.stringify(runnableResourceManifest, null, 2)}\n`;
const runnableResourceManifestPath = path.join(runnableDir, 'resources/manifest.json');
await mkdir(path.dirname(path.join(repoRoot, runnableResourceManifestPath)), { recursive: true });
await writeFile(path.join(repoRoot, runnableResourceManifestPath), runnableResourceManifestText);
const runtimeMetadata = {
  schemaVersion: 1,
  runtimeMode: 'reference',
  launcherName: 'reference-game-runtime-launcher',
  world: {
    bundleSchemaVersion: Number(sceneFiles[0]?.json.schemaVersion ?? 1),
    protocolVersion: 1,
    sceneId: Number(sceneFiles[0]?.json.sceneId ?? 0),
  },
  sceneIds: sceneFiles.map((scene) => scene.json.sceneId),
  catalogAssetIds: [...new Set(sceneFiles.flatMap((scene) => scene.json.catalogAssetIds ?? []))].sort(),
  nonClaims: [
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
  ],
};
const runtimeMetadataText = `${JSON.stringify(runtimeMetadata, null, 2)}\n`;
const runtimeMetadataPath = path.join(runnableDir, 'runtime/reference-runtime.json');
await mkdir(path.dirname(path.join(repoRoot, runtimeMetadataPath)), { recursive: true });
await writeFile(path.join(repoRoot, runtimeMetadataPath), runtimeMetadataText);
const entrypointHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ASHA Demo Static Reference</title>
  <meta name="asha-runnable-target" content="asha-demo-static-reference.v1">
</head>
<body data-runtime-mode="reference" data-resource-manifest="resources/manifest.json" data-runtime-metadata="runtime/reference-runtime.json">
  <main>
    <h1>ASHA Demo Static Reference</h1>
    <p id="runtimeMode">reference</p>
    <pre id="resourceManifest">resources/manifest.json</pre>
    <pre id="runtimeMetadata">runtime/reference-runtime.json</pre>
  </main>
</body>
</html>
`;
const entrypointPath = path.join(runnableDir, 'index.html');
await writeFile(path.join(repoRoot, entrypointPath), entrypointHtml);

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
  resourcePack: {
    manifestPath: resourcePackManifestPath,
    manifestHash: sha256(resourcePackManifestText),
    entryCount: resourcePackEntries.length,
    totalBytes: resourcePackEntries.reduce((sum, entry) => sum + entry.packedBytes, 0),
    entries: resourcePackEntries,
  },
  runnableArtifact: {
    target: 'asha-demo-static-reference.v1',
    directory: runnableDir,
    entrypointPath,
    runtimeMetadataPath,
    resourceManifestPath: runnableResourceManifestPath,
    entrypointHash: sha256(entrypointHtml),
    runtimeMetadataHash: sha256(runtimeMetadataText),
    resourceManifestHash: sha256(runnableResourceManifestText),
    resourceEntryCount: runnableResourceEntries.length,
  },
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
