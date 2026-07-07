# Round-trip evidence contract

Task: `asha#3740`

## Status

Accepted for M0 planning.

## Decision

The final M0 capstone proof must correlate one authored-file change through
browser/runtime execution and Studio live debug readback. The proof is an evidence
index over child artifacts, not a new runtime dependency or private Studio data
store.

## Artifact vocabulary

| Stage | Artifact kind | Path |
| --- | --- | --- |
| Authoring save | `asha_demo_authoring_save_evidence` | `harness/out/authoring-save/latest/index.json` |
| Browser gameplay | `asha_demo_browser_interaction_evidence` | `harness/out/browser-interaction/latest/index.json` |
| Studio live debug | `asha_demo_studio_live_debug_evidence` | `harness/out/studio-live-debug/latest/index.json` |
| Round-trip correlation | `asha_demo_round_trip_evidence` | `harness/out/round-trip/latest/index.json` |
| Capstone aggregate | `asha_demo_m0_capstone_verification` | `harness/out/m0-capstone/latest/index.json` |

The capstone aggregate must also reference existing V2 handles:

- `harness/out/v2-proof-index/latest/index.json`;
- `harness/out/game-workflow-v2/latest/index.json`;
- `../asha-studio/artifacts/v2-runtime-proof/latest/index.json`.

## Required hashes and readbacks

The authoring save artifact must record:

- normalized source path;
- allowed write root;
- previous file hash or `null`;
- saved file hash;
- manifest hash;
- dependent catalog/proof-scene/asset inventory hashes;
- semantic diff hash;
- validation diagnostics hash.

The browser gameplay artifact must record:

- page/static artifact path and page hash;
- browser event log hash;
- typed ASHA request/command hash;
- runtime loaded resource manifest hash;
- projection/world hash before and after interaction;
- authority hash before and after mutation when runtime authority is changed;
- replay or command evidence hash;
- screenshot or visual hash when visible change is claimed.

The Studio live debug artifact must record:

- attach artifact hash;
- selected runtime session id/hash;
- scene/entity/asset/runtime/debug/telemetry readback hashes;
- command evidence hash for any allowed debug command;
- freshness marker proving readback happened after attach/update;
- V2 live backend evidence hash.

The round-trip evidence artifact must record:

- the authored file hash loaded by runtime or browser;
- browser interaction sequence id;
- runtime projection/authority/replay hashes;
- Studio attach/read/update/event sequence ids;
- matching scene/entity/asset identifiers across authoring, browser, runtime, and
  Studio readback;
- all child artifact paths/hashes.

## Capstone checks

The capstone checker must fail closed on:

- stale child artifact hash;
- saved file hash mismatch;
- runtime resource hash mismatch;
- projection hash mismatch;
- authority/replay hash mismatch;
- browser event log missing or marker-only interaction;
- Studio live debug readback older than attach/update;
- selected entity/readback drift across browser and Studio;
- missing backend proof refs for native/WASM claims;
- private transport hint or arbitrary command hatch;
- generated/cache/evidence output treated as authored source.

## Required non-claims

Every round-trip and capstone artifact must include:

- `not_hardware_gpu_evidence`;
- `not_performance_evidence`;
- `not_store_submission`;
- `not_installer`;
- `not_package_signing`;
- `not_product_readiness`;
- `not_multiplayer_evidence`;
- `not_private_transport`;
- `not_runtime_den_dependency`.

Selected native backend proof may be claimed only when backend mode, backend
profile, backend proof refs, and runtime/projection/command hashes are all fresh.
WASM authority remains a non-claim until a public WASM runtime facade and proof refs
exist.

## Relationship to existing artifacts

The M0 capstone should consume, not replace:

- `npm run verify:workflow:v2`;
- `npm run proof:v2-index`;
- `npm run publish:evidence`;
- `pnpm run evidence:v2-live-backend` in `asha-studio`.

V1 aggregate compatibility must remain runnable, but the M0 capstone may require
the V2 selected-backend proof stack.
