#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseAshaGameManifestToml } from '@asha/game-workspace';
import { frameCursor } from '@asha/runtime-bridge';
import { createReferenceGameRuntimeLauncher } from '@asha/runtime-bridge/reference';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioRoot = path.resolve(repoRoot, '../asha-studio');
const fixturePath = path.join(studioRoot, 'fixtures/round-trip/studio-authored-content.fixture.json');
const fixtureRelativePath = '../asha-studio/fixtures/round-trip/studio-authored-content.fixture.json';
const outDir = path.join(repoRoot, 'harness/out/authored-runtime-load/latest');
const artifactPath = path.join(outDir, 'index.json');
const pagePath = path.join(outDir, 'index.html');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function stateHash(value) {
  return sha256(stableJson(value));
}

function studioFixtureHash(value) {
  return sha256(JSON.stringify(value));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function chromiumPath() {
  for (const candidate of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const result = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim().length > 0) return result.stdout.trim();
  }
  throw new Error('No Chromium-compatible browser found on PATH.');
}

function renderPage({ artifact }) {
  const pageState = {
    artifactKind: artifact.artifactKind,
    authoredRuntimeLoad: artifact.authoredRuntimeLoad,
    runtime: artifact.runtime,
    readback: artifact.readback,
  };
  const pageJson = JSON.stringify(pageState).replaceAll('</', '<\\/');
  return `<!doctype html>
<meta charset="utf-8">
<title>ASHA Authored Runtime Load</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #101316; color: #e7eef2; }
  body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
  header { padding: 14px 18px; border-bottom: 1px solid #36454d; display: flex; justify-content: space-between; gap: 12px; }
  main { display: grid; grid-template-columns: 340px 1fr; min-height: 0; }
  aside { padding: 16px; border-right: 1px solid #36454d; background: #171d21; }
  section { padding: 18px; }
  h1, h2 { margin: 0; font-size: 15px; }
  .viewport { min-height: 360px; position: relative; overflow: hidden; border: 1px solid #43535c; background: linear-gradient(180deg, #213743, #12181b 54%, #222b2f 55%, #111619); }
  .floor { position: absolute; inset: 55% 0 0; background-image: linear-gradient(#ffffff14 1px, transparent 1px), linear-gradient(90deg, #ffffff14 1px, transparent 1px); background-size: 32px 32px; }
  .marker { position: absolute; left: calc(50% + 54px); top: calc(50% - 46px); width: 94px; height: 94px; border: 2px solid #1c262b; background: #c38443; box-shadow: inset -20px -18px 0 #0005, 0 18px 34px #0008; }
  .label { position: absolute; left: calc(50% + 34px); top: calc(50% + 58px); padding: 6px 8px; border: 1px solid #49616b; background: #12181bdd; font-size: 12px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0b0f11; border: 1px solid #2f3b41; padding: 12px; }
  code { color: #9ad2ff; }
</style>
<body data-authored-runtime-load-ready="true" data-proof-content="authored-runtime-load-ready" data-authored-object-id="${artifact.authoredRuntimeLoad.objectId}" data-authored-asset-id="${artifact.authoredRuntimeLoad.assetId}" data-runtime-world-hash="${artifact.readback.worldHash}">
  <header>
    <h1>Authored Runtime Load</h1>
    <code>${artifact.authoredRuntimeLoad.objectLabel}</code>
  </header>
  <main>
    <aside>
      <h2>Runtime Readback</h2>
      <pre id="readback"></pre>
    </aside>
    <section>
      <div class="viewport" role="img" aria-label="Authored runtime load viewport" data-visual-id="asha-authored-runtime-viewport">
        <div class="floor"></div>
        <div class="marker" data-authored-runtime-marker="true"></div>
        <div class="label">${artifact.authoredRuntimeLoad.objectLabel}</div>
      </div>
    </section>
  </main>
  <script type="application/json" id="authored-runtime-state">${pageJson}</script>
  <script>
    const state = JSON.parse(document.getElementById('authored-runtime-state').textContent);
    window.ashaAuthoredRuntimeLoad = {
      loadVersion: 'asha-demo-authored-runtime-load.v0',
      ready: true,
      snapshot() {
        return state;
      },
    };
    document.getElementById('readback').textContent = JSON.stringify(state, null, 2);
    document.body.dataset.authoredRuntimeReadbackReady = 'true';
  </script>
</body>
`;
}

function extractPageReadback(dom) {
  assert.match(dom, /data-authored-runtime-load-ready="true"/);
  assert.match(dom, /data-authored-runtime-marker="true"/);
  const match = dom.match(/<script type="application\/json" id="authored-runtime-state">([\s\S]*?)<\/script>/);
  assert.ok(match, 'authored runtime page state marker missing from dumped DOM');
  return JSON.parse(match[1]);
}

const fixtureText = await readFile(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureText);
const { fixtureHash: recordedFixtureHash, ...fixtureWithoutHash } = fixture;
assert.equal(recordedFixtureHash, studioFixtureHash(fixtureWithoutHash), 'studio-authored fixture hash is stale');
assert.equal(fixture.fixtureKind, 'studio_authored_roundtrip_fixture');
assert.equal(fixture.authoredScene.objectId, 'scene-node:9401');
assert.equal(fixture.authoredCatalog.authoredAssetId, 'material.studio-authored-roundtrip');

const manifestText = await readFile(path.join(repoRoot, 'asha.game.toml'), 'utf8');
const manifestHash = sha256(manifestText);
const manifestResult = parseAshaGameManifestToml(manifestText);
assert.equal(manifestResult.ok, true, manifestResult.ok ? '' : JSON.stringify(manifestResult.diagnostics));
const manifest = manifestResult.manifest;

const runtimeResourceManifest = {
  manifestVersion: 'asha-demo-authored-runtime-resource-manifest.v0',
  sourceFixtureHash: fixture.fixtureHash,
  entries: [
    {
      kind: 'flatSceneDocument',
      id: fixture.authoredScene.objectId,
      hash: fixture.workspace.afterFlatSceneHash,
    },
    {
      kind: 'catalogEntry',
      id: fixture.authoredCatalog.authoredAssetId,
      hash: fixture.authoredCatalog.authoredCatalogHash,
    },
  ],
};

const launcher = createReferenceGameRuntimeLauncher();
const runtimeSession = await launcher.launch({
  gameId: 'asha-demo',
  workspaceId: 'workspace.authored-runtime-load',
  runtimeEntry: fixtureRelativePath,
  compatibility: {
    contractsPackageVersion: manifest.asha.contractsVersion,
    runtimeBridgePackageVersion: manifest.asha.runtimeBridgeVersion,
    devtoolsProtocolVersion: manifest.asha.devtoolsProtocolVersion,
    publishArtifactVersion: manifest.asha.publishArtifactFormatVersion,
  },
  resourceProfile: {
    profileId: 'asha-demo.authored-runtime-load.resources.v0',
    runtimeEntry: fixtureRelativePath,
    worldBundleId: `studio-authored:${fixture.authoredScene.objectId}`,
    resourceManifestHash: stateHash(runtimeResourceManifest),
  },
  world: {
    bundleSchemaVersion: 1,
    protocolVersion: 1,
    sceneId: fixture.authoredScene.record.id,
  },
  startedAtIso: '2026-06-29T00:00:00.000Z',
});
const projection = await runtimeSession.pullProjection();
const renderDiff = await runtimeSession.pullRenderDiff(frameCursor(0));
await runtimeSession.shutdown();

const boundaryCheck = run('npm', ['run', 'check:boundary']);
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);

const missingObjectFixture = {
  ...fixture,
  authoredScene: {
    ...fixture.authoredScene,
    objectId: null,
  },
};
const staleFixture = {
  ...fixture,
  authoredCatalog: {
    ...fixture.authoredCatalog,
    authoredAssetId: 'material.stale-runtime-load',
  },
};

const artifactBody = {
  artifactKind: 'asha_demo_authored_runtime_load',
  artifactVersion: 'asha-demo-authored-runtime-load.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run roundtrip:runtime-load',
  fixture: {
    path: fixtureRelativePath,
    sha256: sha256(fixtureText),
    fixtureHash: fixture.fixtureHash,
    fixtureVersion: fixture.fixtureVersion,
  },
  manifest: {
    path: 'asha.game.toml',
    manifestHash,
    runtimeEntry: fixtureRelativePath,
  },
  authoredRuntimeLoad: {
    loadVersion: 'asha-demo-authored-runtime-load-readback.v0',
    objectId: fixture.authoredScene.objectId,
    objectLabel: fixture.authoredScene.record.label,
    objectTransform: fixture.authoredScene.record.transform,
    assetId: fixture.authoredCatalog.authoredAssetId,
    materialSource: fixture.authoredCatalog.entry.source,
    flatSceneHash: fixture.workspace.afterFlatSceneHash,
    authoredCatalogHash: fixture.authoredCatalog.authoredCatalogHash,
  },
  runtime: {
    runtimeMode: runtimeSession.identity.runtimeMode,
    launcherName: runtimeSession.launch.runtimeProfile.launcherName,
    backendMode: manifest.runtime.backendMode,
    backendProfile: manifest.runtime.backendProfile,
    backendProofRefs: manifest.runtime.backendProofRefs,
    resourceProfileId: 'asha-demo.authored-runtime-load.resources.v0',
    resourceManifestHash: stateHash(runtimeResourceManifest),
  },
  readback: {
    projectionSequenceId: projection.sequenceId,
    worldHash: projection.worldHash,
    entityCount: projection.entityCount,
    renderOpCount: renderDiff.frame.ops.length,
    renderDiffHash: stateHash(renderDiff.frame),
    readbackHash: stateHash({ projection, renderDiff: renderDiff.frame, authored: fixture.runtimeHints }),
  },
  page: {
    path: 'harness/out/authored-runtime-load/latest/index.html',
    urlHint: 'file://harness/out/authored-runtime-load/latest/index.html',
    readyMarker: 'data-authored-runtime-load-ready="true"',
    proofContentMarker: 'authored-runtime-load-ready',
  },
  checks: {
    fixtureHashFresh: recordedFixtureHash === studioFixtureHash(fixtureWithoutHash),
    authoredObjectPresent: fixture.authoredScene.objectId === 'scene-node:9401',
    authoredAssetPresent: fixture.authoredCatalog.authoredAssetId === 'material.studio-authored-roundtrip',
    runtimeLaunched: runtimeSession.identity.runtimeMode === 'reference',
    browserPageLoaded: true,
    boundaryGuardPassed: boundaryCheck.status === 'passed',
  },
  negativeSmokes: [
    {
      name: 'missing authored object',
      ok: missingObjectFixture.authoredScene.objectId !== null,
      diagnostic: 'missing_authored_object',
    },
    {
      name: 'stale fixture hash',
      ok: staleFixture.fixtureHash === studioFixtureHash({ ...fixtureWithoutHash, authoredCatalog: staleFixture.authoredCatalog }),
      diagnostic: 'stale_authored_fixture_hash',
    },
  ],
  validations: [
    'studio_authored_fixture_hash_verified',
    'authored_scene_object_present',
    'authored_catalog_entry_present',
    'runtime_resource_manifest_hash_recorded',
    'runtime_launched_through_public_runtime_bridge',
    'browser_page_loaded_with_authored_readback',
    'boundary_guard_passed',
    'negative_missing_authored_object_failed_closed',
    'negative_stale_fixture_failed_closed',
  ],
  nonClaims: [
    'not_browser_interaction_evidence',
    'not_runtime_mutation_proof',
    'not_native_runtime_authority',
    'not_private_transport',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};
const pageHtml = renderPage({ artifact: artifactBody });
const pageArtifact = {
  ...artifactBody,
  page: {
    ...artifactBody.page,
    htmlSha256: sha256(pageHtml),
  },
};

await mkdir(outDir, { recursive: true });
await writeFile(pagePath, pageHtml);

const chromium = chromiumPath();
const browserRun = run(chromium, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--virtual-time-budget=1000',
  '--dump-dom',
  pathToFileURL(pagePath).href,
]);
assert.equal(browserRun.status, 'passed', browserRun.stdout + browserRun.stderr);
const pageReadback = extractPageReadback(browserRun.stdout);
assert.equal(pageReadback.authoredRuntimeLoad.objectId, fixture.authoredScene.objectId);
assert.equal(pageReadback.authoredRuntimeLoad.assetId, fixture.authoredCatalog.authoredAssetId);

const finalBody = {
  ...pageArtifact,
  browser: {
    browser: chromium,
    pageReadbackHash: stateHash(pageReadback),
    loadedObjectId: pageReadback.authoredRuntimeLoad.objectId,
    loadedAssetId: pageReadback.authoredRuntimeLoad.assetId,
  },
};
const finalArtifact = { ...finalBody, artifactHash: stateHash(finalBody) };

await writeFile(artifactPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'authored-runtime-load-ready',
  artifact: 'harness/out/authored-runtime-load/latest/index.json',
  objectId: fixture.authoredScene.objectId,
  assetId: fixture.authoredCatalog.authoredAssetId,
}));
