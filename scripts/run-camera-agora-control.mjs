#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '@asha/contracts';
import {
  MANIFEST_OPERATIONS,
  STABLE_OPERATION_COUNT,
} from '@asha/runtime-bridge';
import { createMockRuntimeBridge } from '@asha/runtime-bridge/reference';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'harness/conformance/fixtures/minimal-world.json');
const contractsCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/contracts/compatibility.json');
const runtimeCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/runtime-bridge/compatibility.json');
const outDir = path.join(repoRoot, 'harness/out/camera-agora-control/latest');
const artifactPath = path.join(outDir, 'index.json');
const pagePath = path.join(outDir, 'index.html');

const scenarioId = 'first-person-agora-control-basic';
const requiredCameraOperations = [
  'createCamera',
  'applyFirstPersonCameraInput',
  'readCameraProjection',
];
const publicImports = ['@asha/contracts', '@asha/runtime-bridge'];

const initialCamera = {
  initialPose: { position: [0, 1.6, 0], yawDegrees: 0, pitchDegrees: 0 },
  projection: { fovYDegrees: 60, near: 0.1, far: 1000 },
  viewport: { width: 1280, height: 720 },
};

const commandInputs = {
  moveForward: {
    moveForward: 1,
    moveRight: 0,
    moveUp: 0,
    yawDeltaDegrees: 0,
    pitchDeltaDegrees: 0,
    dtSeconds: 1 / 60,
    moveSpeedUnitsPerSecond: 3,
  },
  lookRight: {
    moveForward: 0,
    moveRight: 0,
    moveUp: 0,
    yawDeltaDegrees: 20,
    pitchDeltaDegrees: 0,
    dtSeconds: 1 / 60,
    moveSpeedUnitsPerSecond: 3,
  },
  lookDown: {
    moveForward: 0,
    moveRight: 0,
    moveUp: 0,
    yawDeltaDegrees: 0,
    pitchDeltaDegrees: -10,
    dtSeconds: 1 / 60,
    moveSpeedUnitsPerSecond: 3,
  },
};

const agentCommandSequence = [
  { order: 1, command: 'moveForward', intent: 'agent moves camera forward along current forward vector' },
  { order: 2, command: 'lookRight', intent: 'agent yaws camera right' },
  { order: 3, command: 'lookDown', intent: 'agent pitches camera down' },
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stateHash(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    timeout: options.timeout ?? 15000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function runBoundaryCheck() {
  return run('npm', ['run', 'check:boundary']);
}

function gitOutput(cwd, args) {
  const result = run('git', args, { cwd });
  assert.equal(result.status, 'passed', `${result.command}\n${result.stderr}`);
  return result.stdout;
}

function readSource(root, name) {
  return {
    name,
    path: root,
    branch: gitOutput(root, ['branch', '--show-current']),
    commit: gitOutput(root, ['rev-parse', 'HEAD']),
  };
}

async function readCompatibility(filePath) {
  const metadata = JSON.parse(await readFile(filePath, 'utf8'));
  return {
    surface: metadata.surface,
    compatibilityVersion: metadata.compatibilityVersion,
    packageVersion: metadata.packageVersion,
  };
}

function missingCameraOperations() {
  const facadeMethods = new Set(MANIFEST_OPERATIONS.map((operation) => operation.facadeMethod));
  return requiredCameraOperations.filter((operation) => !facadeMethods.has(operation));
}

function renderControlPage({ artifact }) {
  const controlState = {
    scenarioId,
    initial: artifact.cameraEvidence.initial,
    steps: artifact.cameraEvidence.steps,
    final: artifact.cameraEvidence.final,
    allowedCommands: artifact.controlSurface.allowedCommands,
  };
  const stateJson = JSON.stringify(controlState).replaceAll('</', '<\\/');
  return `<!doctype html>
<meta charset="utf-8">
<title>ASHA First-Person Agora Control</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #0f172a; color: #f8fafc; display: grid; min-height: 100vh; place-items: center; }
  main { width: min(920px, calc(100vw - 48px)); padding: 24px; border: 1px solid #334155; border-radius: 16px; background: #111827; box-shadow: 0 24px 60px #0008; }
  h1 { margin-top: 0; font-size: 28px; }
  code { color: #93c5fd; }
  button { margin: 4px 8px 4px 0; padding: 10px 14px; border: 0; border-radius: 10px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
  button:focus { outline: 3px solid #93c5fd; }
  #viewport { margin: 18px 0; height: 220px; border-radius: 14px; border: 1px solid #475569; background: linear-gradient(160deg, #1e293b, #172554); position: relative; overflow: hidden; }
  #reticle { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin-left: -9px; margin-top: -9px; border: 2px solid #fbbf24; border-radius: 999px; transform-origin: 50% 50%; }
  #horizon { position: absolute; inset: 50% -20% auto -20%; height: 3px; background: #38bdf8; transform-origin: 50% 50%; }
  #cameraDot { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin-left: -8px; margin-top: -8px; border-radius: 999px; background: #34d399; box-shadow: 0 0 24px #34d399; }
  pre { white-space: pre-wrap; background: #020617; padding: 12px; border-radius: 10px; border: 1px solid #1f2937; }
</style>
<main data-scenario="${scenarioId}">
  <h1>ASHA First-Person Agora Control</h1>
  <p>Public control hook: <code>window.ashaAgoraControl.applyCommand(name)</code></p>
  <p>Scenario: <code>${scenarioId}</code></p>
  <div id="viewport" aria-label="ASHA camera evidence viewport">
    <div id="horizon"></div>
    <div id="cameraDot"></div>
    <div id="reticle"></div>
  </div>
  <div id="controls" aria-label="Agent control commands">
    ${controlState.allowedCommands.map((command) => `<button type="button" data-command="${command}">${command}</button>`).join('\n    ')}
  </div>
  <pre id="state"></pre>
</main>
<script>
const controlState = ${stateJson};
let currentIndex = 0;
const stateEl = document.getElementById('state');
const dotEl = document.getElementById('cameraDot');
const horizonEl = document.getElementById('horizon');
const reticleEl = document.getElementById('reticle');

function snapshotForIndex(index) {
  if (index <= 0) return controlState.initial;
  return controlState.steps[Math.min(index - 1, controlState.steps.length - 1)].after;
}

function render() {
  const snapshot = snapshotForIndex(currentIndex);
  const pose = snapshot.pose;
  const x = Math.max(-160, Math.min(160, pose.position[0] * 200));
  const z = Math.max(-90, Math.min(90, -pose.position[2] * 160));
  dotEl.style.transform = 'translate(' + x + 'px, ' + z + 'px)';
  horizonEl.style.transform = 'rotate(' + (-pose.pitchDegrees) + 'deg)';
  reticleEl.style.transform = 'rotate(' + pose.yawDegrees + 'deg)';
  stateEl.textContent = JSON.stringify({
    scenarioId: controlState.scenarioId,
    step: currentIndex,
    pose,
    projectionHash: snapshot.projectionHash,
    availableCommands: controlState.allowedCommands,
  }, null, 2);
  document.body.dataset.step = String(currentIndex);
  document.body.dataset.projectionHash = snapshot.projectionHash;
}

window.ashaAgoraControl = {
  scenarioId: controlState.scenarioId,
  allowedCommands: controlState.allowedCommands,
  applyCommand(command) {
    const next = controlState.steps[currentIndex];
    if (!next || next.command !== command) {
      throw new Error('Unexpected command ' + command + ' at step ' + currentIndex);
    }
    currentIndex += 1;
    render();
    return snapshotForIndex(currentIndex);
  },
  reset() {
    currentIndex = 0;
    render();
    return snapshotForIndex(currentIndex);
  },
  snapshot() {
    return snapshotForIndex(currentIndex);
  },
};

for (const button of document.querySelectorAll('button[data-command]')) {
  button.addEventListener('click', () => window.ashaAgoraControl.applyCommand(button.dataset.command));
}

window.addEventListener('keydown', (event) => {
  const byKey = { KeyW: 'moveForward', ArrowRight: 'lookRight', ArrowDown: 'lookDown' };
  const command = byKey[event.code];
  if (!command) return;
  event.preventDefault();
  window.ashaAgoraControl.applyCommand(command);
});

render();
document.body.dataset.ready = 'true';
</script>
`;
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const ashaSource = readSource(path.resolve(repoRoot, '../asha-engine'), 'asha');
const demoSource = readSource(repoRoot, 'asha-testing');
const compatibility = {
  contracts: await readCompatibility(contractsCompatibilityPath),
  runtimeBridge: await readCompatibility(runtimeCompatibilityPath),
};
const missingOperations = missingCameraOperations();
assert.deepEqual(missingOperations, []);

const bridge = createMockRuntimeBridge();
const engineHandle = bridge.initializeEngine({ seed: fixture.sceneId });
const composition = bridge.loadWorldBundle({
  bundleSchemaVersion: fixture.schemaVersion,
  protocolVersion: fixture.protocolVersion,
  sceneId: fixture.sceneId,
});
assert.equal(composition.blocksLoad, false);

const initialSnapshot = bridge.createCamera(initialCamera);
const initialProjection = bridge.readCameraProjection({ camera: initialSnapshot.camera, viewport: null });
let currentCamera = initialSnapshot;
const steps = [];
for (const action of agentCommandSequence) {
  const beforeProjection = bridge.readCameraProjection({ camera: currentCamera.camera, viewport: null });
  const afterCamera = bridge.applyFirstPersonCameraInput({
    camera: currentCamera.camera,
    tick: action.order,
    input: commandInputs[action.command],
  });
  const afterProjection = bridge.readCameraProjection({ camera: afterCamera.camera, viewport: null });
  assert.notDeepEqual(afterCamera.pose, currentCamera.pose);
  steps.push({
    ...action,
    publicSurface: '@asha/runtime-bridge',
    input: commandInputs[action.command],
    before: {
      pose: currentCamera.pose,
      projectionHash: beforeProjection.projectionHash,
    },
    after: {
      pose: afterCamera.pose,
      projectionHash: afterProjection.projectionHash,
    },
  });
  currentCamera = afterCamera;
}
const finalProjection = bridge.readCameraProjection({ camera: currentCamera.camera, viewport: null });
const boundaryCheck = runBoundaryCheck();
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);
assert.ok(new Set(agentCommandSequence.map((action) => action.command)).size >= 2);
assert.notDeepEqual(currentCamera.pose, initialSnapshot.pose);
assert.notEqual(finalProjection.projectionHash, initialProjection.projectionHash);

const workflowEvidence = {
  engineHandle,
  fixture,
  compatibility,
  ashaSource,
  demoSource,
  composition,
  initialSnapshot,
  initialProjection,
  steps,
  finalSnapshot: currentCamera,
  finalProjection,
};

const artifact = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
  scenario: {
    name: scenarioId,
    task: 2630,
    parentTask: 2629,
    pairedAgoraTask: 2631,
    description: 'Launchable first-person camera control scenario for Agora using only public ASHA camera runtime operations.',
  },
  repo: demoSource,
  ashaSource,
  compatibility,
  publicImports,
  runtime: {
    mode: 'mock-public-facade-deterministic-reference',
    nativeMode: 'not-used-for-camera-control-page',
    stableOperationCount: STABLE_OPERATION_COUNT,
  },
  controlSurface: {
    type: 'browser-page-fixed-command-hook',
    launchPage: path.relative(repoRoot, pagePath),
    hook: 'window.ashaAgoraControl.applyCommand(commandName)',
    domRoute: {
      buttonsSelector: 'button[data-command]',
      keyboard: { KeyW: 'moveForward', ArrowRight: 'lookRight', ArrowDown: 'lookDown' },
    },
    allowedCommands: agentCommandSequence.map((action) => action.command),
    rejectsUnexpectedCommandOrder: true,
    noRawRuntimeJsonTunnel: true,
  },
  cameraEvidence: {
    status: 'public-first-person-agora-control-produced-projection-evidence',
    publicSurface: '@asha/runtime-bridge',
    missingOperations,
    initial: {
      camera: initialSnapshot.camera,
      pose: initialSnapshot.pose,
      projectionHash: initialProjection.projectionHash,
      projectionSnapshot: initialProjection,
    },
    steps,
    final: {
      camera: currentCamera.camera,
      pose: currentCamera.pose,
      projectionHash: finalProjection.projectionHash,
      projectionSnapshot: finalProjection,
    },
  },
  agoraSlots: {
    status: 'pending-agora-os-2631',
    expectedEvidence: [
      'session_id',
      'launch_id',
      'surface_id',
      'before_capture_id',
      'after_capture_id',
      'visual_change_classification',
    ],
    artifactLinks: [],
  },
  boundaryCheck,
  artifacts: {
    page: path.relative(repoRoot, pagePath),
    stateHash: stateHash(workflowEvidence),
  },
};

await mkdir(outDir, { recursive: true });
await writeFile(pagePath, renderControlPage({ artifact }));
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
console.log(`wrote ${path.relative(repoRoot, pagePath)}`);
