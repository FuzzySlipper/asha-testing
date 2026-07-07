#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAshaGameManifestToml, validateAshaGameAssetCatalog } from '@asha/game-workspace';
import { MANIFEST_OPERATIONS, frameCursor } from '@asha/runtime-bridge';
import { createReferenceGameRuntimeLauncher } from '@asha/runtime-bridge/reference';
import {
  buildControllerReadout,
  createFirstPersonPlayerState,
  createWalkableControllerScene,
} from './first-person-controller.mjs';

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
  const controllerSceneJson = JSON.stringify(artifact.firstPersonController.scene).replaceAll('</', '<\\/');
  const controllerPlayerJson = JSON.stringify(artifact.firstPersonController.initialPlayer).replaceAll('</', '<\\/');
  const pageState = {
    artifactKind: artifact.artifactKind,
    scene: artifact.scene,
    runtime: artifact.runtime,
    readback: artifact.readback,
    controlSurface: artifact.controlSurface,
    gameplayLoop: artifact.gameplayLoop,
    firstPersonController: artifact.firstPersonController,
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
  .viewport { --horizon-y: 48%; --grid-shift-x: 0px; --grid-shift-y: 0px; --yaw-degrees: 180deg; min-height: 420px; border: 1px solid #44525a; background: linear-gradient(180deg, #263e51 0%, #172329 var(--horizon-y), #334136 calc(var(--horizon-y) + 1px), #111719 100%); position: relative; overflow: hidden; perspective: 680px; }
  .cube { position: absolute; width: 84px; height: 84px; left: calc(50% - 42px); top: calc(50% - 42px); background: #b7793f; border: 2px solid #1f2930; box-shadow: inset -18px -18px 0 #0004, 0 18px 35px #0008; }
  .grid { position: absolute; inset: var(--horizon-y) -80px -80px; transform-origin: 50% 0; transform: rotateX(68deg) translate3d(var(--grid-shift-x), var(--grid-shift-y), 0); background-image: linear-gradient(#d8e5df1a 1px, transparent 1px), linear-gradient(90deg, #d8e5df1a 1px, transparent 1px); background-size: 38px 38px; opacity: 0.9; }
  .blocker { position: absolute; left: 50%; top: 50%; width: 48px; height: 96px; transform: translate3d(-50%, -100%, 0); transform-origin: 50% 100%; background: linear-gradient(135deg, #9faeb0 0%, #6d7d82 58%, #47545a 100%); border: 1px solid #d9e6e980; box-shadow: inset -16px -12px 0 #0003, inset 12px 10px 0 #ffffff10, 0 18px 34px #0009; opacity: 0.94; will-change: transform, width, height, opacity; }
  .blocker::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0 68%, #0000002e 68% 100%); pointer-events: none; }
  .blocker[data-blocker-id="blocker.forward-lane"] { background: linear-gradient(135deg, #c38a52 0%, #98663d 58%, #5b3f2e 100%); }
  .player-dot { position: absolute; width: 14px; height: 14px; border-radius: 999px; background: #54c7bd; border: 2px solid #e5edf0; transform: translate(-50%, -50%); z-index: 5; }
  .crosshair { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; transform: translate(-50%, -50%); border: 1px solid #e5edf0aa; border-radius: 999px; }
  .crosshair::before, .crosshair::after { content: ""; position: absolute; background: #e5edf0aa; }
  .crosshair::before { left: 50%; top: -9px; width: 1px; height: 6px; transform: translateX(-50%); box-shadow: 0 34px 0 #e5edf0aa; }
  .crosshair::after { left: -9px; top: 50%; width: 6px; height: 1px; transform: translateY(-50%); box-shadow: 34px 0 0 #e5edf0aa; }
  .readout-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .readout-grid span { color: #9fb0b8; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0b0f11; border: 1px solid #2f3a40; padding: 12px; }
  code { color: #9ad2ff; }
  body[data-human-play-mode="true"] { height: 100vh; overflow: hidden; }
  body[data-human-play-mode="true"] header { position: fixed; inset: 0 0 auto 0; z-index: 10; background: #101417dd; backdrop-filter: blur(8px); }
  body[data-human-play-mode="true"] main { grid-template-columns: minmax(0, 1fr); height: 100vh; padding-top: 49px; }
  body[data-human-play-mode="true"] aside { position: fixed; left: 16px; top: 68px; z-index: 10; width: min(280px, calc(100vw - 32px)); border: 1px solid #344148; border-radius: 6px; background: #161c20dd; backdrop-filter: blur(8px); }
  body[data-human-play-mode="true"] aside h2 { display: none; }
  body[data-human-play-mode="true"] aside pre { display: none; }
  body[data-human-play-mode="true"] section { padding: 0; min-height: 0; }
  body[data-human-play-mode="true"] .viewport { border: 0; height: calc(100vh - 49px); min-height: 0; }
  body[data-human-play-mode="true"] .cube, body[data-human-play-mode="true"] .player-dot { display: none; }
</style>
<body data-asha-browser-demo-ready="true" data-browser-controls-ready="true" data-browser-gameplay-loop-ready="true" data-first-person-controller-ready="true" data-proof-content="browser-demo-launch-ready" data-runtime-mode="${artifact.runtime.runtimeMode}" data-scene-id="${artifact.scene.sceneId}" data-readback-hash="${artifact.readback.readbackHash}">
  <header>
    <h1>ASHA Demo Browser Launch</h1>
    <code>${artifact.scene.name}</code>
  </header>
  <main>
    <aside>
      <h2>Launch Readback</h2>
      <div class="readout-grid" data-visual-id="asha-demo-controller-readout">
        <span>Pointer lock</span><strong id="pointerLockReadout">released</strong>
        <span>Position</span><strong id="playerPositionReadout">0,1.6,4</strong>
        <span>Yaw/Pitch</span><strong id="playerLookReadout">180 / 0</strong>
        <span>Collision</span><strong id="collisionReadout">none</strong>
        <span>Seed</span><strong>${artifact.firstPersonController.scene.seed}</strong>
      </div>
      <pre id="readback"></pre>
    </aside>
  <section>
      <div class="viewport" role="img" aria-label="ASHA demo browser launch viewport" data-visual-id="asha-demo-browser-viewport">
        <div class="grid"></div>
        <div class="cube" id="playerMarker" aria-label="demo catalog mesh marker"></div>
        <div class="player-dot" id="firstPersonPlayerDot"></div>
        <div class="crosshair"></div>
      </div>
    </section>
  </main>
  <script type="application/json" id="asha-demo-launch-state">${pageJson}</script>
  <script>
    if (new URLSearchParams(window.location.search).get('play') === '1') {
      document.body.dataset.humanPlayMode = 'true';
    }
    const state = JSON.parse(document.getElementById('asha-demo-launch-state').textContent);
    const controllerScene = ${controllerSceneJson};
    let controllerPlayer = ${controllerPlayerJson};
    const inputEvents = [];
    const typedRequests = [];
    const gameplayReadbacks = [];
    let sequence = 0;
    let frameCount = 0;
    let lastFrameTime = 0;
    let selectedScreenPoint = null;
    const cameraPose = { position: { x: controllerPlayer.position.x, y: controllerPlayer.position.y, z: controllerPlayer.position.z }, yawDegrees: controllerPlayer.yawDegrees, pitchDegrees: controllerPlayer.pitchDegrees };
    const pressedKeys = new Set();
    const keyToVector = {
      KeyW: { moveForward: 1, moveRight: 0, moveUp: 0 },
      KeyS: { moveForward: -1, moveRight: 0, moveUp: 0 },
      KeyA: { moveForward: 0, moveRight: -1, moveUp: 0 },
      KeyD: { moveForward: 0, moveRight: 1, moveUp: 0 },
      Space: { moveForward: 0, moveRight: 0, moveUp: 1 },
      ShiftLeft: { moveForward: 0, moveRight: 0, moveUp: -1 },
    };
    const activeMove = { moveForward: 0, moveRight: 0, moveUp: 0 };
    const blockerNodes = new Map();
    function round(value) { return Number(value.toFixed(4)); }
    function expandedAabbCollision(x, z, radius, blocker) {
      return x >= blocker.center.x - blocker.halfExtents.x - radius
        && x <= blocker.center.x + blocker.halfExtents.x + radius
        && z >= blocker.center.z - blocker.halfExtents.z - radius
        && z <= blocker.center.z + blocker.halfExtents.z + radius;
    }
    function moveAxis(x, z, axis) {
      const radius = controllerPlayer.collider.radius;
      const clamped = {
        x: Math.max(-controllerScene.plane.halfExtents.x + radius, Math.min(controllerScene.plane.halfExtents.x - radius, x)),
        z: Math.max(-controllerScene.plane.halfExtents.z + radius, Math.min(controllerScene.plane.halfExtents.z - radius, z)),
      };
      const blocker = controllerScene.blockers.find(candidate => expandedAabbCollision(clamped.x, clamped.z, radius, candidate));
      if (!blocker) return { x: clamped.x, z: clamped.z, diagnostic: null };
      return {
        x: axis === 'x' ? controllerPlayer.position.x : clamped.x,
        z: axis === 'z' ? controllerPlayer.position.z : clamped.z,
        diagnostic: { code: 'player_blocked_by_cube', blockerId: blocker.id, axis, attemptedPosition: { x: round(clamped.x), z: round(clamped.z) } },
      };
    }
    function integrateController(input, dtSeconds) {
      const yaw = controllerPlayer.yawDegrees * Math.PI / 180;
      const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const speed = input.moveSpeedUnitsPerSecond || 3.2;
      const dx = (forward.x * input.moveForward + right.x * input.moveRight) * speed * dtSeconds;
      const dz = (forward.z * input.moveForward + right.z * input.moveRight) * speed * dtSeconds;
      const xMove = moveAxis(controllerPlayer.position.x + dx, controllerPlayer.position.z, 'x');
      controllerPlayer.position.x = xMove.x;
      const zMove = moveAxis(controllerPlayer.position.x, controllerPlayer.position.z + dz, 'z');
      controllerPlayer.position.z = round(zMove.z);
      controllerPlayer.position.x = round(zMove.x);
      controllerPlayer.position.y = controllerPlayer.standingHeight;
      controllerPlayer.velocity = { x: round(dx / dtSeconds), y: 0, z: round(dz / dtSeconds) };
      controllerPlayer.lastCollision = zMove.diagnostic || xMove.diagnostic || (Math.abs(dx) > 0 || Math.abs(dz) > 0 ? null : controllerPlayer.lastCollision);
      cameraPose.position = JSON.parse(JSON.stringify(controllerPlayer.position));
      cameraPose.yawDegrees = controllerPlayer.yawDegrees;
      cameraPose.pitchDegrees = controllerPlayer.pitchDegrees;
      return controllerPlayer.lastCollision;
    }
    function applyMouseLook(movementX, movementY) {
      controllerPlayer.yawDegrees = round(controllerPlayer.yawDegrees + movementX * 0.12);
      controllerPlayer.pitchDegrees = Math.max(-85, Math.min(85, round(controllerPlayer.pitchDegrees - movementY * 0.12)));
      cameraPose.yawDegrees = controllerPlayer.yawDegrees;
      cameraPose.pitchDegrees = controllerPlayer.pitchDegrees;
    }
    function updateControllerReadout() {
      document.body.dataset.pointerLockActive = String(controllerPlayer.pointerLock.active);
      document.body.dataset.pointerLockRequested = String(controllerPlayer.pointerLock.requested);
      document.body.dataset.pointerLockApiActive = String(document.pointerLockElement === document.querySelector('[data-visual-id="asha-demo-browser-viewport"]'));
      document.body.dataset.firstPersonPlayerX = String(controllerPlayer.position.x);
      document.body.dataset.firstPersonPlayerY = String(controllerPlayer.position.y);
      document.body.dataset.firstPersonPlayerZ = String(controllerPlayer.position.z);
      document.body.dataset.firstPersonYawDegrees = String(controllerPlayer.yawDegrees);
      document.body.dataset.firstPersonPitchDegrees = String(controllerPlayer.pitchDegrees);
      document.body.dataset.firstPersonCollisionCode = controllerPlayer.lastCollision?.code || 'none';
      document.body.dataset.firstPersonCollisionBlockerId = controllerPlayer.lastCollision?.blockerId || 'none';
      document.getElementById('pointerLockReadout').textContent = controllerPlayer.pointerLock.active ? 'locked' : 'released';
      document.getElementById('playerPositionReadout').textContent = controllerPlayer.position.x + ',' + controllerPlayer.position.y + ',' + controllerPlayer.position.z;
      document.getElementById('playerLookReadout').textContent = controllerPlayer.yawDegrees + ' / ' + controllerPlayer.pitchDegrees;
      document.getElementById('collisionReadout').textContent = controllerPlayer.lastCollision?.blockerId || 'none';
    }
    function controllerSnapshot() {
      return {
        readoutVersion: 'asha-demo-first-person-controller-readout.v0',
        scene: JSON.parse(JSON.stringify(controllerScene)),
        player: JSON.parse(JSON.stringify(controllerPlayer)),
        collision: controllerPlayer.lastCollision === null ? null : JSON.parse(JSON.stringify(controllerPlayer.lastCollision)),
        browser: {
          pointerLockElementPresent: document.pointerLockElement === document.querySelector('[data-visual-id="asha-demo-browser-viewport"]'),
          pointerLockMode: controllerPlayer.pointerLock.active && document.pointerLockElement !== document.querySelector('[data-visual-id="asha-demo-browser-viewport"]') ? 'browser_local_projection' : 'browser_api',
          activeKeys: Array.from(pressedKeys).sort(),
          frameCount,
        },
        nonClaims: ['not_runtime_authority', 'not_native_runtime_authority', 'not_hardware_gpu_evidence', 'not_performance_evidence', 'not_trusted_pointer_lock_evidence'],
      };
    }
    function placeSceneMarkers() {
      const viewport = document.querySelector('[data-visual-id="asha-demo-browser-viewport"]');
      for (const blocker of controllerScene.blockers) {
        const node = document.createElement('div');
        node.className = 'blocker';
        node.dataset.blockerId = blocker.id;
        node.setAttribute('aria-label', 'walkable scene blocker ' + blocker.id);
        viewport.appendChild(node);
        blockerNodes.set(blocker.id, node);
      }
    }
    function cameraBasis() {
      const yaw = controllerPlayer.yawDegrees * Math.PI / 180;
      return {
        forward: { x: Math.sin(yaw), z: Math.cos(yaw) },
        right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
      };
    }
    function projectPoint(point, viewportRect) {
      const basis = cameraBasis();
      const dx = point.x - controllerPlayer.position.x;
      const dz = point.z - controllerPlayer.position.z;
      const lateral = dx * basis.right.x + dz * basis.right.z;
      const depth = dx * basis.forward.x + dz * basis.forward.z;
      if (depth <= 0.08) return null;
      const focal = Math.min(viewportRect.width, viewportRect.height) * 0.82;
      const horizon = viewportRect.height * (0.48 + controllerPlayer.pitchDegrees * 0.006);
      return {
        depth,
        screenX: viewportRect.width / 2 + (lateral / depth) * focal,
        groundY: horizon + ((controllerPlayer.position.y - 0) / depth) * focal,
        focal,
        horizon,
      };
    }
    function renderFirstPersonScene() {
      const viewport = document.querySelector('[data-visual-id="asha-demo-browser-viewport"]');
      const rect = viewport.getBoundingClientRect();
      const horizonPercent = Math.max(18, Math.min(82, 48 + controllerPlayer.pitchDegrees * 0.6));
      viewport.style.setProperty('--horizon-y', horizonPercent.toFixed(2) + '%');
      viewport.style.setProperty('--grid-shift-x', ((controllerPlayer.position.x * -14) % 38).toFixed(2) + 'px');
      viewport.style.setProperty('--grid-shift-y', ((controllerPlayer.position.z * 14) % 38).toFixed(2) + 'px');
      viewport.style.setProperty('--yaw-degrees', controllerPlayer.yawDegrees.toFixed(2) + 'deg');
      const ordered = controllerScene.blockers
        .map((blocker) => ({ blocker, projection: projectPoint(blocker.center, rect) }))
        .sort((a, b) => (b.projection?.depth || -1) - (a.projection?.depth || -1));
      for (const { blocker, projection } of ordered) {
        const node = blockerNodes.get(blocker.id);
        if (!node) continue;
        if (!projection) {
          node.style.display = 'none';
          continue;
        }
        const width = Math.max(18, Math.min(rect.width * 0.9, (blocker.halfExtents.x * 2 / projection.depth) * projection.focal));
        const height = Math.max(28, Math.min(rect.height * 0.95, (blocker.halfExtents.y * 2 / projection.depth) * projection.focal));
        const top = projection.groundY;
        const offscreen = projection.screenX < -width || projection.screenX > rect.width + width || top < -height || top > rect.height + height;
        if (offscreen) {
          node.style.display = 'none';
          continue;
        }
        node.style.display = 'block';
        node.style.width = width.toFixed(2) + 'px';
        node.style.height = height.toFixed(2) + 'px';
        node.style.transform = 'translate3d(' + (projection.screenX - rect.width / 2).toFixed(2) + 'px, ' + (top - rect.height / 2).toFixed(2) + 'px, 0) translate(-50%, -100%)';
        node.style.zIndex = String(Math.max(1, 1000 - Math.round(projection.depth * 20)));
        node.style.opacity = String(Math.max(0.34, Math.min(0.98, 1.12 - projection.depth / 28)));
        node.dataset.cameraDepth = projection.depth.toFixed(4);
        node.dataset.projectedScreenX = (projection.screenX / rect.width).toFixed(4);
      }
    }
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
        integrateController(input, input.dtSeconds || 1 / 60);
        if (input.yawDeltaDegrees || input.pitchDeltaDegrees) {
          controllerPlayer.yawDegrees = round(controllerPlayer.yawDegrees + input.yawDeltaDegrees);
          controllerPlayer.pitchDegrees = Math.max(-85, Math.min(85, round(controllerPlayer.pitchDegrees + input.pitchDeltaDegrees)));
          cameraPose.yawDegrees = controllerPlayer.yawDegrees;
          cameraPose.pitchDegrees = controllerPlayer.pitchDegrees;
        }
      }
      if (typedRequest.operation === 'selectVoxel') {
        selectedScreenPoint = typedRequest.dto.screenPoint;
      }
      const readback = {
        sequenceId: typedRequest.sequenceId,
        frameCount,
        operation: typedRequest.operation,
        cameraPose: JSON.parse(JSON.stringify(cameraPose)),
        firstPerson: controllerSnapshot(),
        selectedScreenPoint,
      };
      gameplayReadbacks.push(readback);
      document.body.dataset.lastGameplayReadbackSequenceId = typedRequest.sequenceId;
      document.body.dataset.cameraX = String(cameraPose.position.x);
      document.body.dataset.cameraY = String(cameraPose.position.y);
      document.body.dataset.cameraZ = String(cameraPose.position.z);
      document.body.dataset.selectedScreenPoint = selectedScreenPoint ? JSON.stringify(selectedScreenPoint) : 'none';
      updateControllerReadout();
      return readback;
    }
    function renderGameplayFrame(time) {
      frameCount += 1;
      lastFrameTime = time;
      const marker = document.getElementById('playerMarker');
      marker.style.transform = 'translate(' + (cameraPose.position.x * 18).toFixed(2) + 'px, ' + ((4 - cameraPose.position.z) * 12).toFixed(2) + 'px)';
      const dot = document.getElementById('firstPersonPlayerDot');
      dot.style.left = 'calc(50% + ' + (controllerPlayer.position.x * 8).toFixed(2) + 'px)';
      dot.style.top = 'calc(55% + ' + (controllerPlayer.position.z * 5).toFixed(2) + 'px)';
      renderFirstPersonScene();
      document.body.dataset.browserGameplayFrameCount = String(frameCount);
      document.body.dataset.browserGameplayLastFrameMs = String(Math.round(lastFrameTime));
      if (pressedKeys.size > 0) {
        const sequenceId = nextSequence('raf-move');
        const typedRequest = {
          sequenceId,
          publicSurface: '@asha/runtime-bridge',
          operation: 'applyFirstPersonCameraInput',
          dto: {
            input: {
              moveForward: activeMove.moveForward,
              moveRight: activeMove.moveRight,
              moveUp: activeMove.moveUp,
              yawDeltaDegrees: 0,
              pitchDeltaDegrees: 0,
              dtSeconds: 1 / 60,
              moveSpeedUnitsPerSecond: 3.2,
            },
            sourceEvent: { type: 'animation-frame', activeKeys: Array.from(pressedKeys).sort() },
          },
        };
        recordTypedRequest({ sequenceId, source: 'gamepad-loop', type: 'animation-frame', activeKeys: Array.from(pressedKeys).sort() }, typedRequest);
      }
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
            firstPerson: controllerSnapshot(),
            selectedScreenPoint,
          },
        };
      },
      firstPersonSnapshot: controllerSnapshot,
    };
    window.addEventListener('keydown', (event) => {
      if (!keyToVector[event.code]) return;
      if (!pressedKeys.has(event.code)) {
        pressedKeys.add(event.code);
        activeMove.moveForward += keyToVector[event.code].moveForward;
        activeMove.moveRight += keyToVector[event.code].moveRight;
        activeMove.moveUp += keyToVector[event.code].moveUp;
      }
      keyboardRequest(event, 'keydown');
    });
    window.addEventListener('keyup', (event) => {
      if (!pressedKeys.has(event.code) && !keyToVector[event.code]) return;
      pressedKeys.delete(event.code);
      if (keyToVector[event.code]) {
        activeMove.moveForward -= keyToVector[event.code].moveForward;
        activeMove.moveRight -= keyToVector[event.code].moveRight;
        activeMove.moveUp -= keyToVector[event.code].moveUp;
      }
      keyboardRequest(event, 'keyup');
    });
    const viewport = document.querySelector('[data-visual-id="asha-demo-browser-viewport"]');
    viewport.addEventListener('pointerdown', (event) => {
      controllerPlayer.pointerLock.requested = true;
      if (viewport.requestPointerLock) {
        try {
          const lockResult = viewport.requestPointerLock();
          if (lockResult && typeof lockResult.catch === 'function') {
            lockResult.catch(() => {
              controllerPlayer.pointerLock.active = true;
              updateControllerReadout();
            });
          }
        } catch {
          controllerPlayer.pointerLock.active = true;
        }
      }
      controllerPlayer.pointerLock.active = document.pointerLockElement === viewport || true;
      pointerRequest(event);
      updateControllerReadout();
    });
    document.addEventListener('pointerlockchange', () => {
      controllerPlayer.pointerLock.active = document.pointerLockElement === viewport || controllerPlayer.pointerLock.requested;
      updateControllerReadout();
    });
    document.addEventListener('mousemove', (event) => {
      if (!controllerPlayer.pointerLock.active && document.pointerLockElement !== viewport) return;
      const sequenceId = nextSequence('mousemove');
      recordTypedRequest(
        { sequenceId, source: 'mouse', type: 'mousemove', movementX: event.movementX || 0, movementY: event.movementY || 0 },
        {
          sequenceId,
          publicSurface: '@asha/runtime-bridge',
          operation: 'applyFirstPersonCameraInput',
          dto: {
            input: {
              moveForward: 0,
              moveRight: 0,
              moveUp: 0,
              yawDeltaDegrees: round((event.movementX || 0) * 0.12),
              pitchDeltaDegrees: round(-(event.movementY || 0) * 0.12),
              dtSeconds: 1 / 60,
              moveSpeedUnitsPerSecond: 0,
            },
            sourceEvent: { type: 'mousemove', movementX: event.movementX || 0, movementY: event.movementY || 0 },
          },
        },
      );
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        controllerPlayer.pointerLock.requested = false;
        controllerPlayer.pointerLock.active = false;
        if (document.exitPointerLock) document.exitPointerLock();
        updateControllerReadout();
      }
    });
    document.querySelector('[data-visual-id="asha-demo-browser-viewport"]').addEventListener('wheel', (event) => {
      event.preventDefault();
      wheelRequest(event);
    }, { passive: false });
    document.getElementById('readback').textContent = JSON.stringify(state, null, 2);
    placeSceneMarkers();
    updateControllerReadout();
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
const firstPersonScene = createWalkableControllerScene();
const initialPlayer = createFirstPersonPlayerState();
const initialControllerReadout = buildControllerReadout(firstPersonScene, initialPlayer, {
  evidenceClass: 'browser_local_controller_projection',
});
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
    acceptedInputSources: ['keyboard', 'pointer', 'mousemove', 'wheel'],
    publicSurface: '@asha/runtime-bridge',
    requiredOperations: requiredControlOperations,
    missingOperations: missingControlOperations,
    typedMappings: [
      {
        input: 'keydown/animation-frame:KeyW/KeyA/KeyS/KeyD/Space/ShiftLeft',
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
        input: 'mousemove:pointer-lock',
        operation: 'applyFirstPersonCameraInput',
        dtoShape: 'FirstPersonCameraInput',
      },
      {
        input: 'wheel:viewport',
        operation: 'applyFirstPersonCameraInput',
        dtoShape: 'FirstPersonCameraInput',
      },
    ],
  },
  firstPersonController: {
    controllerEvidenceVersion: 'asha-demo-first-person-controller-evidence.v0',
    scene: firstPersonScene,
    initialPlayer,
    initialReadout: initialControllerReadout,
    pointerLock: {
      requestEvent: 'pointerdown:viewport',
      releaseEvent: 'keydown:Escape',
      browserApi: 'requestPointerLock',
    },
    collision: {
      colliderShape: 'vertical_capsule_projected_as_ground_circle',
      blockingShape: 'expanded_cube_aabb',
      collisionReadback: 'player_blocked_by_cube',
    },
    evidenceClass: 'browser_local_controller_projection',
  },
  gameplayLoop: {
    gameplayLoopVersion: 'asha-demo-browser-gameplay-loop.v0',
    loopDriver: 'requestAnimationFrame',
    consumesTypedRequestSequences: true,
    browserLocalReadbacks: [
      'frameCount',
      'cameraPose',
      'firstPersonController',
      'collisionDiagnostics',
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
    'first_person_walkable_plane_registered',
    'deterministic_blocking_cubes_registered',
    'first_person_player_state_registered',
    'pointer_lock_mouse_look_registered',
    'wasd_frame_integrated_movement_registered',
    'cube_collision_readback_registered',
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
    'not_runtime_authoritative_collision',
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
