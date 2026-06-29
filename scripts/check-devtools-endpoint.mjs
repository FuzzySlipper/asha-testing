#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ASHA_DEVTOOLS_PROTOCOL_VERSION,
  buildDevtoolsProtocolGoldenFixtures,
} from '@asha/devtools';

import { exchangeJsonWebSocket } from './devtools-ws.mjs';

const endpoint = process.argv[2] ?? process.env.ASHA_DEMO_DEVTOOLS_ENDPOINT ?? 'ws://127.0.0.1:7391';
const fixtures = buildDevtoolsProtocolGoldenFixtures();

const handshake = await exchangeJsonWebSocket(endpoint, fixtures.handshakeRequest);
assert.equal(handshake.type, 'handshake.response');
assert.equal(handshake.accepted, true);
assert.equal(handshake.protocolVersion, ASHA_DEVTOOLS_PROTOCOL_VERSION);
assert.equal(handshake.runtime.gameId, 'asha-demo');
assert.equal(handshake.runtime.runtimeMode, 'native');
assert.equal(handshake.runtime.launcherName, 'native-game-runtime-launcher');
assert.equal(handshake.runtime.backendMode, 'native');
assert.equal(handshake.runtime.backendProfile, 'native.napi.launcher.v1');
assert.deepEqual(handshake.runtime.backendProofRefs, ['proof:dev-authority-smoke']);
assert.equal(handshake.runtime.nativeProofRef, 'proof:dev-authority-smoke');
assert.equal(handshake.runtime.nonClaims.includes('not_native_runtime'), false);

const projection = await exchangeJsonWebSocket(endpoint, fixtures.projectionPull);
assert.equal(projection.type, 'projection.snapshot');
assert.equal(projection.summary.worldHash, 'native-world:asha-demo:1001:accepted:0');
assert.equal(projection.diagnostics.includes('scene:ASHA Demo Minimal Cube'), true);
assert.equal(projection.diagnostics.includes('asset:mesh.demo-cube'), true);
assert.equal(projection.diagnostics.includes('runtime:native'), true);

const command = await exchangeJsonWebSocket(endpoint, fixtures.commandProposal);
assert.equal(command.type, 'command.result');
assert.equal(command.proposal.status, 'accepted');
assert.equal(command.proposal.result.accepted, 1);
assert.equal(command.proposal.authorityHashAfter, 'native-authority:workspace.local:1001:accepted:1');

const afterProjection = await exchangeJsonWebSocket(endpoint, fixtures.projectionPull);
assert.equal(afterProjection.type, 'projection.snapshot');
assert.notEqual(afterProjection.summary.worldHash, projection.summary.worldHash);
assert.equal(afterProjection.summary.worldHash, 'native-world:asha-demo:1001:accepted:1');

const rejectedCommand = await exchangeJsonWebSocket(endpoint, {
  type: 'command.propose',
  sequenceId: 'seq-2',
  batch: {
    commands: [{
      op: 'setVoxel',
      grid: 1,
      coord: { x: 0, y: 0, z: 0 },
      value: { kind: 'solid', material: 999 },
    }],
  },
});
assert.equal(rejectedCommand.type, 'command.result');
assert.equal(rejectedCommand.proposal.status, 'rejected');
assert.equal(rejectedCommand.proposal.reason, 'authority_rejected');
assert.equal(rejectedCommand.proposal.result.accepted, 0);
assert.equal(rejectedCommand.proposal.result.rejected, 1);
assert.equal(rejectedCommand.proposal.authorityHashBefore, command.proposal.authorityHashAfter);
assert.equal(rejectedCommand.proposal.authorityHashAfter, command.proposal.authorityHashAfter);
assert.equal(rejectedCommand.proposal.diagnostics[0].code, 'command_rejected');

const telemetry = await exchangeJsonWebSocket(endpoint, { type: 'telemetry.pull', maxSamples: 8 });
assert.equal(telemetry.type, 'telemetry.snapshot');
assert.equal(telemetry.samples.some((sample) => sample.metric === 'render_op_count'), true);
assert.equal(telemetry.samples.find((sample) => sample.metric === 'command_queue_depth')?.value, 2);
assert.equal(telemetry.samples.find((sample) => sample.metric === 'accepted_command_count')?.value, 1);

const replay = await exchangeJsonWebSocket(endpoint, { type: 'replay.export', replayId: 'dev-smoke-command-path' });
assert.equal(replay.type, 'replay.exported');
assert.equal(replay.artifact.kind, 'replay_export');
assert.equal(replay.artifact.path, 'harness/out/replay/dev-smoke-command-path.json');
assert.match(replay.artifact.sha256, /^sha256:/);

const evidence = await exchangeJsonWebSocket(endpoint, { type: 'evidence.export', sequenceId: 'seq-2', includeRenderDiff: true });
assert.equal(evidence.type, 'evidence.exported');
assert.equal(evidence.artifacts[0].kind, 'evidence_export');
assert.equal(evidence.artifacts[0].path, 'harness/out/devtools/latest/index.json');
assert.match(evidence.artifacts[0].sha256, /^sha256:/);

console.log(JSON.stringify({
  status: 'ok',
  endpoint,
  runtime: handshake.runtime,
  projection: projection.summary,
  command: command.proposal,
  rejectedCommand: rejectedCommand.proposal,
  afterProjection: afterProjection.summary,
  telemetry,
  replay: replay.artifact,
  evidence: evidence.artifacts[0],
}));
