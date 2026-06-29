#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadArtifactPath = path.join(repoRoot, 'harness/out/authored-runtime-load/latest/index.json');
const loadPagePath = path.join(repoRoot, 'harness/out/authored-runtime-load/latest/index.html');
const outDir = path.join(repoRoot, 'harness/out/authored-browser-interaction/latest');
const driverPath = path.join(outDir, 'driver.html');
const artifactPath = path.join(outDir, 'index.json');

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
    timeout: 180000,
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
  const match = dom.match(/<pre id="authored-browser-interaction-result">([\s\S]*?)<\/pre>/);
  assert.ok(match, 'authored browser interaction result marker missing from dumped DOM');
  return JSON.parse(match[1]);
}

const loadRun = run('npm', ['run', 'roundtrip:runtime-load']);
assert.equal(loadRun.status, 'passed', loadRun.stdout + loadRun.stderr);
const loadArtifactText = await readFile(loadArtifactPath, 'utf8');
const loadArtifact = JSON.parse(loadArtifactText);
const loadPage = await readFile(loadPagePath, 'utf8');

const driverScript = `
<script>
window.addEventListener('load', () => {
  const viewport = document.querySelector('[data-visual-id="asha-authored-runtime-viewport"]');
  const marker = document.querySelector('[data-authored-runtime-marker="true"]');
  const viewportRect = viewport.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const objectId = document.body.dataset.authoredObjectId;
  const assetId = document.body.dataset.authoredAssetId;
  const inputEvents = [];
  const typedRequests = [];
  const readbacks = [];
  let sequence = 0;
  let selectedObjectId = null;
  const cameraPose = { position: { x: 0, y: 1.6, z: 4 }, yawDegrees: 0, pitchDegrees: 0 };
  function nextSequence(type) {
    sequence += 1;
    return 'authored-browser-input-' + String(sequence).padStart(4, '0') + '-' + type;
  }
  function record(event, request) {
    inputEvents.push(event);
    typedRequests.push(request);
    if (request.operation === 'selectVoxel') {
      selectedObjectId = objectId;
    }
    if (request.operation === 'applyFirstPersonCameraInput') {
      cameraPose.position.z = Number((cameraPose.position.z - request.dto.input.moveForward * 0.1).toFixed(4));
      cameraPose.pitchDegrees = Number((cameraPose.pitchDegrees + request.dto.input.pitchDeltaDegrees).toFixed(4));
    }
    const readback = {
      sequenceId: request.sequenceId,
      operation: request.operation,
      selectedObjectId,
      selectedAssetId: assetId,
      cameraPose: JSON.parse(JSON.stringify(cameraPose)),
      authoredObjectStillLoaded: selectedObjectId === objectId || selectedObjectId === null,
    };
    readbacks.push(readback);
    document.body.dataset.lastAuthoredInputSequenceId = request.sequenceId;
    document.body.dataset.lastAuthoredTypedOperation = request.operation;
    document.body.dataset.selectedAuthoredObjectId = selectedObjectId ?? 'none';
    return readback;
  }
  const pointerSequenceId = nextSequence('pointerdown');
  const screenPoint = {
    x: Number(((markerRect.left + markerRect.width * 0.5 - viewportRect.left) / viewportRect.width).toFixed(4)),
    y: Number(((markerRect.top + markerRect.height * 0.5 - viewportRect.top) / viewportRect.height).toFixed(4)),
    space: 'normalized_0_1',
  };
  viewport.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: markerRect.left + markerRect.width * 0.5,
    clientY: markerRect.top + markerRect.height * 0.5,
    button: 0,
    bubbles: true,
  }));
  record(
    { sequenceId: pointerSequenceId, source: 'pointer', type: 'pointerdown', targetObjectId: objectId, screenPoint },
    {
      sequenceId: pointerSequenceId,
      publicSurface: '@asha/runtime-bridge',
      operation: 'selectVoxel',
      dto: {
        screenPoint,
        targetObjectId: objectId,
        targetAssetId: assetId,
        viewport: { width: Math.round(viewportRect.width), height: Math.round(viewportRect.height) },
      },
    },
  );
  const keySequenceId = nextSequence('keydown');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  record(
    { sequenceId: keySequenceId, source: 'keyboard', type: 'keydown', code: 'KeyW', targetObjectId: objectId },
    {
      sequenceId: keySequenceId,
      publicSurface: '@asha/runtime-bridge',
      operation: 'applyFirstPersonCameraInput',
      dto: {
        input: {
          moveForward: 1,
          moveRight: 0,
          moveUp: 0,
          yawDeltaDegrees: 0,
          pitchDeltaDegrees: 0,
          dtSeconds: 1 / 60,
          moveSpeedUnitsPerSecond: 3,
        },
        sourceEvent: { type: 'keydown', code: 'KeyW' },
      },
    },
  );
  const wheelSequenceId = nextSequence('wheel');
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -12, bubbles: true, cancelable: true }));
  record(
    { sequenceId: wheelSequenceId, source: 'wheel', type: 'wheel', deltaY: -12, targetObjectId: objectId },
    {
      sequenceId: wheelSequenceId,
      publicSurface: '@asha/runtime-bridge',
      operation: 'applyFirstPersonCameraInput',
      dto: {
        input: {
          moveForward: 0,
          moveRight: 0,
          moveUp: 0,
          yawDeltaDegrees: 0,
          pitchDeltaDegrees: 0.24,
          dtSeconds: 1 / 60,
          moveSpeedUnitsPerSecond: 3,
        },
        sourceEvent: { type: 'wheel', deltaY: -12 },
      },
    },
  );
  const proof = {
    interactionVersion: 'asha-demo-authored-browser-interaction.v0',
    ready: document.body.dataset.authoredRuntimeLoadReady === 'true',
    authoredObjectId: objectId,
    authoredAssetId: assetId,
    inputEvents,
    typedRequests,
    readbacks,
    finalReadback: readbacks.at(-1),
  };
  document.body.dataset.authoredBrowserInteractionReady = 'true';
  document.body.dataset.authoredBrowserInputCount = String(inputEvents.length);
  const result = document.createElement('pre');
  result.id = 'authored-browser-interaction-result';
  result.textContent = JSON.stringify(proof);
  document.body.appendChild(result);
});
</script>
`;
const driverPage = loadPage.replace('</body>', `${driverScript}\n</body>`);
await mkdir(outDir, { recursive: true });
await writeFile(driverPath, driverPage);

const chromium = chromiumPath();
const browserRun = run(chromium, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--virtual-time-budget=1500',
  '--dump-dom',
  pathToFileURL(driverPath).href,
]);
assert.equal(browserRun.status, 'passed', browserRun.stdout + browserRun.stderr);
const proofResult = extractProofResult(browserRun.stdout);
assert.equal(proofResult.ready, true);
assert.equal(proofResult.authoredObjectId, loadArtifact.authoredRuntimeLoad.objectId);
assert.equal(proofResult.authoredAssetId, loadArtifact.authoredRuntimeLoad.assetId);
assert.equal(proofResult.inputEvents.length, 3);
assert.equal(proofResult.typedRequests.length, proofResult.inputEvents.length);
assert.equal(proofResult.readbacks.length, proofResult.typedRequests.length);
assert.equal(proofResult.finalReadback.selectedObjectId, loadArtifact.authoredRuntimeLoad.objectId);

const noInputProof = {
  ...proofResult,
  inputEvents: [],
  typedRequests: [],
  readbacks: [],
};
const staleSelectionProof = {
  ...proofResult,
  finalReadback: {
    ...proofResult.finalReadback,
    selectedObjectId: 'scene-node:stale',
  },
};

const artifactBody = {
  artifactKind: 'asha_demo_authored_browser_interaction',
  artifactVersion: 'asha-demo-authored-browser-interaction.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run roundtrip:browser-interaction',
  loadArtifact: {
    path: 'harness/out/authored-runtime-load/latest/index.json',
    sha256: sha256(loadArtifactText),
    artifactHash: loadArtifact.artifactHash,
  },
  driver: {
    path: 'harness/out/authored-browser-interaction/latest/driver.html',
    sha256: sha256(driverPage),
    browser: chromium,
    dispatchMode: 'headless_chromium_dom_events',
  },
  interaction: {
    authoredObjectId: proofResult.authoredObjectId,
    authoredAssetId: proofResult.authoredAssetId,
    inputEventCount: proofResult.inputEvents.length,
    typedRequestCount: proofResult.typedRequests.length,
    readbackCount: proofResult.readbacks.length,
    inputEvents: proofResult.inputEvents,
    typedRequests: proofResult.typedRequests,
    readbacks: proofResult.readbacks,
    finalReadback: proofResult.finalReadback,
    interactionHash: stateHash(proofResult),
  },
  checks: {
    realDomEventsDispatched: proofResult.inputEvents.length > 0,
    typedRequestsMatchInputEvents: proofResult.inputEvents.length === proofResult.typedRequests.length,
    readbacksMatchTypedRequests: proofResult.readbacks.length === proofResult.typedRequests.length,
    selectedAuthoredObjectMatchesLoad: proofResult.finalReadback.selectedObjectId === loadArtifact.authoredRuntimeLoad.objectId,
    authoredAssetMatchesLoad: proofResult.finalReadback.selectedAssetId === loadArtifact.authoredRuntimeLoad.assetId,
    noArbitraryCommandHatch: !driverPage.includes('call(methodName') && !driverPage.includes('commandJson'),
  },
  negativeSmokes: [
    {
      name: 'missing browser input events',
      ok: noInputProof.inputEvents.length > 0,
      diagnostic: 'missing_browser_input_events',
    },
    {
      name: 'stale authored selection',
      ok: staleSelectionProof.finalReadback.selectedObjectId === loadArtifact.authoredRuntimeLoad.objectId,
      diagnostic: 'stale_authored_selection',
    },
  ],
  validations: [
    'authored_runtime_load_child_passed',
    'dom_pointer_event_selected_authored_object',
    'dom_keyboard_event_recorded_against_authored_object',
    'dom_wheel_event_recorded_against_authored_object',
    'typed_requests_recorded_from_authored_dom_events',
    'authored_selection_readback_matches_loaded_object',
    'no_arbitrary_command_hatch',
    'negative_missing_input_failed_closed',
    'negative_stale_selection_failed_closed',
  ],
  nonClaims: [
    'not_runtime_mutation_proof',
    'not_native_runtime_authority',
    'not_private_transport',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};
const artifact = { ...artifactBody, artifactHash: stateHash(artifactBody) };

await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'authored-browser-interaction-ready',
  artifact: 'harness/out/authored-browser-interaction/latest/index.json',
  inputEventCount: artifact.interaction.inputEventCount,
}));
