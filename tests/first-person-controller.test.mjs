import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  applyMouseLook,
  createFirstPersonPlayerState,
  createWalkableControllerScene,
  integrateFirstPersonMovement,
} from '../scripts/first-person-controller.mjs';

const repoRoot = new URL('..', import.meta.url);

test('first-person controller scene has deterministic walkable blockers', () => {
  const scene = createWalkableControllerScene();
  const repeat = createWalkableControllerScene();

  assert.equal(scene.seed, 'asha-demo-m4-walkable-blockers-v0');
  assert.equal(scene.sceneHash, repeat.sceneHash);
  assert.equal(scene.plane.halfExtents.x, 24);
  assert.equal(scene.blockers.length, 18);
  assert.equal(scene.blockers[0].id, 'blocker.forward-lane');
});

test('first-person movement integrates WASD and blocks cube penetration', () => {
  const scene = createWalkableControllerScene();
  let player = createFirstPersonPlayerState();
  let blocked = null;

  for (let index = 0; index < 45; index += 1) {
    const step = integrateFirstPersonMovement(scene, player, {
      moveForward: 1,
      moveRight: 0,
      moveSpeedUnitsPerSecond: 3.2,
    }, 1 / 60);
    player = step.player;
    if (step.diagnostics.length > 0) {
      blocked = step;
      break;
    }
  }

  assert.ok(blocked);
  assert.equal(blocked.diagnostics[0].code, 'player_blocked_by_cube');
  assert.equal(blocked.diagnostics[0].blockerId, 'blocker.forward-lane');
  assert.equal(player.position.z >= 3.5, true);

  const looked = applyMouseLook(player, 20, -10);
  assert.notEqual(looked.yawDegrees, player.yawDegrees);
  assert.notEqual(looked.pitchDegrees, player.pitchDegrees);
});

test('browser first-person controller proof records pointer lock movement and collision', async () => {
  await rm(new URL('../harness/out/first-person-controller-proof/', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'browser:first-person-controller-proof'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /first-person-controller-proof-ready/);

  const artifact = JSON.parse(await readFile(
    new URL('../harness/out/first-person-controller-proof/latest/index.json', import.meta.url),
    'utf8',
  ));
  assert.equal(artifact.artifactKind, 'asha_demo_first_person_controller_proof');
  assert.equal(artifact.checks.pointerLockRequested, true);
  assert.equal(artifact.checks.pointerLockReleasedByEscape, true);
  assert.equal(artifact.checks.mouseLookChangedYaw, true);
  assert.equal(artifact.checks.wasdMovedPlayer, true);
  assert.equal(artifact.checks.collisionBlockedForwardLane, true);
  assert.ok(artifact.validations.includes('cube_collision_prevents_penetration'));
  assert.ok(artifact.nonClaims.includes('not_runtime_authoritative_collision'));
});
