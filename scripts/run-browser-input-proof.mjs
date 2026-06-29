#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchArtifactPath = path.join(repoRoot, 'harness/out/browser-demo/latest/index.json');
const launchPagePath = path.join(repoRoot, 'harness/out/browser-demo/latest/index.html');
const outDir = path.join(repoRoot, 'harness/out/browser-input-proof/latest');
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
  const match = dom.match(/<pre id="browser-input-proof-result">([\s\S]*?)<\/pre>/);
  assert.ok(match, 'browser input proof result marker missing from dumped DOM');
  return JSON.parse(match[1]);
}

const launchRun = run('npm', ['run', 'browser:demo']);
assert.equal(launchRun.status, 'passed', launchRun.stdout + launchRun.stderr);
const launchArtifactText = await readFile(launchArtifactPath, 'utf8');
const launchArtifact = JSON.parse(launchArtifactText);
const launchPage = await readFile(launchPagePath, 'utf8');

const driverScript = `
<script>
window.addEventListener('load', () => {
  const viewport = document.querySelector('[data-visual-id="asha-demo-browser-viewport"]');
  const rect = viewport.getBoundingClientRect();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
  viewport.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: rect.left + rect.width * 0.5,
    clientY: rect.top + rect.height * 0.5,
    button: 0,
    bubbles: true,
  }));
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -24, bubbles: true, cancelable: true }));
  window.setTimeout(() => {
    const snapshot = window.ashaDemoBrowserLaunch.snapshot();
    const proof = {
      browserProofVersion: 'asha-demo-browser-input-proof.v0',
      dispatchMode: 'headless_chromium_dom_events',
      ready: document.body.dataset.ashaBrowserDemoReady === 'true',
      controlsReady: document.body.dataset.browserControlsReady === 'true',
      gameplayLoopReady: document.body.dataset.browserGameplayLoopReady === 'true',
      inputEvents: snapshot.inputEvents,
      typedRequests: snapshot.typedRequests,
      gameplayReadbacks: snapshot.gameplayReadbacks,
      gameplay: snapshot.gameplay,
      bodyMarkers: {
        lastBrowserInputSequenceId: document.body.dataset.lastBrowserInputSequenceId,
        lastTypedAshaOperation: document.body.dataset.lastTypedAshaOperation,
        typedRequestCount: document.body.dataset.typedRequestCount,
        lastGameplayReadbackSequenceId: document.body.dataset.lastGameplayReadbackSequenceId,
        browserGameplayFrameCount: document.body.dataset.browserGameplayFrameCount,
      },
    };
    document.body.dataset.browserInputProofReady = 'true';
    document.body.dataset.browserInputEventCount = String(proof.inputEvents.length);
    document.body.dataset.browserTypedRequestCount = String(proof.typedRequests.length);
    const result = document.createElement('pre');
    result.id = 'browser-input-proof-result';
    result.textContent = JSON.stringify(proof);
    document.body.appendChild(result);
  }, 25);
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
assert.equal(proofResult.controlsReady, true);
assert.equal(proofResult.gameplayLoopReady, true);
assert.equal(proofResult.inputEvents.length >= 4, true);
assert.equal(proofResult.typedRequests.length, proofResult.inputEvents.length);
assert.equal(proofResult.gameplayReadbacks.length, proofResult.typedRequests.length);
assert.equal(proofResult.typedRequests.some((request) => request.operation === 'selectVoxel'), true);
assert.equal(proofResult.typedRequests.some((request) => request.operation === 'applyFirstPersonCameraInput'), true);

const proofHash = stateHash(proofResult);
const artifactBody = {
  artifactKind: 'asha_demo_browser_input_proof',
  artifactVersion: 'asha-demo-browser-input-proof.v0',
  generatedAt: 'deterministic-as-structure-only',
  command: 'npm run browser:input-proof',
  launchArtifact: {
    path: 'harness/out/browser-demo/latest/index.json',
    sha256: sha256(launchArtifactText),
    artifactHash: launchArtifact.artifactHash,
  },
  driver: {
    path: 'harness/out/browser-input-proof/latest/driver.html',
    sha256: sha256(driverPage),
    browser: chromium,
    dispatchMode: 'headless_chromium_dom_events',
  },
  page: {
    path: launchArtifact.page.path,
    htmlSha256: launchArtifact.page.htmlSha256,
    readyMarkerObserved: proofResult.ready,
    controlsReadyObserved: proofResult.controlsReady,
    gameplayLoopReadyObserved: proofResult.gameplayLoopReady,
  },
  browserInput: {
    inputEventCount: proofResult.inputEvents.length,
    typedRequestCount: proofResult.typedRequests.length,
    gameplayReadbackCount: proofResult.gameplayReadbacks.length,
    inputEvents: proofResult.inputEvents,
    typedRequests: proofResult.typedRequests,
    gameplayReadbacks: proofResult.gameplayReadbacks,
    finalGameplay: proofResult.gameplay,
    proofHash,
  },
  checks: {
    noDirectPageMutationCall: !driverPage.includes('ashaDemoBrowserLaunch.apply') && !driverPage.includes('call(methodName'),
    typedRequestsMatchInputEvents: proofResult.typedRequests.length === proofResult.inputEvents.length,
    gameplayReadbacksMatchTypedRequests: proofResult.gameplayReadbacks.length === proofResult.typedRequests.length,
    selectVoxelRequestObserved: proofResult.typedRequests.some((request) => request.operation === 'selectVoxel'),
    cameraInputRequestObserved: proofResult.typedRequests.some((request) => request.operation === 'applyFirstPersonCameraInput'),
  },
  validations: [
    'headless_browser_loaded_launch_page',
    'browser_ready_marker_observed',
    'dom_keyboard_events_dispatched',
    'dom_pointer_event_dispatched',
    'dom_wheel_event_dispatched',
    'typed_requests_recorded_from_dom_events',
    'gameplay_readbacks_recorded_from_typed_requests',
    'no_direct_page_mutation_call',
  ],
  nonClaims: [
    'not_runtime_authority',
    'not_replay_correlated_yet',
    'not_native_runtime_authority',
    'not_hardware_gpu_evidence',
    'not_performance_evidence',
  ],
};
const artifact = { ...artifactBody, artifactHash: stateHash(artifactBody) };

await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'browser-input-proof-ready',
  artifact: 'harness/out/browser-input-proof/latest/index.json',
  inputEventCount: proofResult.inputEvents.length,
  typedRequestCount: proofResult.typedRequests.length,
}));
