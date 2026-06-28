#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ASHA_DEVTOOLS_PROTOCOL_VERSION,
  buildDevtoolsProtocolGoldenFixtures,
} from '@asha/devtools';
import {
  parseAshaGameManifestToml,
  resolveAshaGameAssetForDev,
  validateAshaGameAssetCatalog,
} from '@asha/game-workspace';
import {
  createReferenceGameRuntimeLauncher,
  frameCursor,
} from '@asha/runtime-bridge';

import { createJsonWebSocketServer } from './devtools-ws.mjs';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const host = argValue('--host', process.env.ASHA_DEMO_DEVTOOLS_HOST ?? '127.0.0.1');
const port = Number(argValue('--port', process.env.ASHA_DEMO_DEVTOOLS_PORT ?? '7391'));

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function writeJsonArtifact(relativePath, body) {
  const artifactPath = join(repoRoot, relativePath);
  mkdirSync(dirname(artifactPath), { recursive: true });
  const text = `${JSON.stringify(body, null, 2)}\n`;
  writeFileSync(artifactPath, text);
  return { path: relativePath, sha256: sha256(text) };
}

const manifestText = readFileSync(join(repoRoot, 'asha.game.toml'), 'utf8');
const manifestHash = sha256(manifestText);
const manifest = parseAshaGameManifestToml(manifestText);
assert.equal(manifest.ok, true, manifest.ok ? '' : JSON.stringify(manifest.diagnostics));
const fixture = JSON.parse(readFileSync(join(repoRoot, manifest.manifest.runtime.wasmOrNativeEntry), 'utf8'));
const scene = JSON.parse(readFileSync(join(repoRoot, 'scenes/minimal.scene.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(repoRoot, 'packages/game-catalogs/catalog.json'), 'utf8'));
const catalogValidation = validateAshaGameAssetCatalog(
  catalog,
  manifest.manifest,
  (assetPath) => existsSync(join(repoRoot, assetPath)),
);
assert.equal(catalogValidation.ok, true, catalogValidation.ok ? '' : JSON.stringify(catalogValidation.diagnostics));

const assetResolutions = scene.catalogAssetIds.map((assetId) => resolveAshaGameAssetForDev(catalogValidation.catalog, assetId));
assert.equal(assetResolutions.every((resolution) => resolution !== null), true);

const launcher = createReferenceGameRuntimeLauncher();
const runtimeSession = await launcher.launch({
  gameId: 'asha-demo',
  workspaceId: 'workspace.local',
  runtimeEntry: manifest.manifest.runtime.wasmOrNativeEntry,
  compatibility: {
    contractsPackageVersion: manifest.manifest.asha.contractsVersion,
    runtimeBridgePackageVersion: manifest.manifest.asha.runtimeBridgeVersion,
    devtoolsProtocolVersion: manifest.manifest.asha.devtoolsProtocolVersion,
    publishArtifactVersion: manifest.manifest.asha.publishArtifactFormatVersion,
  },
  resourceProfile: {
    profileId: 'asha-demo.reference.resources.v1',
    runtimeEntry: manifest.manifest.runtime.wasmOrNativeEntry,
    worldBundleId: `scene:${fixture.sceneId}`,
  },
  world: {
    bundleSchemaVersion: fixture.schemaVersion,
    protocolVersion: fixture.protocolVersion,
    sceneId: fixture.sceneId,
  },
  startedAtIso: '2026-06-28T00:00:00.000Z',
});
const stepResult = fixture.step;
const renderDiffSnapshot = await runtimeSession.pullRenderDiff(frameCursor(fixture.render.frameCursor));
const renderDiff = renderDiffSnapshot.frame;
const fixtures = buildDevtoolsProtocolGoldenFixtures();
const commandReceipts = [];

async function projectionSnapshot() {
  const projection = await runtimeSession.pullProjection();
  const telemetry = await runtimeSession.pullTelemetry();
  return {
    type: 'projection.snapshot',
    summary: {
      tick: stepResult.tick,
      worldHash: projection.worldHash,
      entityCount: telemetry.acceptedCommandCount,
      sceneCount: 1,
      selectedEntityId: null,
      renderDiffHash: `render:${scene.sceneId}:${renderDiff.ops.length}:seq:${projection.sequenceId}`,
    },
    diagnostics: [
      `scene:${scene.name}`,
      `asset:${assetResolutions[0].assetId}`,
      `runtime:${runtimeSession.identity.runtimeMode}`,
    ],
  };
}

async function handleMessage(message) {
  switch (message.type) {
    case 'handshake.request':
      if (message.protocolVersion !== ASHA_DEVTOOLS_PROTOCOL_VERSION) {
        return {
          type: 'handshake.response',
          accepted: false,
          protocolVersion: ASHA_DEVTOOLS_PROTOCOL_VERSION,
          reason: 'unsupported_protocol',
        };
      }
      return {
        type: 'handshake.response',
        accepted: true,
        protocolVersion: ASHA_DEVTOOLS_PROTOCOL_VERSION,
        compatibility: fixtures.handshakeResponse.compatibility,
        runtime: {
          engineVersion: manifest.manifest.asha.engineVersion,
          gameId: runtimeSession.identity.gameId,
          workspaceId: message.requestedWorkspaceId,
          runtimeMode: runtimeSession.identity.runtimeMode,
          startedAtIso: runtimeSession.identity.startedAtIso,
          launcherName: runtimeSession.launch.runtimeProfile.launcherName,
          runtimeProfileId: runtimeSession.launch.runtimeProfile.profileId,
          nonClaims: runtimeSession.identity.nonClaims,
        },
      };
    case 'projection.pull':
      return projectionSnapshot();
    case 'render_diff.snapshot':
      return { type: 'render_diff.snapshot', frame: renderDiff, renderDiffHash: `render:${scene.sceneId}:${renderDiff.ops.length}` };
    case 'telemetry.pull':
      {
        const telemetry = await runtimeSession.pullTelemetry();
        return {
        type: 'telemetry.snapshot',
        samples: [
          { metric: 'simulation_ms', value: stepResult.tick, unit: 'ms' },
          { metric: 'render_op_count', value: renderDiff.ops.length, unit: 'count' },
          { metric: 'command_queue_depth', value: telemetry.acceptedCommandCount + telemetry.rejectedCommandCount, unit: 'count' },
          { metric: 'accepted_command_count', value: telemetry.acceptedCommandCount, unit: 'count' },
        ].slice(0, message.maxSamples),
      };
      }
    case 'command.propose':
      {
        const proposal = await runtimeSession.proposeCommands(message.batch);
        commandReceipts.push({
          sequenceId: proposal.sequenceId,
          batch: message.batch,
          status: proposal.status,
          result: proposal.result,
          authorityHashBefore: proposal.authorityHashBefore,
          authorityHashAfter: proposal.authorityHashAfter,
          diagnostics: proposal.diagnostics,
        });
        return {
          type: 'command.result',
          proposal: {
            status: proposal.status,
            sequenceId: proposal.sequenceId,
            result: proposal.result,
            reason: proposal.status === 'rejected' ? 'authority_rejected' : proposal.status === 'failed' ? 'runtime_unavailable' : undefined,
            authorityHashBefore: proposal.authorityHashBefore,
            authorityHashAfter: proposal.authorityHashAfter,
            diagnostics: proposal.diagnostics,
          },
        };
      }
    case 'replay.export':
      {
        const replay = await runtimeSession.exportReplay({ replayId: message.replayId });
        const artifactBody = {
          artifactKind: 'asha_demo_dev_runtime_replay',
          artifactVersion: 'dev-runtime-replay.v1',
          replayId: replay.replayId,
          runtimeMode: runtimeSession.identity.runtimeMode,
          launcherName: runtimeSession.launch.runtimeProfile.launcherName,
          manifestHash,
          scene: { sceneId: scene.sceneId, name: scene.name, catalogAssetIds: scene.catalogAssetIds },
          commandReceipts,
          authorityHash: replay.authorityHash,
          evidenceRefs: replay.evidenceRefs,
        };
        const written = writeJsonArtifact(`harness/out/replay/${message.replayId}.json`, artifactBody);
        return {
        type: 'replay.exported',
        artifact: {
          artifactId: replay.replayId,
          kind: 'replay_export',
          path: written.path,
          sha256: written.sha256,
        },
      };
      }
    case 'evidence.export':
      {
        const evidence = await runtimeSession.exportEvidence({ evidenceId: `devtools-${message.sequenceId}` });
        const firstReceipt = commandReceipts[0] ?? null;
        const lastReceipt = commandReceipts.at(-1) ?? null;
        const artifactBody = {
          artifactKind: 'asha_demo_dev_runtime_command_evidence',
          artifactVersion: 'dev-runtime-command-evidence.v1',
          evidenceId: evidence.evidenceId,
          runtime: {
            ...runtimeSession.identity,
            launcherName: runtimeSession.launch.runtimeProfile.launcherName,
            runtimeProfileId: runtimeSession.launch.runtimeProfile.profileId,
          },
          manifestHash,
          scene: { sceneId: scene.sceneId, name: scene.name, catalogAssetIds: scene.catalogAssetIds },
          catalogAssetIds: scene.catalogAssetIds,
          commandReceipts,
          projectionDiffSummary: {
            beforeAuthorityHash: firstReceipt?.authorityHashBefore ?? null,
            afterAuthorityHash: lastReceipt?.authorityHashAfter ?? null,
            acceptedCommandChangedAuthority: commandReceipts.some(
              (receipt) => receipt.status === 'accepted' && receipt.authorityHashBefore !== receipt.authorityHashAfter,
            ),
            rejectedCommandPreservedAuthority: commandReceipts
              .filter((receipt) => receipt.status === 'rejected')
              .every((receipt) => receipt.authorityHashBefore === receipt.authorityHashAfter),
          },
          projection: evidence.projection,
          nonClaims: evidence.nonClaims,
          evidenceRefs: evidence.evidenceRefs,
        };
        const written = writeJsonArtifact('harness/out/devtools/latest/index.json', artifactBody);
        return {
        type: 'evidence.exported',
        artifacts: [{
          artifactId: evidence.evidenceId,
          kind: 'evidence_export',
          path: written.path,
          sha256: written.sha256,
        }],
      };
      }
  }
}

const { server, endpoint } = await createJsonWebSocketServer({ host, port, handleMessage });
console.log(JSON.stringify({
  status: 'listening',
  endpoint,
  scene: { sceneId: scene.sceneId, name: scene.name, catalogAssetIds: scene.catalogAssetIds },
  loadedWorld: runtimeSession.launch.projection.loadedWorld,
  runtimeMode: runtimeSession.identity.runtimeMode,
  launcherName: runtimeSession.launch.runtimeProfile.launcherName,
}));

process.on('SIGTERM', () => server.close(async () => {
  await runtimeSession.shutdown();
  process.exit(0);
}));
process.on('SIGINT', () => server.close(async () => {
  await runtimeSession.shutdown();
  process.exit(0);
}));
