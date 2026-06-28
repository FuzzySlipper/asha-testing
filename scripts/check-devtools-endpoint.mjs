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

const projection = await exchangeJsonWebSocket(endpoint, fixtures.projectionPull);
assert.equal(projection.type, 'projection.snapshot');
assert.equal(projection.summary.worldHash, 'world:1001:1001');
assert.equal(projection.diagnostics.includes('scene:ASHA Demo Minimal Cube'), true);
assert.equal(projection.diagnostics.includes('asset:mesh.demo-cube'), true);

const command = await exchangeJsonWebSocket(endpoint, fixtures.commandProposal);
assert.equal(command.type, 'command.result');
assert.equal(command.proposal.status, 'accepted');
assert.equal(command.proposal.result.accepted, 1);
assert.equal(command.proposal.authorityHashAfter, 'authority:1001:commands:1');

const afterProjection = await exchangeJsonWebSocket(endpoint, fixtures.projectionPull);
assert.equal(afterProjection.type, 'projection.snapshot');
assert.notEqual(afterProjection.summary.worldHash, projection.summary.worldHash);
assert.equal(afterProjection.summary.worldHash, 'world:1001:1001:commands:1');

const telemetry = await exchangeJsonWebSocket(endpoint, { type: 'telemetry.pull', maxSamples: 8 });
assert.equal(telemetry.type, 'telemetry.snapshot');
assert.equal(telemetry.samples.some((sample) => sample.metric === 'render_op_count'), true);
assert.equal(telemetry.samples.find((sample) => sample.metric === 'command_queue_depth')?.value, 1);

console.log(JSON.stringify({
  status: 'ok',
  endpoint,
  runtime: handshake.runtime,
  projection: projection.summary,
  command: command.proposal,
  afterProjection: afterProjection.summary,
  telemetry,
}));
