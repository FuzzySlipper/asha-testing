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
  RuntimeBridgeError,
  STABLE_OPERATION_COUNT,
  createMockRuntimeBridge,
  createNativeRuntimeBridge,
  frameCursor,
} from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'harness/conformance/fixtures/minimal-world.json');
const contractsCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/contracts/compatibility.json');
const runtimeCompatibilityPath = path.join(repoRoot, 'node_modules/@asha/runtime-bridge/compatibility.json');
const outDir = path.join(repoRoot, 'harness/out/conformance/latest');
const artifactPath = path.join(outDir, 'index.json');
const agoraOutDir = path.join(outDir, 'agora');
const agoraProofPath = path.join(agoraOutDir, 'asha-proof.html');
const compositorctl = process.env.AGORA_COMPOSITORCTL ?? '/usr/local/bin/compositorctl';
const agoraEvidenceMode = process.env.ASHA_DEMO_AGORA_EVIDENCE ?? 'inventory';

const cameraScenario = {
  initialPose: { position: [0, 1.6, 0], yawDegrees: 0, pitchDegrees: 0 },
  projection: { fovYDegrees: 60, near: 0.1, far: 1000 },
  viewport: { width: 1280, height: 720 },
  input: {
    moveForward: 1,
    moveRight: 0,
    moveUp: 0,
    yawDeltaDegrees: 15,
    pitchDeltaDegrees: -5,
    dtSeconds: 1 / 60,
    moveSpeedUnitsPerSecond: 3,
  },
  tick: 1,
};

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
    env: options.env ?? process.env,
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

function parseJsonResult(result) {
  if (result.status !== 'passed' || result.stdout === '') return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function classifyNativeAvailability(fixture) {
  try {
    const native = createNativeRuntimeBridge();
    native.initializeEngine({ seed: fixture.sceneId });
    try {
      native.loadWorldBundle({
        bundleSchemaVersion: fixture.schemaVersion,
        protocolVersion: fixture.protocolVersion,
        sceneId: fixture.sceneId,
      });
      native.submitCommands({ commands: [fixture.command] });
      native.readRenderDiffs(frameCursor(fixture.render.frameCursor));
      return { status: 'available', mode: 'native-public-facade', detail: 'native facade completed load/submit/readRenderDiffs' };
    } catch (error) {
      if (error instanceof RuntimeBridgeError && error.kind === 'operation_unimplemented') {
        return { status: 'unavailable-or-unwired', mode: 'native-fail-closed', detail: error.message };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof RuntimeBridgeError && error.kind === 'native_unavailable') {
      return { status: 'unavailable-or-unwired', mode: 'native-fail-closed', detail: error.message };
    }
    throw error;
  }
}

function latestArtifact(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  return [...artifacts].sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))[0];
}

async function writeAgoraProofPage(data) {
  await mkdir(agoraOutDir, { recursive: true });
  const html = `<!doctype html>
<meta charset="utf-8">
<title>ASHA Agora Conformance Evidence</title>
<style>
body{margin:0;background:#101827;color:#f9fafb;font:20px system-ui,sans-serif;padding:32px}
code{color:#93c5fd}.ok{color:#34d399}.warn{color:#fbbf24}
</style>
<h1>ASHA Agora Conformance Evidence</h1>
<p class="ok">projectionHash <code>${data.projectionHash}</code></p>
<p>asha <code>${data.ashaCommit}</code></p>
<p>asha-demo <code>${data.demoCommit}</code></p>
<p>stateHash <code>${data.stateHash}</code></p>
<p class="warn">Generated by public @asha/runtime-bridge evidence, not by ASHA internals.</p>
`;
  await writeFile(agoraProofPath, html);
}

async function collectAgoraEvidence({ ashaSource, demoSource, projectionHash, stateHashValue }) {
  const base = {
    mode: agoraEvidenceMode,
    compositorctl,
    ownership: 'Agora owns session/app-launch/readiness/surface-capture; ASHA owns public runtime/conformance evidence.',
  };
  const listResult = run(compositorctl, ['--pretty', 'artifacts', 'list'], { timeout: 10000 });
  const artifactList = parseJsonResult(listResult);
  const artifacts = artifactList?.artifacts ?? [];
  const inventory = {
    command: listResult.command,
    status: listResult.status,
    artifactCount: artifacts.length,
    latest: latestArtifact(artifacts),
    stderr: listResult.stderr,
  };

  if (listResult.status !== 'passed') {
    return {
      ...base,
      status: 'unavailable',
      classification: 'agora-compositorctl-unavailable',
      inventory,
      comparison: { status: 'unavailable', reason: 'compositorctl artifacts list failed' },
    };
  }

  if (agoraEvidenceMode !== 'live') {
    return {
      ...base,
      status: artifacts.length > 0 ? 'available-inventory-only' : 'unavailable',
      classification: artifacts.length > 0 ? 'existing-compositor-artifact-inventory' : 'no-agora-artifacts-found',
      inventory,
      comparison: {
        status: 'unavailable',
        reason: 'live ASHA surface capture was not requested; set ASHA_DEMO_AGORA_EVIDENCE=live to attempt app launch/capture',
      },
    };
  }

  await writeAgoraProofPage({
    projectionHash,
    ashaCommit: ashaSource.commit,
    demoCommit: demoSource.commit,
    stateHash: stateHashValue,
  });

  const sessionResult = run(compositorctl, [
    '--pretty',
    'session',
    'create',
    '--label',
    'asha-2559-conformance',
    '--project-id',
    'asha',
    '--task-id',
    '2559',
    '--agent-identity',
    'asha-runner',
    '--asha-scenario',
    'asha-demo-conformance-agora',
    '--repo-branch',
    demoSource.branch,
    '--repo-commit',
    demoSource.commit,
    '--asha-runtime-mode',
    'mock-public-facade-with-native-probe',
    '--artifact-root',
    outDir,
    '--audit-correlation-id',
    'asha-2559-agora-live',
  ]);
  const session = parseJsonResult(sessionResult);
  if (!session?.session_id || !session?.session_token) {
    return {
      ...base,
      status: 'unavailable',
      classification: 'agora-session-create-failed',
      inventory,
      sessionAttempt: sessionResult,
      comparison: { status: 'unavailable', reason: 'Agora session creation failed' },
    };
  }

  const launchCommand = `/usr/local/bin/webview-launcher --path ${agoraProofPath} --title "ASHA Agora Conformance Evidence" --app-id asha-demo-conformance`;
  const launchResult = run(compositorctl, [
    '--pretty',
    'launch',
    '--session',
    session.session_id,
    '--session-token',
    session.session_token,
    '--cmd',
    launchCommand,
    '--cwd',
    repoRoot,
    '--expected-title',
    'ASHA Agora Conformance Evidence',
    '--wait-surface',
    '--wait-timeout-ms',
    '8000',
    '--audit-correlation-id',
    'asha-2559-agora-live',
  ], { timeout: 12000 });
  const launch = parseJsonResult(launchResult);
  if (!launch?.surface?.surface?.id) {
    return {
      ...base,
      status: 'unavailable',
      classification: 'agora-app-launch-or-surface-readiness-failed',
      inventory,
      session: { sessionId: session.session_id, label: session.label, artifactRoot: session.artifact_root },
      launchAttempt: { ...launchResult, stdout: launchResult.stdout.slice(0, 2000), stderr: launchResult.stderr.slice(0, 2000) },
      knownPunt: {
        project: 'agora-os',
        task: 2553,
        reason: 'den-k8 webview-launcher failed to map a surface during live ASHA proof; direct probe showed missing Python gi/WebKitGTK runtime on this host.',
      },
      comparison: { status: 'unavailable', reason: 'Agora could not launch a live ASHA evidence surface' },
    };
  }

  const surfaceID = launch.surface.surface.id;
  const captureResult = run(compositorctl, [
    '--pretty',
    'capture',
    '--surface',
    surfaceID,
    '--export',
    '--session',
    session.session_id,
    '--session-token',
    session.session_token,
    '--audit-correlation-id',
    'asha-2559-agora-live',
    '--evidence-class',
    'surface_screenshot',
    '--asha-command-sequence-id',
    `asha-demo-conformance:${projectionHash}`,
  ], { timeout: 10000 });
  const capture = parseJsonResult(captureResult);
  return {
    ...base,
    status: capture?.sha256 ? 'captured' : 'unavailable',
    classification: capture?.sha256 ? 'agora-compositor-capture' : 'agora-capture-failed',
    inventory,
    session: { sessionId: session.session_id, label: session.label, artifactRoot: session.artifact_root },
    launch: { launchId: launch.launch_id, pid: launch.pid, surfaceId: surfaceID },
    capture,
    captureAttempt: captureResult.status === 'passed' ? undefined : captureResult,
    comparison: capture?.sha256
      ? { status: 'comparable', reason: 'Agora compositor capture produced a PNG artifact for the ASHA evidence page; ASHA renderDiff remains public structural evidence.' }
      : { status: 'unavailable', reason: 'Agora capture command failed' },
  };
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const ashaSource = readSource(path.resolve(repoRoot, '../asha'), 'asha');
const demoSource = readSource(repoRoot, 'asha-demo');
const compatibility = {
  contracts: await readCompatibility(contractsCompatibilityPath),
  runtimeBridge: await readCompatibility(runtimeCompatibilityPath),
};
const bridge = createMockRuntimeBridge();
const engineHandle = bridge.initializeEngine({ seed: fixture.sceneId });
const composition = bridge.loadWorldBundle({
  bundleSchemaVersion: fixture.schemaVersion,
  protocolVersion: fixture.protocolVersion,
  sceneId: fixture.sceneId,
});
assert.equal(composition.blocksLoad, false);

const commandResult = bridge.submitCommands({ commands: [fixture.command] });
const stepResult = bridge.stepSimulation(fixture.step);
const renderDiff = bridge.readRenderDiffs(frameCursor(fixture.render.frameCursor));
const saveSummary = bridge.saveCurrentWorld();
const finalStatus = bridge.getCompositionStatus();
const beforeCamera = bridge.createCamera({
  initialPose: cameraScenario.initialPose,
  projection: cameraScenario.projection,
  viewport: cameraScenario.viewport,
});
const afterCamera = bridge.applyFirstPersonCameraInput({ camera: beforeCamera.camera, tick: cameraScenario.tick, input: cameraScenario.input });
const projectionSnapshot = bridge.readCameraProjection({ camera: afterCamera.camera, viewport: null });
const boundaryCheck = runBoundaryCheck();
assert.equal(boundaryCheck.status, 'passed', `${boundaryCheck.stdout}\n${boundaryCheck.stderr}`);
assert.notDeepEqual(afterCamera.pose, beforeCamera.pose);

const nativeAuthority = classifyNativeAvailability(fixture);
const workflowEvidence = {
  engineHandle,
  fixture,
  compatibility,
  ashaSource,
  demoSource,
  composition,
  commandResult,
  stepResult,
  renderDiff,
  saveSummary,
  finalStatus,
  camera: { beforeCamera, afterCamera, projectionHash: projectionSnapshot.projectionHash },
  nativeAuthority,
};
const stateHashValue = stateHash(workflowEvidence);
const agoraEvidence = await collectAgoraEvidence({
  ashaSource,
  demoSource,
  projectionHash: projectionSnapshot.projectionHash,
  stateHashValue,
});

const artifact = {
  schemaVersion: 2,
  generatedAt: 'deterministic-as-structure-only',
  repo: demoSource,
  ashaSource,
  compatibility,
  publicImports: ['@asha/contracts', '@asha/runtime-bridge'],
  runtime: {
    mode: 'mock-public-facade-with-native-probe',
    nativeMode: nativeAuthority.mode,
    stableOperationCount: STABLE_OPERATION_COUNT,
  },
  workflow: {
    loadedWorld: composition.loadedWorld,
    commandResult,
    stepResult,
    renderDiff,
    saveSummary,
    finalStatus,
  },
  cameraEvidence: {
    status: 'public-camera-surface-produced-projection-evidence',
    inputSequence: cameraScenario,
    beforePose: beforeCamera.pose,
    afterPose: afterCamera.pose,
    projectionSnapshot,
    missingOperations: [],
  },
  renderEvidence: {
    asha: {
      status: 'public-render-diff-evidence',
      renderDiff,
      headlessBrowser: { status: 'unavailable', reason: 'No ASHA headless browser screenshot path is exposed to asha-demo yet.' },
    },
    agora: agoraEvidence,
    comparison: agoraEvidence.comparison,
  },
  artifacts: {
    fixture: path.relative(repoRoot, fixturePath),
    stateHash: stateHashValue,
  },
  boundaryCheck,
  gaps: {
    nativeAuthority: {
      ...nativeAuthority,
      followUpTask: 2559,
    },
    renderEvidence: {
      status: agoraEvidence.status === 'captured' ? 'agora-compositor-capture-available' : 'agora-compositor-capture-unavailable',
      followUpTask: 2553,
      detail: agoraEvidence.comparison.reason,
    },
  },
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
