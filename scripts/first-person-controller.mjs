import { createHash } from 'node:crypto';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stateHash(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function seedToUint(seed) {
  const hash = createHash('sha256').update(seed).digest();
  return hash.readUInt32BE(0);
}

function lcg(seed) {
  let state = seedToUint(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function round(value) {
  return Number(value.toFixed(4));
}

export function createWalkableControllerScene(options = {}) {
  const seed = options.seed ?? 'asha-demo-m4-walkable-blockers-v0';
  const random = lcg(seed);
  const plane = {
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 24, z: 24 },
  };
  const cubes = [
    {
      id: 'blocker.forward-lane',
      center: { x: 0, y: 0.75, z: 2.4 },
      halfExtents: { x: 0.75, y: 0.75, z: 0.75 },
    },
  ];
  for (let index = 0; index < 17; index += 1) {
    const x = round((random() * 2 - 1) * 18);
    const z = round((random() * 2 - 1) * 18);
    if (Math.abs(x) < 2.5 && z > 0 && z < 5.5) {
      continue;
    }
    cubes.push({
      id: `blocker.seeded-${String(index).padStart(2, '0')}`,
      center: { x, y: 0.75, z },
      halfExtents: {
        x: round(0.45 + random() * 0.65),
        y: round(0.5 + random() * 1.25),
        z: round(0.45 + random() * 0.65),
      },
    });
  }
  const scene = {
    sceneVersion: 'asha-demo-first-person-collision-scene.v0',
    seed,
    plane,
    blockers: cubes,
  };
  return {
    ...scene,
    sceneHash: stateHash(scene),
  };
}

export function createFirstPersonPlayerState(overrides = {}) {
  const player = {
    controllerVersion: 'asha-demo-first-person-controller.v0',
    position: { x: 0, y: 1.6, z: 4 },
    yawDegrees: 180,
    pitchDegrees: 0,
    velocity: { x: 0, y: 0, z: 0 },
    standingHeight: 1.6,
    collider: { radius: 0.35, height: 1.75 },
    pointerLock: { requested: false, active: false },
    lastCollision: null,
    ...overrides,
  };
  return {
    ...player,
    playerHash: stateHash(player),
  };
}

export function applyMouseLook(player, movementX, movementY, sensitivityDegrees = 0.12) {
  const next = {
    ...player,
    yawDegrees: round(player.yawDegrees + movementX * sensitivityDegrees),
    pitchDegrees: Math.max(-85, Math.min(85, round(player.pitchDegrees - movementY * sensitivityDegrees))),
  };
  return { ...next, playerHash: stateHash(next) };
}

function expandedAabbCollision(x, z, radius, blocker) {
  return (
    x >= blocker.center.x - blocker.halfExtents.x - radius
    && x <= blocker.center.x + blocker.halfExtents.x + radius
    && z >= blocker.center.z - blocker.halfExtents.z - radius
    && z <= blocker.center.z + blocker.halfExtents.z + radius
  );
}

function moveAxis({ scene, player, x, z, axis }) {
  const clamped = {
    x: Math.max(-scene.plane.halfExtents.x + player.collider.radius, Math.min(scene.plane.halfExtents.x - player.collider.radius, x)),
    z: Math.max(-scene.plane.halfExtents.z + player.collider.radius, Math.min(scene.plane.halfExtents.z - player.collider.radius, z)),
  };
  const blocker = scene.blockers.find(candidate =>
    expandedAabbCollision(clamped.x, clamped.z, player.collider.radius, candidate),
  );
  if (blocker === undefined) {
    return { x: clamped.x, z: clamped.z, diagnostic: null };
  }
  return {
    x: axis === 'x' ? player.position.x : clamped.x,
    z: axis === 'z' ? player.position.z : clamped.z,
    diagnostic: {
      code: 'player_blocked_by_cube',
      blockerId: blocker.id,
      axis,
      attemptedPosition: { x: round(clamped.x), z: round(clamped.z) },
      blockerBounds: {
        min: {
          x: round(blocker.center.x - blocker.halfExtents.x),
          y: round(blocker.center.y - blocker.halfExtents.y),
          z: round(blocker.center.z - blocker.halfExtents.z),
        },
        max: {
          x: round(blocker.center.x + blocker.halfExtents.x),
          y: round(blocker.center.y + blocker.halfExtents.y),
          z: round(blocker.center.z + blocker.halfExtents.z),
        },
      },
    },
  };
}

export function integrateFirstPersonMovement(scene, player, input, dtSeconds = 1 / 60) {
  const yaw = player.yawDegrees * Math.PI / 180;
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const moveForward = input.moveForward ?? 0;
  const moveRight = input.moveRight ?? 0;
  const speed = input.moveSpeedUnitsPerSecond ?? 3.2;
  const dx = (forward.x * moveForward + right.x * moveRight) * speed * dtSeconds;
  const dz = (forward.z * moveForward + right.z * moveRight) * speed * dtSeconds;
  const xMove = moveAxis({ scene, player, x: player.position.x + dx, z: player.position.z, axis: 'x' });
  const intermediate = { ...player, position: { ...player.position, x: xMove.x } };
  const zMove = moveAxis({ scene, player: intermediate, x: xMove.x, z: player.position.z + dz, axis: 'z' });
  const diagnostics = [xMove.diagnostic, zMove.diagnostic].filter(Boolean);
  const next = {
    ...player,
    position: { x: round(zMove.x), y: player.standingHeight, z: round(zMove.z) },
    velocity: { x: round(dx / dtSeconds), y: 0, z: round(dz / dtSeconds) },
    lastCollision: diagnostics.at(-1) ?? (Math.abs(dx) > 0 || Math.abs(dz) > 0 ? null : player.lastCollision),
  };
  return {
    player: { ...next, playerHash: stateHash(next) },
    diagnostics,
    movementHash: stateHash({ sceneHash: scene.sceneHash, before: player, input, dtSeconds, after: next, diagnostics }),
  };
}

export function buildControllerReadout(scene, player, extra = {}) {
  const readout = {
    readoutVersion: 'asha-demo-first-person-controller-readout.v0',
    scene: {
      seed: scene.seed,
      sceneHash: scene.sceneHash,
      plane: scene.plane,
      blockerCount: scene.blockers.length,
      blockers: scene.blockers,
    },
    player,
    collision: player.lastCollision,
    nonClaims: [
      'not_runtime_authority',
      'not_native_runtime_authority',
      'not_hardware_gpu_evidence',
      'not_performance_evidence',
    ],
    ...extra,
  };
  return {
    ...readout,
    readoutHash: stateHash(readout),
  };
}
