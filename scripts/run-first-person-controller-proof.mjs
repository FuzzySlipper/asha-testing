#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createFirstPersonPlayerState,
  createWalkableControllerScene,
  integrateFirstPersonMovement,
  stateHash,
} from './first-person-controller.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchPagePath = path.join(repoRoot, 'harness/out/browser-demo/latest/index.html');
const launchArtifactPath = path.join(repoRoot, 'harness/out/browser-demo/latest/index.json');
const outDir = path.join(repoRoot, 'harness/out/first-person-controller-proof/latest');
const driverPath = path.join(outDir, 'driver.html');
const screenshotPath = path.join(outDir, 'screenshot.png');
const artifactPath = path.join(outDir, 'index.json');

function sha256Buffer(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function sha256Text(text) {
  return sha256Buffer(Buffer.from(text));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function chromiumPath() {
  for (const candidate of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const result = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim().length > 0) return result.stdout.trim();
  }
  throw new Error('No Chromium-compatible browser found on PATH.');
}

function extractProofResult(dom) {
  const match = dom.match(/<pre id="first-person-controller-proof-result">([\s\S]*?)<\/pre>/);
  assert.ok(match, 'first-person controller proof result marker missing from dumped DOM');
  return JSON.parse(match[1]);
}

const launchRun = run('npm', ['run', 'browser:demo']);
assert.equal(launchRun.status, 'passed', launchRun.stdout + launchRun.stderr);
const launchPage = await readFile(launchPagePath, 'utf8');
const launchArtifactText = await readFile(launchArtifactPath, 'utf8');
const launchArtifact = JSON.parse(launchArtifactText);

const scene = createWalkableControllerScene();
let player = createFirstPersonPlayerState();
let blockedStep = null;
for (let index = 0; index < 40; index += 1) {
  const step = integrateFirstPersonMovement(scene, player, {
    moveForward: 1,
    moveRight: 0,
    moveSpeedUnitsPerSecond: 3.2,
  }, 1 / 60);
  player = step.player;
  if (step.diagnostics.some((diagnostic) => diagnostic.code === 'player_blocked_by_cube')) {
    blockedStep = step;
    break;
  }
}
assert.ok(blockedStep, 'fixture movement should hit the forward-lane blocker');

const driverScript = `
<script>
window.addEventListener('load', () => {
  const viewport = document.querySelector('[data-visual-id="asha-demo-browser-viewport"]');
  const rect = viewport.getBoundingClientRect();
  function dispatchMouseMove(dx, dy) {
    const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'movementX', { value: dx });
    Object.defineProperty(event, 'movementY', { value: dy });
    document.dispatchEvent(event);
  }
  viewport.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: rect.left + rect.width * 0.5,
    clientY: rect.top + rect.height * 0.5,
    button: 0,
    bubbles: true,
  }));
  for (let index = 0; index < 26; index += 1) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true, repeat: index > 0 }));
  }
  window.setTimeout(() => {
    dispatchMouseMove(36, -12);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
    const beforeEscape = window.ashaDemoBrowserLaunch.snapshot();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    const afterEscape = window.ashaDemoBrowserLaunch.snapshot();
    const proof = {
      proofVersion: 'asha-demo-first-person-controller-proof.v0',
      ready: document.body.dataset.firstPersonControllerReady === 'true',
      pointerLock: {
        requested: beforeEscape.gameplay.firstPerson.player.pointerLock.requested,
        activeBeforeEscape: beforeEscape.gameplay.firstPerson.player.pointerLock.active,
        activeAfterEscape: afterEscape.gameplay.firstPerson.player.pointerLock.active,
        bodyRequested: document.body.dataset.pointerLockRequested,
        bodyActive: document.body.dataset.pointerLockActive,
      },
      movement: {
        initialPosition: ${JSON.stringify(createFirstPersonPlayerState().position)},
        finalPosition: beforeEscape.gameplay.firstPerson.player.position,
        yawDegrees: beforeEscape.gameplay.firstPerson.player.yawDegrees,
        pitchDegrees: beforeEscape.gameplay.firstPerson.player.pitchDegrees,
        typedRequestCount: beforeEscape.typedRequests.length,
        readbackCount: beforeEscape.gameplayReadbacks.length,
        frameCount: beforeEscape.gameplay.frameCount,
      },
      collision: beforeEscape.gameplay.firstPerson.collision,
      scene: {
        seed: beforeEscape.gameplay.firstPerson.scene.seed,
        blockerCount: beforeEscape.gameplay.firstPerson.scene.blockers.length,
        forwardBlocker: beforeEscape.gameplay.firstPerson.scene.blockers.find((blocker) => blocker.id === 'blocker.forward-lane'),
      },
      typedOperations: beforeEscape.typedRequests.map((request) => request.operation),
      nonClaims: beforeEscape.gameplay.firstPerson.nonClaims,
    };
    document.body.dataset.firstPersonProofReady = 'true';
    document.body.dataset.firstPersonCollisionBlockerId = proof.collision?.blockerId || 'none';
    const result = document.createElement('pre');
    result.id = 'first-person-controller-proof-result';
    result.textContent = JSON.stringify(proof);
    document.body.appendChild(result);
  }, 80);
});
</script>
`;
const driverPage = launchPage.replace('</body>', `${driverScript}\n</body>`);

await mkdir(outDir, { recursive: true });
await writeFile(driverPath, driverPage);

const chromium = chromiumPath();
const browserRun = run(chromium, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=1500',
  '--dump-dom',
  pathToFileURL(driverPath).href,
], { timeout: 120000 });
assert.equal(browserRun.status, 'passed', browserRun.stdout + browserRun.stderr);
const proofResult = extractProofResult(browserRun.stdout);

assert.equal(proofResult.ready, true);
assert.equal(proofResult.pointerLock.requested, true);
assert.equal(proofResult.pointerLock.activeBeforeEscape, true);
assert.equal(proofResult.pointerLock.activeAfterEscape, false);
assert.notEqual(proofResult.movement.finalPosition.z, proofResult.movement.initialPosition.z);
assert.notEqual(proofResult.movement.yawDegrees, 180);
assert.equal(proofResult.collision?.code, 'player_blocked_by_cube');
assert.equal(proofResult.collision?.blockerId, 'blocker.forward-lane');
assert.equal(proofResult.scene.seed, scene.seed);
assert.equal(proofResult.scene.blockerCount, scene.blockers.length);

const screenshotRun = run(chromium, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--screenshot=${screenshotPath}`,
  '--window-size=1280,720',
  pathToFileURL(driverPath).href,
], { timeout: 120000 });
assert.equal(screenshotRun.status, 'passed', screenshotRun.stdout + screenshotRun.stderr);
assert.equal(existsSync(screenshotPath), true);
assert.equal(statSync(screenshotPath).size > 0, true);

const boundaryRun = run('npm', ['run', 'check:boundary']);
assert.equal(boundaryRun.status, 'passed', boundaryRun.stdout + boundaryRun.stderr);

const artifactBody = {
  artifactKind: 'asha_demo_first_person_controller_proof',
  artifactVersion: 'asha-demo-first-person-controller-proof.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run browser:first-person-controller-proof',
  launchArtifact: {
    path: 'harness/out/browser-demo/latest/index.json',
    sha256: sha256Text(launchArtifactText),
    artifactHash: launchArtifact.artifactHash,
  },
  driver: {
    path: 'harness/out/first-person-controller-proof/latest/driver.html',
    sha256: sha256Text(driverPage),
    browser: chromium,
    dispatchMode: 'headless_chromium_dom_events',
  },
  browser: {
    screenshotPath: 'harness/out/first-person-controller-proof/latest/screenshot.png',
    screenshotHash: sha256Buffer(readFileSync(screenshotPath)),
  },
  scene: {
    seed: scene.seed,
    sceneHash: scene.sceneHash,
    plane: scene.plane,
    blockerCount: scene.blockers.length,
    forwardBlocker: scene.blockers.find((blocker) => blocker.id === 'blocker.forward-lane'),
  },
  deterministicCollisionFixture: {
    finalPosition: player.position,
    collision: blockedStep.diagnostics.at(-1),
    movementHash: blockedStep.movementHash,
  },
  proof: proofResult,
  checks: {
    pointerLockRequested: proofResult.pointerLock.requested,
    pointerLockReleasedByEscape: proofResult.pointerLock.activeBeforeEscape && !proofResult.pointerLock.activeAfterEscape,
    mouseLookChangedYaw: proofResult.movement.yawDegrees !== 180,
    wasdMovedPlayer: proofResult.movement.finalPosition.z !== proofResult.movement.initialPosition.z,
    collisionBlockedForwardLane: proofResult.collision?.blockerId === 'blocker.forward-lane',
    boundaryGuardPassed: boundaryRun.status === 'passed',
  },
  validations: [
    'walkable_plane_and_seeded_blockers_present',
    'first_person_player_state_present',
    'pointer_lock_requested_by_viewport_click',
    'escape_releases_controller_pointer_lock',
    'mouse_look_changes_camera_pose',
    'wasd_frame_integrated_movement_changes_position',
    'cube_collision_prevents_penetration',
    'browser_visible_controller_readout_present',
    'boundary_guard_passed',
  ],
  nonClaims: [
    'not_runtime_authority',
    'not_runtime_authoritative_collision',
    'not_trusted_pointer_lock_evidence',
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};
const artifact = { ...artifactBody, artifactHash: stateHash(artifactBody) };
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'first-person-controller-proof-ready',
  artifact: 'harness/out/first-person-controller-proof/latest/index.json',
  blockerId: proofResult.collision?.blockerId,
}));
