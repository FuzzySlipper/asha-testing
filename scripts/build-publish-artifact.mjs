#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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

function isPublishProofScene(scene) {
  return Number.isInteger(scene.sceneId);
}

function failClosed(message, diagnostics = []) {
  console.error('asha-testing publish artifact build failed:');
  console.error(`- ${message}`);
  for (const diagnostic of diagnostics) {
    console.error(`- ${diagnostic.code ?? 'diagnostic'} at ${diagnostic.path ?? 'unknown'}: ${diagnostic.message ?? JSON.stringify(diagnostic)}`);
  }
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.status !== 0) {
    failClosed(`${command} ${args.join(' ')} failed`, [{ code: 'command_failed', message: result.stdout + result.stderr }]);
  }
  return result;
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
const discoveredSceneFiles = await Promise.all(scenePaths.map(scenePath => readJson(scenePath)));
const sceneFiles = discoveredSceneFiles.filter(scene => isPublishProofScene(scene.json));
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

if (parsed.manifest.runtime.backendMode !== 'native') {
  failClosed('V2 runtime-backed publish target requires backend_mode = "native"', [
    { code: 'unsupported_backend_mode', path: 'runtime.backend_mode', message: parsed.manifest.runtime.backendMode },
  ]);
}
if (parsed.manifest.runtime.backendProofRefs.length === 0) {
  failClosed('V2 runtime-backed publish target requires backend_proof_refs', [
    { code: 'missing_backend_ref', path: 'runtime.backend_proof_refs', message: 'backend proof refs are required' },
  ]);
}

run(process.execPath, ['scripts/run-backend-authority-smoke.mjs']);
const backendAuthoritySmoke = await readJson('harness/out/backend-authority-smoke/latest/index.json');
const commandEvidence = await readJson(backendAuthoritySmoke.json.artifacts.commandEvidence.path);
const backendDir = 'harness/out/publish/backend-native/latest';
const backendResourceEntries = [];
for (const asset of assetFiles) {
  const backendPackedPath = path.join(backendDir, 'resources', asset.outputKey);
  const packedText = `${JSON.stringify(asset.payload, null, 2)}\n`;
  await mkdir(path.dirname(path.join(repoRoot, backendPackedPath)), { recursive: true });
  await writeFile(path.join(repoRoot, backendPackedPath), packedText);
  backendResourceEntries.push({
    assetId: asset.assetId,
    kind: asset.kind,
    outputKey: asset.outputKey,
    path: path.join('resources', asset.outputKey),
    sourceHash: asset.sourceHash,
    packedHash: sha256(packedText),
    packedBytes: Buffer.byteLength(packedText),
  });
}
const backendResourceManifest = {
  schemaVersion: 1,
  target: 'asha-demo-staged-backend-native.v2',
  backend: {
    mode: backendAuthoritySmoke.json.backend.mode,
    profile: backendAuthoritySmoke.json.backend.profile,
    proofRefs: backendAuthoritySmoke.json.backend.proofRefs,
  },
  dependencyOrder: publishAssetManifest.dependencyOrder,
  entries: backendResourceEntries,
};
const backendResourceManifestText = `${JSON.stringify(backendResourceManifest, null, 2)}\n`;
const backendResourceManifestPath = path.join(backendDir, 'resources/manifest.json');
await mkdir(path.dirname(path.join(repoRoot, backendResourceManifestPath)), { recursive: true });
await writeFile(path.join(repoRoot, backendResourceManifestPath), backendResourceManifestText);

const runtimeEntryText = await readFile(path.join(repoRoot, parsed.manifest.runtime.wasmOrNativeEntry), 'utf8');
const runtimeEntry = JSON.parse(runtimeEntryText);
const runtimeMetadataV2 = {
  schemaVersion: 1,
  target: 'asha-demo-staged-backend-native.v2',
  runtimeMode: backendAuthoritySmoke.json.runtime.runtimeMode,
  launcherName: backendAuthoritySmoke.json.runtime.launcherName,
  runtimeProfileId: backendAuthoritySmoke.json.runtime.runtimeProfileId,
  world: {
    bundleSchemaVersion: runtimeEntry.schemaVersion,
    protocolVersion: runtimeEntry.protocolVersion,
    sceneId: runtimeEntry.sceneId,
  },
  bridgeCompatibility: parsed.manifest.asha.runtimeBridgeVersion,
  devtoolsProtocolVersion: parsed.manifest.asha.devtoolsProtocolVersion,
  commandProposalSupported: true,
  replayExportSupported: true,
  evidenceExportSupported: true,
  nonClaims: backendAuthoritySmoke.json.nonClaims,
};
const runtimeMetadataV2Text = `${JSON.stringify(runtimeMetadataV2, null, 2)}\n`;
const runtimeMetadataV2Path = path.join(backendDir, 'runtime/runtime-metadata.json');
await mkdir(path.dirname(path.join(repoRoot, runtimeMetadataV2Path)), { recursive: true });
await writeFile(path.join(repoRoot, runtimeMetadataV2Path), runtimeMetadataV2Text);

const backendProfile = {
  schemaVersion: 1,
  backendMode: backendAuthoritySmoke.json.backend.mode,
  backendProfile: backendAuthoritySmoke.json.backend.profile,
  backendProofRefs: backendAuthoritySmoke.json.backend.proofRefs,
  launcherName: backendAuthoritySmoke.json.runtime.launcherName,
  runtimeProfileId: backendAuthoritySmoke.json.runtime.runtimeProfileId,
  runtimeEntry: parsed.manifest.runtime.wasmOrNativeEntry,
};
const backendProfileText = `${JSON.stringify(backendProfile, null, 2)}\n`;
const backendProfilePath = path.join(backendDir, 'runtime/backend-profile.json');
await writeFile(path.join(repoRoot, backendProfilePath), backendProfileText);

const moduleRef = {
  schemaVersion: 1,
  kind: 'public-runtime-bridge-module-ref',
  target: 'asha-demo-staged-backend-native.v2',
  moduleRef: backendAuthoritySmoke.json.backend.moduleRef,
  moduleRefHash: sha256(runtimeEntryText),
  nonClaims: ['not_private_runtime_transport', 'not_installer', 'not_package_signing'],
};
const moduleRefText = `${JSON.stringify(moduleRef, null, 2)}\n`;
const moduleRefPath = path.join(backendDir, 'runtime/module-ref.json');
await writeFile(path.join(repoRoot, moduleRefPath), moduleRefText);

const publishArtifactEvidence = {
  schemaVersion: 1,
  kind: 'publish-artifact-build-input',
  artifactVersion: parsed.manifest.asha.publishArtifactFormatVersion,
  manifestHash: sha256(manifestText),
  resourcePackManifestPath,
  resourcePackManifestHash: sha256(resourcePackManifestText),
};
const publishArtifactEvidenceText = `${JSON.stringify(publishArtifactEvidence, null, 2)}\n`;
const publishArtifactEvidencePath = path.join(backendDir, 'evidence/publish-artifact.json');
await mkdir(path.dirname(path.join(repoRoot, publishArtifactEvidencePath)), { recursive: true });
await writeFile(path.join(repoRoot, publishArtifactEvidencePath), publishArtifactEvidenceText);

const publishSmokeEvidence = {
  schemaVersion: 1,
  kind: 'publish-smoke-requirements',
  dependencyGuard: 'no-studio-dev-only-fragments',
  noDevServerRequired: true,
  forbiddenClasses: [
    'studio_package_dependency',
    'studio_workspace_readout',
    'manifest_attach_endpoint_key',
    'localhost_devtools_url',
  ],
};
const publishSmokeEvidenceText = `${JSON.stringify(publishSmokeEvidence, null, 2)}\n`;
const publishSmokeEvidencePath = path.join(backendDir, 'evidence/publish-smoke.json');
await writeFile(path.join(repoRoot, publishSmokeEvidencePath), publishSmokeEvidenceText);

const dependencyGuardText = `${JSON.stringify({
  schemaVersion: 1,
  result: 'no-studio-dev-only-fragments',
  inspectedRoot: backendDir,
  forbiddenSourceRoots: ['assets/', 'scenes/', 'packages/game-catalogs/', 'packages/game-policy/', 'replays/'],
  forbiddenRuntimeClasses: [
    'private_native_transport_package',
    'private_native_binary_name',
    'private_wasm_replay_package',
    'engine_source_root',
    'hidden_reference_runtime_fallback',
    'manifest_attach_endpoint_key',
    'localhost_devtools_url',
    'arbitrary_json_command_hatch',
  ],
}, null, 2)}\n`;
const dependencyGuardPath = path.join(backendDir, 'evidence/dependency-guard.json');
await writeFile(path.join(repoRoot, dependencyGuardPath), dependencyGuardText);
const backendAuthoritySmokePath = path.join(backendDir, 'evidence/backend-authority-smoke.json');
await writeFile(path.join(repoRoot, backendAuthoritySmokePath), backendAuthoritySmoke.text);
const commandEvidencePath = path.join(backendDir, 'evidence/dev-runtime-command-evidence.json');
await writeFile(path.join(repoRoot, commandEvidencePath), commandEvidence.text);

const backendReadback = {
  schemaVersion: 1,
  target: 'asha-demo-staged-backend-native.v2',
  backend: backendProfile,
  runtimeMetadataPath: runtimeMetadataV2Path,
  runtimeMetadataHash: sha256(runtimeMetadataV2Text),
  backendProfilePath,
  backendProfileHash: sha256(backendProfileText),
  moduleRefPath,
  moduleRefHash: sha256(moduleRefText),
  resourceManifestPath: backendResourceManifestPath,
  resourceManifestHash: sha256(backendResourceManifestText),
  resourceEntryCount: backendResourceEntries.length,
  evidenceRefs: [
    { kind: 'backend-authority-smoke', path: backendAuthoritySmokePath, sha256: backendAuthoritySmoke.sha256 },
    { kind: 'dev-runtime-command-evidence', path: commandEvidencePath, sha256: commandEvidence.sha256 },
    { kind: 'publish-artifact', path: publishArtifactEvidencePath, sha256: sha256(publishArtifactEvidenceText) },
    { kind: 'publish-smoke', path: publishSmokeEvidencePath, sha256: sha256(publishSmokeEvidenceText) },
    { kind: 'dependency-guard', path: dependencyGuardPath, sha256: sha256(dependencyGuardText) },
  ],
  commandProof: {
    acceptedCommand: backendAuthoritySmoke.json.acceptedCommand,
    rejectedCommand: backendAuthoritySmoke.json.rejectedCommand,
  },
  validations: [
    'native_backend_mode_selected',
    'backend_proof_refs_present',
    'packed_resources_staged',
    'runtime_metadata_staged',
    'evidence_refs_staged',
    'no_dev_server_runtime_metadata',
  ],
  nonClaims: [
    'not_wasm_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
    'not_store_submission',
    'not_installer',
    'not_package_signing',
    'not_private_runtime_transport',
  ],
};
const backendReadbackText = `${JSON.stringify(backendReadback, null, 2)}\n`;
const backendReadbackPath = path.join(backendDir, 'readback/index.json');
await mkdir(path.dirname(path.join(repoRoot, backendReadbackPath)), { recursive: true });
await writeFile(path.join(repoRoot, backendReadbackPath), backendReadbackText);

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
  runtimeBackedArtifact: {
    target: 'asha-demo-staged-backend-native.v2',
    directory: backendDir,
    readbackPath: backendReadbackPath,
    readbackHash: sha256(backendReadbackText),
    runtimeMetadataPath: runtimeMetadataV2Path,
    runtimeMetadataHash: sha256(runtimeMetadataV2Text),
    backendProfilePath,
    backendProfileHash: sha256(backendProfileText),
    moduleRefPath,
    moduleRefHash: sha256(moduleRefText),
    resourceManifestPath: backendResourceManifestPath,
    resourceManifestHash: sha256(backendResourceManifestText),
    resourceEntryCount: backendResourceEntries.length,
    backendMode: backendProfile.backendMode,
    backendProfile: backendProfile.backendProfile,
    backendProofRefs: backendProfile.backendProofRefs,
    evidenceRefs: backendReadback.evidenceRefs,
    nonClaims: backendReadback.nonClaims,
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
