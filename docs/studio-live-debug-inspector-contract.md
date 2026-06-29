# Studio live debug inspector proof contract

Task: `asha#3739`

## Status

Accepted for M0 planning.

## Decision

Studio live debug inspectors must prove that Studio is observing and controlling a
running demo/runtime through public attach, readout, and command paths. They must
not prove correctness by replaying stale fixtures, reading private transports, or
mutating private Studio state.

## Required inspector surfaces

The M0 live debug proof must expose these surfaces:

| Surface | Required readback |
| --- | --- |
| Scene | scene id/hash, renderable count, selected renderable/entity, scene-object snapshot hash |
| Entity | selected entity id, scene object id, label, provenance, transform, source state |
| Asset | catalog asset id, kind, source path, source hash/import status, referenced renderables |
| Runtime | session id, attach status, runtime mode, backend mode/profile, backend proof refs, runtime entry |
| Debug command | command identity, typed request, accepted/rejected status, before/after hashes, diagnostics |
| Telemetry | sequence id or sample cursor, command counts, projection world hash, render/readback freshness |
| Evidence | child artifact paths/hashes for attach, command proof, browser smoke, and V2 live backend evidence |

Studio may render additional UI state, but proof-critical fields must also be
available as machine-readable readback in the exported artifact.

## Freshness semantics

Every live debug proof must distinguish:

- `attach`: the session handshake/readout from a running demo runtime;
- `read`: the latest scene/entity/asset/runtime projection pulled from that
  session or from Studio's deterministic workspace model;
- `update`: a typed command or inspector action that changes runtime/projection or
  yields a classified no-op/rejection;
- `event`: a browser, devtools, or Studio-originated input event correlated to the
  update.

Freshness requires:

- monotonically increasing sequence ids or explicit stable hashes for reads after
  updates;
- child artifact hashes for attach and command evidence;
- readback timestamp/sequence newer than the attach sequence for live update
  claims;
- selected entity/readout hash matching the viewport or hierarchy selection;
- runtime mode/backend proof refs matching the demo manifest and selected backend
  evidence.

If an inspector reads a committed fixture or generated artifact, it must classify
that row as fixture/reference readback, not live session evidence.

## Allowed debug commands

Allowed M0 debug commands must use existing public identities or later public
authoring/runtime identities:

- `selection.set_active_entity`;
- `entity.set_name`;
- `scene.apply_object_command`;
- `scene.load_asset`;
- `transform.translate_entity` when the public command is available;
- runtime command batch proposals through `GameRuntimeSession.proposeCommands`;
- read/refresh commands that do not mutate source or runtime state.

The inspector may not expose:

- `call(methodName, json)`;
- `methodName`/`commandJson`/`arbitraryJson` hatches;
- private UI-only mutation callbacks;
- raw websocket/native/WASM transport methods;
- source-file writes through runtime debug commands.

## Required negative smokes

The proof checker must fail closed on:

- `missing_live_session`: no attach/readout for the claimed runtime session;
- `stale_fixture_readback`: fixture or generated artifact timestamp/hash used as
  live readback after an update claim;
- `unsupported_debug_command`: command identity outside the public allow list;
- `private_transport_hint`: raw native/WASM/devtools transport path or package;
- `private_mutation_path`: UI-only callback or freeform JSON command hatch;
- `backend_proof_mismatch`: native/WASM claim without matching backend proof refs;
- `inspector_readback_drift`: selected entity/runtime/session readback diverges
  from viewport, hierarchy, or command evidence;
- `stale_child_artifact`: attach/browser/command evidence hash no longer matches
  the referenced artifact.

## Current proof handles

Current handles that can feed the M0 implementation:

- `pnpm run proof:selected-backend-attach` in `asha-studio`;
- `pnpm run proof:selected-backend-command` in `asha-studio`;
- `pnpm run proof:selected-backend-browser-smoke` in `asha-studio`;
- `pnpm run proof:v2-live-backend-evidence` in `asha-studio`;
- `npm run dev:smoke` and `npm run backend:authority-smoke` in `asha-demo`;
- `npm run proof:v2-index` and `npm run verify:workflow:v2` in `asha-demo`.

## Non-claims

Studio live debug proof does not imply:

- Studio is the source-file authoring authority;
- Studio is the runtime authority;
- private ASHA transports are approved;
- hardware GPU or performance evidence;
- store/installer/signing readiness.
