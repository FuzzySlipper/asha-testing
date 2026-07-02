#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '@asha/contracts';
import {
  parseAshaGameManifestToml,
  resolveAshaGameAssetForDev,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';
import {
  RuntimeBridgeError,
  STABLE_OPERATION_COUNT,
  createMockRuntimeBridge,
  createNativeRuntimeBridge,
  frameCursor,
} from '@asha/runtime-bridge';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'harness/conformance/fixtures/minimal-world.json');
const manifestPath = path.join(repoRoot, 'asha.game.toml');
const catalogPath = path.join(repoRoot, 'packages/game-catalogs/catalog.json');
const scenePath = path.join(repoRoot, 'scenes/minimal.scene.json');
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

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upperLeft;
}

function alphaIndexForChannels(colorType) {
  return colorType === 4 ? 1 : colorType === 6 ? 3 : null;
}

function colorChannelsForType(colorType) {
  return colorType === 0 || colorType === 4 ? 1 : 3;
}

function ratio(count, total) {
  return total > 0 ? Number((count / total).toFixed(4)) : 0;
}

async function inspectPngVisualContent(imagePath) {
  if (!imagePath) return { status: 'missing', classification: 'missing-image-path' };
  let buffer;
  try {
    buffer = await readFile(imagePath);
  } catch (error) {
    return {
      status: 'unavailable',
      classification: 'image-read-failed',
      imagePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < signature.length || !buffer.subarray(0, signature.length).equals(signature)) {
    return { status: 'invalid', classification: 'not-a-png', imagePath };
  }

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return { status: 'invalid', classification: 'truncated-png', imagePath };
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || !channels || width <= 0 || height <= 0 || idat.length === 0) {
    return {
      status: 'unsupported',
      classification: 'unsupported-png-shape',
      imagePath,
      width,
      height,
      bitDepth,
      colorType,
    };
  }

  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch (error) {
    return {
      status: 'invalid',
      classification: 'png-inflate-failed',
      imagePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const bytesPerPixel = channels;
  const rowBytes = width * bytesPerPixel;
  const expected = height * (rowBytes + 1);
  if (inflated.length < expected) return { status: 'invalid', classification: 'truncated-png-raster', imagePath, width, height };

  const mins = Array(channels).fill(255);
  const maxes = Array(channels).fill(0);
  const colors = new Set();
  let opaquePixels = 0;
  let darkOpaquePixels = 0;
  let lightOpaquePixels = 0;
  let cursor = 0;
  let prior = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[cursor + x];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = prior[x];
      const upperLeft = x >= bytesPerPixel ? prior[x - bytesPerPixel] : 0;
      if (filter === 0) row[x] = raw;
      else if (filter === 1) row[x] = (raw + left) & 0xff;
      else if (filter === 2) row[x] = (raw + up) & 0xff;
      else if (filter === 3) row[x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (raw + paeth(left, up, upperLeft)) & 0xff;
      else return { status: 'invalid', classification: 'unknown-png-filter', imagePath, width, height, filter };
    }
    cursor += rowBytes;
    for (let x = 0; x < rowBytes; x += channels) {
      const sample = [];
      for (let channel = 0; channel < channels; channel += 1) {
        const value = row[x + channel];
        mins[channel] = Math.min(mins[channel], value);
        maxes[channel] = Math.max(maxes[channel], value);
        sample.push(value);
      }
      if (colors.size <= 16) colors.add(sample.join(','));
      const alpha = alphaIndexForChannels(colorType) === null ? 255 : sample[alphaIndexForChannels(colorType)];
      const r = sample[0];
      const g = colorChannelsForType(colorType) >= 3 ? sample[1] : sample[0];
      const b = colorChannelsForType(colorType) >= 3 ? sample[2] : sample[0];
      if (alpha >= 240) {
        opaquePixels += 1;
        if (r < 48 && g < 64 && b < 96) darkOpaquePixels += 1;
        if (r > 230 && g > 230 && b > 220) lightOpaquePixels += 1;
      }
    }
    prior = row;
  }

  const alphaIndex = colorType === 4 ? 1 : colorType === 6 ? 3 : null;
  const alphaVisible = alphaIndex === null || maxes[alphaIndex] > 0;
  const colorChannels = alphaIndex === null ? channels : channels - 1;
  const hasColorVariation = mins.slice(0, colorChannels).some((min, index) => min !== maxes[index]);
  const hasNonZeroColor = maxes.slice(0, colorChannels).some((max) => max > 0);
  const visible = alphaVisible && (hasColorVariation || hasNonZeroColor);

  return {
    status: visible ? 'visible' : 'blank',
    classification: visible ? 'png-visible-content' : 'blank-or-transparent-png',
    imagePath,
    width,
    height,
    mode: colorType === 6 ? 'RGBA' : colorType === 2 ? 'RGB' : colorType === 4 ? 'grayscale-alpha' : 'grayscale',
    extrema: mins.map((min, index) => [min, maxes[index]]),
    uniqueColorsSampled: colors.size,
    opaquePixelRatio: ratio(opaquePixels, width * height),
    darkOpaquePixelRatio: ratio(darkOpaquePixels, width * height),
    lightOpaquePixelRatio: ratio(lightOpaquePixels, width * height),
    firstColors: [...colors].slice(0, 8),
  };
}

async function artifactWithVisualInspection(artifact) {
  if (!artifact) return null;
  return {
    ...artifact,
    visualInspection: await inspectPngVisualContent(artifact.image_path),
  };
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
<p>asha-testing <code>${data.demoCommit}</code></p>
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
  const latest = await artifactWithVisualInspection(latestArtifact(artifacts));
  const inventory = {
    command: listResult.command,
    status: listResult.status,
    artifactCount: artifacts.length,
    latest,
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
    const hasVisibleInventory = latest?.visualInspection?.status === 'visible';
    const hasBlankInventory = latest?.visualInspection?.status === 'blank';
    return {
      ...base,
      status: hasVisibleInventory ? 'available-inventory-only' : 'unavailable',
      classification: hasVisibleInventory
        ? 'existing-compositor-artifact-inventory'
        : hasBlankInventory
          ? 'blank-compositor-capture-inventory'
          : artifacts.length > 0
            ? 'unvalidated-compositor-artifact-inventory'
            : 'no-agora-artifacts-found',
      inventory,
      comparison: {
        status: 'unavailable',
        reason: hasBlankInventory
          ? 'latest Agora inventory artifact is a blank/transparent PNG, not usable visual evidence'
          : 'live ASHA surface capture was not requested; set ASHA_DEMO_AGORA_EVIDENCE=live to attempt app launch/capture',
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
  const inspectedCapture = capture ? await artifactWithVisualInspection(capture) : null;
  const captureVisible = inspectedCapture?.visualInspection?.status === 'visible';
  const captureBlank = inspectedCapture?.visualInspection?.status === 'blank';
  return {
    ...base,
    status: captureVisible ? 'captured' : 'unavailable',
    classification: captureVisible
      ? 'agora-compositor-capture'
      : captureBlank
        ? 'agora-capture-blank-readback'
        : 'agora-capture-failed',
    inventory,
    session: { sessionId: session.session_id, label: session.label, artifactRoot: session.artifact_root },
    launch: { launchId: launch.launch_id, pid: launch.pid, surfaceId: surfaceID },
    capture: inspectedCapture,
    captureAttempt: captureResult.status === 'passed' ? undefined : captureResult,
    comparison: captureVisible
      ? { status: 'comparable', reason: 'Agora compositor capture produced a non-blank PNG artifact for the ASHA evidence page; ASHA renderDiff remains public structural evidence.' }
      : captureBlank
        ? { status: 'unavailable', reason: 'Agora capture produced a blank/transparent PNG readback, not usable visual evidence' }
        : { status: 'unavailable', reason: 'Agora capture command failed' },
  };
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const manifestResult = parseAshaGameManifestToml(await readFile(manifestPath, 'utf8'));
assert.equal(manifestResult.ok, true, manifestResult.ok ? '' : JSON.stringify(manifestResult.diagnostics));
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const catalogValidation = validateAshaGameAssetCatalog(
  catalog,
  manifestResult.manifest,
  (assetPath) => existsSync(path.join(repoRoot, assetPath)),
);
assert.equal(catalogValidation.ok, true, catalogValidation.ok ? '' : JSON.stringify(catalogValidation.diagnostics));
const sceneSource = JSON.parse(await readFile(scenePath, 'utf8'));
assert.equal(sceneSource.sceneId, fixture.sceneId);
const assetResolutions = sceneSource.catalogAssetIds.map((assetId) => resolveAshaGameAssetForDev(catalogValidation.catalog, assetId));
assert.equal(assetResolutions.every((resolution) => resolution !== null), true);
const ashaSource = readSource(path.resolve(repoRoot, '../asha'), 'asha');
const demoSource = readSource(repoRoot, 'asha-testing');
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
  sceneSource,
  assetResolutions,
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

const unresolvedGaps = {};
const resolvedEvidence = {};

if (nativeAuthority.status === 'available') {
  resolvedEvidence.nativeAuthority = {
    ...nativeAuthority,
    resolvedByTask: 2570,
  };
} else {
  unresolvedGaps.nativeAuthority = {
    ...nativeAuthority,
    followUpTask: 2570,
  };
}

const hasBlankAgoraReadback = agoraEvidence.classification === 'blank-compositor-capture-inventory'
  || agoraEvidence.classification === 'agora-capture-blank-readback'
  || agoraEvidence.inventory?.latest?.visualInspection?.status === 'blank'
  || agoraEvidence.capture?.visualInspection?.status === 'blank';

if (agoraEvidence.status === 'captured') {
  resolvedEvidence.renderEvidence = {
    status: 'agora-compositor-capture-available',
    resolvedByTask: 2553,
    detail: agoraEvidence.comparison.reason,
  };
} else {
  unresolvedGaps.renderEvidence = {
    status: hasBlankAgoraReadback
      ? 'agora-compositor-capture-blank-readback'
      : 'agora-compositor-capture-unavailable',
    followUpTask: 2553,
    detail: hasBlankAgoraReadback
      ? `${agoraEvidence.comparison.reason}; latest Agora inventory PNG is blank/transparent and not usable visual evidence`
      : agoraEvidence.comparison.reason,
  };
}

const artifact = {
  schemaVersion: 2,
  generatedAt: 'deterministic-as-structure-only',
  repo: demoSource,
  ashaSource,
  compatibility,
  publicImports: ['@asha/contracts', '@asha/game-workspace', '@asha/runtime-bridge'],
  runtime: {
    mode: 'mock-public-facade-with-native-probe',
    nativeMode: nativeAuthority.mode,
    stableOperationCount: STABLE_OPERATION_COUNT,
  },
  workflow: {
    scene: {
      sceneId: sceneSource.sceneId,
      name: sceneSource.name,
      catalogAssetIds: sceneSource.catalogAssetIds,
      assetResolutions,
    },
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
      headlessBrowser: { status: 'unavailable', reason: 'No ASHA headless browser screenshot path is exposed to asha-testing yet.' },
    },
    agora: agoraEvidence,
    comparison: agoraEvidence.comparison,
  },
  artifacts: {
    fixture: path.relative(repoRoot, fixturePath),
    scene: path.relative(repoRoot, scenePath),
    catalog: path.relative(repoRoot, catalogPath),
    stateHash: stateHashValue,
  },
  boundaryCheck,
  resolvedEvidence,
  gaps: unresolvedGaps,
};

await mkdir(outDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, artifactPath)}`);
