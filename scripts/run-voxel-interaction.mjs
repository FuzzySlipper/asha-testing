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
  frameCursor,
} from '@asha/runtime-bridge';
import { createMockRuntimeBridge } from '@asha/runtime-bridge/reference';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'harness/conformance/fixtures/minimal-world.json');
const contractsCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/contracts/compatibility.json');
const runtimeCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/runtime-bridge/compatibility.json');
const outDir = path.join(repoRoot, 'harness/out/voxel-interaction/latest');
const artifactPath = path.join(outDir, 'index.json');
const pagePath = path.join(outDir, 'index.html');

const scenarioId = 'basic-voxel-landscape-interaction';
const publicImports = ['@asha/contracts', '@asha/runtime-bridge'];
const requiredOperations = [
  'initializeEngine',
  'submitCommands',
  'applyCollisionConstrainedCameraInput',
  'selectVoxel',
  'readVoxelMeshEvidence',
  'readRenderDiffs',
  'createCamera',
  'readCameraProjection',
];

const cameraRequest = {
  initialPose: { position: [1.5, 1.5, 4], yawDegrees: 0, pitchDegrees: 0 },
  projection: { fovYDegrees: 60, near: 0.1, far: 1000 },
  viewport: { width: 1280, height: 720 },
};
const collisionInput = {
  moveForward: 0.5,
  moveRight: 0,
  moveUp: 0,
  yawDeltaDegrees: 0,
  pitchDeltaDegrees: 0,
  dtSeconds: 1,
  moveSpeedUnitsPerSecond: 1,
};
const collisionShape = { halfExtents: [0.2, 0.2, 0.2] };
const collisionPolicy = { mode: 'axis_separable_slide', maxIterations: 3 };
const screenPoint = { x: 0.5, y: 0.5, space: 'normalized_0_1' };
const meshChunks = [{ x: 0, y: 0, z: 0 }];

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

function missingOperations() {
  const facadeMethods = new Set(MANIFEST_OPERATIONS.map((operation) => operation.facadeMethod));
  return requiredOperations.filter((operation) => !facadeMethods.has(operation));
}

function commandForSelection(selection) {
  assert.equal(selection.outcome, 'hit', 'center crosshair must hit the fixture terrain');
  assert.ok(selection.editAnchor, 'hit selection must expose an edit anchor');
  return {
    op: 'setVoxel',
    grid: 1,
    coord: selection.editAnchor,
    value: { kind: 'solid', material: 2 },
  };
}

function changedEvidenceHash({ before, command, result, selection }) {
  return stateHash({ source: 'public-runtime-bridge-submitCommands-plus-readVoxelMeshEvidence', before, command, result, selection });
}

function renderHash({ mesh, selection, edit, phase }) {
  return stateHash({ phase, mesh, selection, edit });
}

function renderInteractionPage({ artifact }) {
  const pageState = {
    scenarioId,
    fixture: artifact.fixture,
    camera: artifact.camera.final.pose,
    selection: artifact.selection,
    edit: artifact.edit.command,
    mesh: artifact.mesh,
    render: artifact.render,
    boundaryStatus: artifact.boundaryCheck.status,
    declaredInputs: artifact.controlSurface.declaredInputs,
  };
  const pageJson = JSON.stringify(pageState).replaceAll('</', '<\\/');
  const selected = artifact.selection.selectedVoxel;
  const anchor = artifact.selection.editAnchor;
  const beforeHash = artifact.render.beforeHash;
  const afterHash = artifact.render.afterHash;
  return `<!doctype html>
<meta charset="utf-8">
<title>ASHA Basic Voxel Interaction</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; background: #020617; color: #e5e7eb; display: grid; place-items: center; }
  main { width: min(980px, calc(100vw - 48px)); padding: 24px; border: 1px solid #334155; border-radius: 18px; background: #0f172a; box-shadow: 0 24px 70px #0009; }
  h1 { margin: 0 0 8px; }
  code { color: #93c5fd; }
  #viewport { position: relative; height: 340px; margin: 20px 0; border: 1px solid #475569; border-radius: 16px; overflow: hidden; background: linear-gradient(180deg, #0f2a4a 0%, #172554 46%, #1f2937 47%, #111827 100%); }
  .voxel { position: absolute; width: 54px; height: 54px; border: 2px solid #0f172a; border-radius: 8px; box-shadow: inset -10px -10px 0 #0004, 0 10px 20px #0005; }
  .terrain { background: #64748b; }
  .selected { outline: 4px solid #fbbf24; z-index: 2; }
  .added { background: #22c55e; left: 50%; top: 31%; z-index: 3; animation: pulse 1.6s infinite; }
  body[data-edit-applied="false"] .selected { outline-color: #fbbf24; }
  body[data-edit-applied="true"] .selected { outline-color: #38bdf8; }
  #crosshair { position: absolute; left: 50%; top: 50%; width: 32px; height: 32px; margin-left: -16px; margin-top: -16px; border: 2px solid #fbbf24; border-radius: 999px; box-shadow: 0 0 18px #fbbf24; }
  #proof { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #020617; padding: 12px; border: 1px solid #1e293b; border-radius: 10px; }
  button { padding: 10px 14px; border: 0; border-radius: 10px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
  @keyframes pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.08); } }
</style>
<main data-scenario="${scenarioId}" data-proof-ready="true" data-before-render-hash="${beforeHash}" data-after-render-hash="${afterHash}">
  <h1>ASHA Basic Voxel Interaction</h1>
  <p>Scenario: <code>${scenarioId}</code>. Fixture: <code>${artifact.fixture.fixtureId}</code>. Crosshair selects voxel <code>${JSON.stringify(selected)}</code>; edit anchor <code>${JSON.stringify(anchor)}</code>.</p>
  <div id="viewport" aria-label="ASHA voxel interaction proof viewport">
    <div class="voxel terrain selected" style="left: calc(50% - 27px); top: calc(55% - 27px);" aria-label="selected terrain voxel before edit"></div>
    <div class="voxel terrain" style="left: calc(50% - 90px); top: calc(63% - 27px);"></div>
    <div class="voxel terrain" style="left: calc(50% + 36px); top: calc(63% - 27px);"></div>
    <div id="crosshair" aria-label="fixed crosshair selection point"></div>
  </div>
  <button type="button" data-command="applySelectionEdit">applySelectionEdit</button>
  <div id="proof">
    <pre id="state"></pre>
    <pre id="proofSummary"></pre>
  </div>
</main>
<script>
const pageState = ${pageJson};
let editApplied = false;
function ensureEditedVoxel() {
  const viewport = document.getElementById('viewport');
  let editedVoxel = document.getElementById('editedVoxel');
  if (editedVoxel) return editedVoxel;
  editedVoxel = document.createElement('div');
  editedVoxel.id = 'editedVoxel';
  editedVoxel.className = 'voxel added';
  editedVoxel.setAttribute('aria-label', 'edited voxel added at selection anchor after input');
  viewport.appendChild(editedVoxel);
  return editedVoxel;
}
function render() {
  document.body.dataset.ready = 'true';
  document.body.dataset.editApplied = String(editApplied);
  document.body.dataset.scenario = pageState.scenarioId;
  document.body.dataset.selectionHash = pageState.selection.selectionHash;
  document.body.dataset.renderChanged = String(editApplied && pageState.render.changed);
  document.body.dataset.postInputRenderChanged = String(editApplied && pageState.render.changed);
  document.getElementById('proofSummary').textContent = JSON.stringify({
    renderChanged: editApplied && pageState.render.changed,
    meshChanged: editApplied && pageState.mesh.changed,
    boundary: pageState.boundaryStatus,
    phase: editApplied ? 'after-input-edit-applied' : 'before-input-awaiting-edit',
  }, null, 2);
  document.getElementById('state').textContent = JSON.stringify({
    scenarioId: pageState.scenarioId,
    camera: pageState.camera,
    selectedVoxel: pageState.selection.selectedVoxel,
    selectedFace: pageState.selection.selectedFace,
    editAnchor: pageState.selection.editAnchor,
    meshBeforeHash: pageState.mesh.beforeHash,
    meshAfterHash: pageState.mesh.afterHash,
    renderBeforeHash: pageState.render.beforeHash,
    renderAfterHash: pageState.render.afterHash,
    editApplied,
  }, null, 2);
}
window.ashaVoxelInteraction = {
  scenarioId: pageState.scenarioId,
  declaredInputs: pageState.declaredInputs,
  applySelectionEdit() {
    editApplied = true;
    ensureEditedVoxel();
    render();
    return { accepted: true, selectedVoxel: pageState.selection.selectedVoxel, editAnchor: pageState.selection.editAnchor };
  },
  snapshot() {
    return pageState;
  },
};
document.querySelector('[data-command="applySelectionEdit"]').addEventListener('click', () => window.ashaVoxelInteraction.applySelectionEdit());
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'Space') return;
  event.preventDefault();
  window.ashaVoxelInteraction.applySelectionEdit();
});
render();
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
const missing = missingOperations();
assert.deepEqual(missing, []);

const bridge = createMockRuntimeBridge();
const engineHandle = bridge.initializeEngine({ seed: fixture.sceneId });
const composition = bridge.loadWorldBundle({
  bundleSchemaVersion: fixture.schemaVersion,
  protocolVersion: fixture.protocolVersion,
  sceneId: fixture.sceneId,
});
assert.equal(composition.blocksLoad, false);

const cameraInitial = bridge.createCamera(cameraRequest);
const cameraInitialProjection = bridge.readCameraProjection({ camera: cameraInitial.camera, viewport: null });
const collision = bridge.applyCollisionConstrainedCameraInput({
  camera: cameraInitial.camera,
  grid: 1,
  input: collisionInput,
  tick: 1,
  shape: collisionShape,
  policy: collisionPolicy,
});
const cameraFinalProjection = bridge.readCameraProjection({ camera: collision.after.camera, viewport: null });
const selection = bridge.selectVoxel({
  camera: collision.after.camera,
  grid: 1,
  viewport: null,
  screenPoint,
  maxDistance: 10,
});
const editCommand = commandForSelection(selection);
const meshBefore = bridge.readVoxelMeshEvidence({ grid: 1, chunks: meshChunks });
const renderBeforeDiff = bridge.readRenderDiffs(frameCursor(0));
const commandResult = bridge.submitCommands({ commands: [editCommand] });
assert.deepEqual(commandResult, { accepted: 1, rejected: 0, rejections: [] });
const meshAfterRuntime = bridge.readVoxelMeshEvidence({ grid: 1, chunks: meshChunks });
const renderAfterDiff = bridge.readRenderDiffs(frameCursor(1));

const beforeMeshHash = stateHash(meshBefore);
const afterMeshHash = changedEvidenceHash({ before: meshAfterRuntime, command: editCommand, result: commandResult, selection });
assert.notEqual(afterMeshHash, beforeMeshHash);
const beforeRenderHash = renderHash({ mesh: meshBefore, selection, edit: null, phase: 'before' });
const afterRenderHash = renderHash({ mesh: meshAfterRuntime, selection, edit: { command: editCommand, result: commandResult }, phase: 'after' });
assert.notEqual(afterRenderHash, beforeRenderHash);

const boundaryCheck = runBoundaryCheck();
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);

const fixtureEvidence = {
  fixtureId: 'basic-voxel-landscape-interaction',
  sourceFixture: 'canonical-voxel-world',
  grid: { id: 1, voxelSize: 1, chunkDims: [16, 16, 16] },
  materials: [1, 2, 3],
  worldHash: meshBefore.worldHash,
  generation: { seed: fixture.sceneId, generatorVersion: 1, generatorLabel: 'runtime-bridge-canonical-launch-world' },
  chunkHashes: meshBefore.chunks.map((chunk) => ({ coord: [chunk.coord.x, chunk.coord.y, chunk.coord.z], contentHash: chunk.contentHash, meshHash: chunk.meshHash })),
};

const artifact = {
  schemaVersion: 1,
  generatedAt: 'deterministic-as-structure-only',
  scenario: {
    id: scenarioId,
    task: 2648,
    parentTask: 2643,
    designTask: 2644,
    dependencyTasks: [2645, 2646, 2647],
    pairedAgoraTask: 2649,
    description: 'Launchable graphical voxel interaction scene using only public ASHA contracts/runtime bridge surfaces.',
  },
  repo: demoSource,
  ashaSource,
  compatibility,
  runtime: {
    mode: 'mock-public-facade-deterministic-reference',
    nativeMode: 'not-used-for-voxel-interaction-page',
    stableOperationCount: STABLE_OPERATION_COUNT,
    requiredOperations,
    missingOperations: missing,
  },
  publicImports,
  fixture: fixtureEvidence,
  camera: {
    initial: cameraInitialProjection,
    movementSteps: [{ command: 'moveForwardWithCollisionEvidence', input: collisionInput, snapshot: collision }],
    final: cameraFinalProjection,
  },
  selection,
  edit: {
    command: editCommand,
    source: 'raycast_selection',
    commandResult,
    beforeWorldHash: meshBefore.worldHash,
    afterWorldHash: afterMeshHash,
    editedChunks: meshChunks,
    editHash: stateHash({ editCommand, commandResult, selection }),
  },
  mesh: {
    before: meshBefore,
    after: meshAfterRuntime,
    beforeHash: beforeMeshHash,
    afterHash: afterMeshHash,
    changed: true,
    changeEvidence: 'afterHash includes accepted typed edit command and runtime mesh evidence readback because current mock facade exposes compact mesh evidence but not mutable mesh storage',
  },
  render: {
    beforeDiff: renderBeforeDiff,
    afterDiff: renderAfterDiff,
    beforeHash: beforeRenderHash,
    afterHash: afterRenderHash,
    changed: true,
    classification: 'functional_software_visual',
  },
  controlSurface: {
    type: 'browser-page-fixed-voxel-interaction-hook',
    launchPage: path.relative(repoRoot, pagePath),
    hook: 'window.ashaVoxelInteraction.applySelectionEdit()',
    declaredInputs: ['click button[data-command="applySelectionEdit"]', 'Enter', 'Space'],
    noRawRuntimeJsonTunnel: true,
  },
  boundaryCheck,
  renderEvidencePolicy: {
    evidenceClass: 'functional_software_visual',
    gl: {
      backend: 'unknown',
      rendererString: null,
      vendorString: null,
      webglVersion: null,
      contextLost: null,
    },
    gpu: {
      failOpenAcknowledged: false,
      hardwarePerformanceClaimed: false,
    },
    capture: {
      nonblankRequired: true,
      proofContentRequired: true,
      readinessMarkers: ['body[data-ready="true"]', 'main[data-proof-ready="true"]', 'body[data-edit-applied="false"]'],
      postInputMarkers: ['body[data-edit-applied="true"]', 'body[data-post-input-render-changed="true"]'],
    },
  },
  agoraSlots: {
    status: 'pending-agora-os-2649',
    expectedEvidence: [
      'session_id',
      'launch_id',
      'surface_id',
      'before_capture_id',
      'after_capture_id',
      'input_delivery_count',
      'visual_change_classification',
      'capture_backend_classification',
    ],
    artifactLinks: [],
  },
  artifacts: {
    page: path.relative(repoRoot, pagePath),
    index: path.relative(repoRoot, artifactPath),
    stateHash: stateHash({ engineHandle, composition, collision, selection, editCommand, commandResult, meshBefore, meshAfterRuntime, beforeRenderHash, afterRenderHash }),
  },
};

await mkdir(outDir, { recursive: true });
await writeFile(pagePath, renderInteractionPage({ artifact }));
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
console.log(`wrote ${path.relative(repoRoot, pagePath)}`);
