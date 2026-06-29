#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAshaGameManifestToml, validateAshaGameAssetCatalog } from '@asha/game-workspace';
import { MANIFEST_OPERATIONS, createReferenceGameRuntimeLauncher, frameCursor } from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'harness/out/browser-demo/latest');
const artifactPath = path.join(outDir, 'index.json');
const pagePath = path.join(outDir, 'index.html');
const requiredControlOperations = [
  'applyFirstPersonCameraInput',
  'selectVoxel',
];

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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function renderPage({ artifact }) {
  const pageState = {
    artifactKind: artifact.artifactKind,
    scene: artifact.scene,
    runtime: artifact.runtime,
    readback: artifact.readback,
    controlSurface: artifact.controlSurface,
    gameplayLoop: artifact.gameplayLoop,
    pageHash: artifact.page.pageHash,
  };
  const pageJson = JSON.stringify(pageState).replaceAll('</', '<\\/');
  return `<!doctype html>
<meta charset="utf-8">
<title>ASHA Demo Browser Launch</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #101417; color: #e5edf0; }
  body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
  header { padding: 14px 18px; border-bottom: 1px solid #344148; display: flex; gap: 14px; align-items: center; justify-content: space-between; }
  main { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; min-height: 0; }
  aside { border-right: 1px solid #344148; padding: 16px; background: #161c20; }
  section { padding: 18px; }
  h1, h2 { margin: 0; font-size: 15px; }
  .viewport { min-height: 360px; border: 1px solid #44525a; background: linear-gradient(180deg, #223846 0%, #172126 48%, #293236 49%, #121719 100%); position: relative; overflow: hidden; }
  .cube { position: absolute; width: 84px; height: 84px; left: calc(50% - 42px); top: calc(50% - 42px); background: #b7793f; border: 2px solid #1f2930; box-shadow: inset -18px -18px 0 #0004, 0 18px 35px #0008; }
  .grid { position: absolute; inset: 55% 0 0; background-image: linear-gradient(#ffffff12 1px, transparent 1px), linear-gradient(90deg, #ffffff12 1px, transparent 1px); background-size: 32px 32px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0b0f11; border: 1px solid #2f3a40; padding: 12px; }
  code { color: #9ad2ff; }
</style>
<body data-asha-browser-demo-ready="true" data-browser-controls-ready="true" data-browser-gameplay-loop-ready="true" data-proof-content="browser-demo-launch-ready" data-runtime-mode="${artifact.runtime.runtimeMode}" data-scene-id="${artifact.scene.sceneId}" data-readback-hash="${artifact.readback.readbackHash}">
  <header>
    <h1>ASHA Demo Browser Launch</h1>
    <code>${artifact.scene.name}</code>
  </header>
  <main>
    <aside>
      <h2>Launch Readback</h2>
      <pre id="readback"></pre>
    </aside>
  <section>
      <div class="viewport" role="img" aria-label="ASHA demo browser launch viewport" data-visual-id="asha-demo-browser-viewport">
        <div class="grid"></div>
        <div class="cube" id="playerMarker" aria-label="demo catalog mesh marker"></div>
      </div>
    </section>
  </main>
  <script type="application/json" id="asha-demo-launch-state">${pageJson}</script>
  <script>
    const state = JSON.parse(document.getElementById('asha-demo-launch-state').textContent);
    const inputEvents = [];
    const typedRequests = [];
    const gameplayReadbacks = [];
    let sequence = 0;
    let frameCount = 0;
    let lastFrameTime = 0;
    let selectedScreenPoint = null;
    const cameraPose = { position: { x: 0, y: 1.6, z: 4 }, yawDegrees: 0, pitchDegrees: 0 };
    const pressedKeys = new Set();
    const keyToVector = {
      KeyW: { moveForward: 1, moveRight: 0, moveUp: 0 },
      KeyS: { moveForward: -1, moveRight: 0, moveUp: 0 },
      KeyA: { moveForward: 0, moveRight: -1, moveUp: 0 },
      KeyD: { moveForward: 0, moveRight: 1, moveUp: 0 },
      Space: { moveForward: 0, moveRight: 0, moveUp: 1 },
      ShiftLeft: { moveForward: 0, moveRight: 0, moveUp: -1 },
    };
    function nextSequence(eventType) {
      sequence += 1;
      return 'browser-input-' + String(sequence).padStart(4, '0') + '-' + eventType;
    }
    function recordTypedRequest(event, typedRequest) {
      inputEvents.push(event);
      typedRequests.push(typedRequest);
      applyTypedRequest(typedRequest);
      document.body.dataset.lastBrowserInputSequenceId = event.sequenceId;
      document.body.dataset.lastTypedAshaOperation = typedRequest.operation;
      document.body.dataset.typedRequestCount = String(typedRequests.length);
      document.getElementById('readback').textContent = JSON.stringify(window.ashaDemoBrowserLaunch.snapshot(), null, 2);
      return typedRequest;
    }
    function applyTypedRequest(typedRequest) {
      if (typedRequest.operation === 'applyFirstPersonCameraInput') {
        const input = typedRequest.dto.input;
        cameraPose.position.x = Number((cameraPose.position.x + input.moveRight * 0.1).toFixed(4));
        cameraPose.position.y = Number((cameraPose.position.y + input.moveUp * 0.1).toFixed(4));
        cameraPose.position.z = Number((cameraPose.position.z - input.moveForward * 0.1).toFixed(4));
        cameraPose.pitchDegrees = Number((cameraPose.pitchDegrees + input.pitchDeltaDegrees).toFixed(4));
      }
      if (typedRequest.operation === 'selectVoxel') {
        selectedScreenPoint = typedRequest.dto.screenPoint;
      }
      const readback = {
        sequenceId: typedRequest.sequenceId,
        frameCount,
        operation: typedRequest.operation,
        cameraPose: JSON.parse(JSON.stringify(cameraPose)),
        selectedScreenPoint,
      };
      gameplayReadbacks.push(readback);
      document.body.dataset.lastGameplayReadbackSequenceId = typedRequest.sequenceId;
      document.body.dataset.cameraX = String(cameraPose.position.x);
      document.body.dataset.cameraY = String(cameraPose.position.y);
      document.body.dataset.cameraZ = String(cameraPose.position.z);
      document.body.dataset.selectedScreenPoint = selectedScreenPoint ? JSON.stringify(selectedScreenPoint) : 'none';
      return readback;
    }
    function renderGameplayFrame(time) {
      frameCount += 1;
      lastFrameTime = time;
      const marker = document.getElementById('playerMarker');
      marker.style.transform = 'translate(' + (cameraPose.position.x * 18).toFixed(2) + 'px, ' + ((4 - cameraPose.position.z) * 12).toFixed(2) + 'px)';
      document.body.dataset.browserGameplayFrameCount = String(frameCount);
      document.body.dataset.browserGameplayLastFrameMs = String(Math.round(lastFrameTime));
      window.requestAnimationFrame(renderGameplayFrame);
    }
    function keyboardRequest(domEvent, phase) {
      const vector = keyToVector[domEvent.code];
      if (!vector) return null;
      const sequenceId = nextSequence(phase);
      const event = { sequenceId, source: 'keyboard', type: domEvent.type, code: domEvent.code, phase };
      const typedRequest = {
        sequenceId,
        publicSurface: '@asha/runtime-bridge',
        operation: 'applyFirstPersonCameraInput',
        dto: {
          input: {
            moveForward: phase === 'keyup' ? 0 : vector.moveForward,
            moveRight: phase === 'keyup' ? 0 : vector.moveRight,
            moveUp: phase === 'keyup' ? 0 : vector.moveUp,
            yawDeltaDegrees: 0,
            pitchDeltaDegrees: 0,
            dtSeconds: 1 / 60,
            moveSpeedUnitsPerSecond: 3,
          },
          sourceEvent: { type: domEvent.type, code: domEvent.code },
        },
      };
      return recordTypedRequest(event, typedRequest);
    }
    function pointerRequest(domEvent) {
      const rect = document.querySelector('[data-visual-id="asha-demo-browser-viewport"]').getBoundingClientRect();
      const sequenceId = nextSequence(domEvent.type);
      const screenPoint = {
        x: Number(((domEvent.clientX - rect.left) / rect.width).toFixed(4)),
        y: Number(((domEvent.clientY - rect.top) / rect.height).toFixed(4)),
        space: 'normalized_0_1',
      };
      const event = { sequenceId, source: 'pointer', type: domEvent.type, button: domEvent.button, screenPoint };
      const typedRequest = {
        sequenceId,
        publicSurface: '@asha/runtime-bridge',
        operation: 'selectVoxel',
        dto: {
          screenPoint,
          viewport: { width: Math.round(rect.width), height: Math.round(rect.height) },
          sourceEvent: { type: domEvent.type, button: domEvent.button },
        },
      };
      return recordTypedRequest(event, typedRequest);
    }
    function wheelRequest(domEvent) {
      const sequenceId = nextSequence('wheel');
      const event = { sequenceId, source: 'wheel', type: domEvent.type, deltaY: domEvent.deltaY };
      const typedRequest = {
        sequenceId,
        publicSurface: '@asha/runtime-bridge',
        operation: 'applyFirstPersonCameraInput',
        dto: {
          input: {
            moveForward: 0,
            moveRight: 0,
            moveUp: 0,
            yawDeltaDegrees: 0,
            pitchDeltaDegrees: Number((-domEvent.deltaY * 0.02).toFixed(4)),
            dtSeconds: 1 / 60,
            moveSpeedUnitsPerSecond: 3,
          },
          sourceEvent: { type: domEvent.type, deltaY: domEvent.deltaY },
        },
      };
      return recordTypedRequest(event, typedRequest);
    }
    window.ashaDemoBrowserLaunch = {
      launchVersion: 'asha-demo-browser-launch.v0',
      ready: true,
      controlSurface: state.controlSurface,
      gameplayLoop: state.gameplayLoop,
      inputEvents,
      typedRequests,
      gameplayReadbacks,
      snapshot() {
        return {
          ...state,
          inputEvents,
          typedRequests,
          gameplayReadbacks,
          gameplay: {
            frameCount,
            cameraPose,
            selectedScreenPoint,
          },
        };
      },
    };
    window.addEventListener('keydown', (event) => {
      if (!keyToVector[event.code]) return;
      pressedKeys.add(event.code);
      keyboardRequest(event, 'keydown');
    });
    window.addEventListener('keyup', (event) => {
      if (!pressedKeys.has(event.code) && !keyToVector[event.code]) return;
      pressedKeys.delete(event.code);
      keyboardRequest(event, 'keyup');
    });
    document.querySelector('[data-visual-id="asha-demo-browser-viewport"]').addEventListener('pointerdown', pointerRequest);
    document.querySelector('[data-visual-id="asha-demo-browser-viewport"]').addEventListener('wheel', (event) => {
      event.preventDefault();
      wheelRequest(event);
    }, { passive: false });
    document.getElementById('readback').textContent = JSON.stringify(state, null, 2);
    document.body.dataset.launchSnapshotReady = 'true';
    window.requestAnimationFrame(renderGameplayFrame);
  </script>
</body>
`;
}

const manifestText = await readFile(path.join(repoRoot, 'asha.game.toml'), 'utf8');
const manifestHash = sha256(manifestText);
const manifestResult = parseAshaGameManifestToml(manifestText);
assert.equal(manifestResult.ok, true, manifestResult.ok ? '' : JSON.stringify(manifestResult.diagnostics));
const manifest = manifestResult.manifest;
const gameId = 'asha-demo';
const fixture = JSON.parse(await readFile(path.join(repoRoot, manifest.runtime.wasmOrNativeEntry), 'utf8'));
const scene = JSON.parse(await readFile(path.join(repoRoot, 'scenes/material-proof.scene.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(repoRoot, 'packages/game-catalogs/catalog.json'), 'utf8'));
const catalogValidation = validateAshaGameAssetCatalog(
  catalog,
  manifest,
  (assetPath) => true,
);
assert.equal(catalogValidation.ok, true, catalogValidation.ok ? '' : JSON.stringify(catalogValidation.diagnostics));
const facadeMethods = new Set(MANIFEST_OPERATIONS.map((operation) => operation.facadeMethod));
const missingControlOperations = requiredControlOperations.filter((operation) => !facadeMethods.has(operation));
assert.deepEqual(missingControlOperations, []);

const launcher = createReferenceGameRuntimeLauncher();
const runtimeSession = await launcher.launch({
  gameId,
  workspaceId: 'workspace.browser-demo',
  runtimeEntry: manifest.runtime.wasmOrNativeEntry,
  compatibility: {
    contractsPackageVersion: manifest.asha.contractsVersion,
    runtimeBridgePackageVersion: manifest.asha.runtimeBridgeVersion,
    devtoolsProtocolVersion: manifest.asha.devtoolsProtocolVersion,
    publishArtifactVersion: manifest.asha.publishArtifactFormatVersion,
  },
  resourceProfile: {
    profileId: 'asha-demo.browser-demo.resources.v0',
    runtimeEntry: manifest.runtime.wasmOrNativeEntry,
    worldBundleId: `scene:${fixture.sceneId}`,
  },
  world: {
    bundleSchemaVersion: fixture.schemaVersion,
    protocolVersion: fixture.protocolVersion,
    sceneId: fixture.sceneId,
  },
  startedAtIso: '2026-06-29T00:00:00.000Z',
});
const projection = await runtimeSession.pullProjection();
const renderDiff = await runtimeSession.pullRenderDiff(frameCursor(fixture.render.frameCursor));
await runtimeSession.shutdown();

const boundaryCheck = run('npm', ['run', 'check:boundary']);
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);

const pageSeed = {
  sceneId: String(scene.sceneId),
  sceneName: scene.name,
  runtimeMode: runtimeSession.identity.runtimeMode,
  projectionSequenceId: projection.sequenceId,
  renderOpCount: renderDiff.frame.ops.length,
};
const artifactBody = {
  artifactKind: 'asha_demo_browser_launch_target',
  artifactVersion: 'asha-demo-browser-launch-target.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run browser:demo',
  page: {
    path: 'harness/out/browser-demo/latest/index.html',
    urlHint: 'file://harness/out/browser-demo/latest/index.html',
    readyMarker: 'data-asha-browser-demo-ready="true"',
    proofContentMarker: 'browser-demo-launch-ready',
    pageHash: stateHash(pageSeed),
  },
  manifest: {
    path: 'asha.game.toml',
    manifestHash,
    gameId,
    runtimeEntry: manifest.runtime.wasmOrNativeEntry,
  },
  scene: {
    path: 'scenes/material-proof.scene.json',
    sceneId: String(scene.sceneId),
    name: scene.name,
    catalogAssetIds: scene.catalogAssetIds,
  },
  runtime: {
    runtimeMode: runtimeSession.identity.runtimeMode,
    launcherName: runtimeSession.launch.runtimeProfile.launcherName,
    backendMode: manifest.runtime.backendMode,
    backendProfile: manifest.runtime.backendProfile,
    backendProofRefs: manifest.runtime.backendProofRefs,
  },
  readback: {
    projectionSequenceId: projection.sequenceId,
    worldHash: projection.worldHash,
    renderOpCount: renderDiff.frame.ops.length,
    renderDiffHash: `render:${scene.sceneId}:${renderDiff.frame.ops.length}:seq:${projection.sequenceId}`,
    readbackHash: stateHash({ projection, renderDiff: renderDiff.frame }),
  },
  controlSurface: {
    controlSurfaceVersion: 'asha-demo-browser-controls.v0',
    acceptedInputSources: ['keyboard', 'pointer', 'wheel'],
    publicSurface: '@asha/runtime-bridge',
    requiredOperations: requiredControlOperations,
    missingOperations: missingControlOperations,
    typedMappings: [
      {
        input: 'keydown:KeyW/KeyA/KeyS/KeyD/Space/ShiftLeft',
        operation: 'applyFirstPersonCameraInput',
        dtoShape: 'FirstPersonCameraInput',
      },
      {
        input: 'keyup:KeyW/KeyA/KeyS/KeyD/Space/ShiftLeft',
        operation: 'applyFirstPersonCameraInput',
        dtoShape: 'FirstPersonCameraInput',
      },
      {
        input: 'pointerdown:viewport',
        operation: 'selectVoxel',
        dtoShape: 'ScreenPointSelection',
      },
      {
        input: 'wheel:viewport',
        operation: 'applyFirstPersonCameraInput',
        dtoShape: 'FirstPersonCameraInput',
      },
    ],
  },
  gameplayLoop: {
    gameplayLoopVersion: 'asha-demo-browser-gameplay-loop.v0',
    loopDriver: 'requestAnimationFrame',
    consumesTypedRequestSequences: true,
    browserLocalReadbacks: [
      'frameCount',
      'cameraPose',
      'selectedScreenPoint',
      'lastGameplayReadbackSequenceId',
    ],
    mutationBoundary: 'browser-local-readback-only',
  },
  checks: {
    boundaryCheck,
    catalogEntryCount: catalogValidation.catalog.entries.length,
    pageImportsStudio: false,
    acceptsArbitraryCommandHatch: false,
  },
  validations: [
    'browser_page_written',
    'launch_readback_projected',
    'manifest_loaded_through_public_game_workspace',
    'runtime_launched_through_public_runtime_bridge',
    'browser_controls_registered',
    'typed_control_mapping_declared',
    'browser_gameplay_loop_registered',
    'typed_requests_drive_browser_local_readback',
    'boundary_guard_passed',
    'no_studio_dependency',
    'no_arbitrary_command_hatch',
  ],
  nonClaims: [
    'not_browser_input_proof',
    'not_runtime_mutation_proof',
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};
const pageHtml = renderPage({ artifact: artifactBody });
const artifact = {
  ...artifactBody,
  page: {
    ...artifactBody.page,
    htmlSha256: sha256(pageHtml),
  },
};
const finalArtifact = { ...artifact, artifactHash: stateHash(artifact) };

await mkdir(outDir, { recursive: true });
await writeFile(pagePath, pageHtml);
await writeFile(artifactPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'browser-demo-launch-ready',
  artifact: 'harness/out/browser-demo/latest/index.json',
  page: 'harness/out/browser-demo/latest/index.html',
}));
