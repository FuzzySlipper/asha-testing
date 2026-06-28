#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  createMockRuntimeBridge,
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

const manifest = parseAshaGameManifestToml(readFileSync(join(repoRoot, 'asha.game.toml'), 'utf8'));
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

const bridge = createMockRuntimeBridge();
bridge.initializeEngine({ seed: fixture.sceneId });
const composition = bridge.loadWorldBundle({
  bundleSchemaVersion: fixture.schemaVersion,
  protocolVersion: fixture.protocolVersion,
  sceneId: fixture.sceneId,
});
assert.equal(composition.blocksLoad, false);
const commandResult = bridge.submitCommands({ commands: [fixture.command] });
const stepResult = bridge.stepSimulation(fixture.step);
const renderDiff = bridge.readRenderDiffs(frameCursor(fixture.render.frameCursor));
const fixtures = buildDevtoolsProtocolGoldenFixtures();
let proposedCommandCount = 0;
let proposedAcceptedCount = 0;

function projectionSnapshot() {
  const commandSuffix = proposedCommandCount === 0 ? '' : `:commands:${proposedCommandCount}`;
  return {
    type: 'projection.snapshot',
    summary: {
      tick: stepResult.tick,
      worldHash: `world:${scene.sceneId}:${composition.loadedWorld}${commandSuffix}`,
      entityCount: commandResult.accepted + proposedAcceptedCount,
      sceneCount: 1,
      selectedEntityId: null,
      renderDiffHash: `render:${scene.sceneId}:${renderDiff.ops.length}${commandSuffix}`,
    },
    diagnostics: [
      `scene:${scene.name}`,
      `asset:${assetResolutions[0].assetId}`,
    ],
  };
}

function handleMessage(message) {
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
          gameId: 'asha-demo',
          workspaceId: message.requestedWorkspaceId,
          runtimeMode: 'mock',
          startedAtIso: '2026-06-28T00:00:00.000Z',
        },
      };
    case 'projection.pull':
      return projectionSnapshot();
    case 'render_diff.snapshot':
      return { type: 'render_diff.snapshot', frame: renderDiff, renderDiffHash: `render:${scene.sceneId}:${renderDiff.ops.length}` };
    case 'telemetry.pull':
      return {
        type: 'telemetry.snapshot',
        samples: [
          { metric: 'simulation_ms', value: stepResult.tick, unit: 'ms' },
          { metric: 'render_op_count', value: renderDiff.ops.length, unit: 'count' },
          { metric: 'command_queue_depth', value: proposedCommandCount, unit: 'count' },
        ].slice(0, message.maxSamples),
      };
    case 'command.propose':
      {
        const result = bridge.submitCommands(message.batch);
        proposedCommandCount += message.batch.commands.length;
        proposedAcceptedCount += result.accepted;
        return {
          type: 'command.result',
          proposal: {
            status: 'accepted',
            sequenceId: message.sequenceId,
            result,
            authorityHashAfter: `authority:${scene.sceneId}:commands:${proposedCommandCount}`,
          },
        };
      }
    case 'replay.export':
      return {
        type: 'replay.exported',
        artifact: {
          artifactId: message.replayId,
          kind: 'replay_export',
          path: `harness/out/replay/${message.replayId}.json`,
          sha256: 'sha256-demo-devtools-replay',
        },
      };
    case 'evidence.export':
      return {
        type: 'evidence.exported',
        artifacts: [{
          artifactId: `devtools-${message.sequenceId}`,
          kind: 'evidence_export',
          path: 'harness/out/devtools/latest/index.json',
          sha256: 'sha256-demo-devtools-evidence',
        }],
      };
  }
}

const { server, endpoint } = await createJsonWebSocketServer({ host, port, handleMessage });
console.log(JSON.stringify({
  status: 'listening',
  endpoint,
  scene: { sceneId: scene.sceneId, name: scene.name, catalogAssetIds: scene.catalogAssetIds },
  loadedWorld: composition.loadedWorld,
}));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
