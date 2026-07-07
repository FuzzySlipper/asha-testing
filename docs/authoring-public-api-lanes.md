# Authoring public API lanes

Task: `asha#3737`

## Status

Accepted for M0 planning.

## Decision

Studio authoring must use public file-authoring APIs for source saves and public
runtime APIs for runtime command proposals. The two lanes are intentionally
separate.

File-authoring APIs are about committed game-owned source files:

- scene documents under `scenes`;
- catalog documents under `packages/game-catalogs`;
- asset payloads under `assets`;
- future policy documents under `packages/game-policy`.

Runtime command proposals are about a launched runtime session:

- `GameRuntimeSession.proposeCommands`;
- runtime projection/readback;
- replay/evidence export;
- selected backend proof refs.

No M0 operation may hide a file write behind a runtime command, or hide a runtime
mutation behind a file-authoring helper.

## Package and repo ownership

| Lane | Owner | Owns | Does not own |
| --- | --- | --- | --- |
| `@asha/game-workspace` | `/home/dev/asha-engine/ts/packages/game-workspace` | Manifest decode, allowed source-write roots, scene/catalog/asset authoring DTOs, path normalization, validators, save result/readback DTOs. | Runtime execution, Studio UI state, private repo crawling. |
| `@asha/contracts` | `/home/dev/asha-engine/ts/packages/contracts` | Stable engine-facing DTOs such as `FlatSceneDocument`, catalog/material/static-mesh/scene-object DTOs when generated from Rust contracts. | Game workspace policy, Studio read models. |
| `@asha/runtime-bridge` | `/home/dev/asha-engine/ts/packages/runtime-bridge` | Runtime launch/session/projection/command/replay/evidence facade. | Source-file writes, authoring save authority. |
| `asha-testing` | `/home/dev/asha-testing` | Reference consumer, fixtures, proof commands, aggregate evidence, negative smokes. | New ASHA public APIs except by consuming package roots. |
| `asha-demo` | `/home/dev/asha-demo` | Human-facing demos and product-content experiments built on public ASHA surfaces. | Synthetic proof harness identity or ASHA internals. |
| `asha-studio` | `/home/dev/asha-studio` | UI orchestration, deterministic read models, agent/debug surfaces, command dispatch through public identities. | Private asset DB, raw filesystem authority, raw native/WASM transports. |

## Implemented public DTOs

Task `asha#3744` adds the bounded persistence contract to
`@asha/game-workspace` as `authoring-persistence.v0`. The public package-root
surface now includes:

- `AshaAuthoringWriteScope`: normalized allowed root plus forbidden-root
  diagnostics.
- `AshaAuthoringPersistenceContract`: contract version, write scopes, forbidden
  roots, reserved policy diagnostics, and non-claims.
- `AshaAuthoringSaveRequest`: operation kind, relative path, expected previous
  hash, payload, and validation mode.
- `AshaAuthoringSaveResult`: accepted/rejected status, normalized path, previous
  hash, next hash, semantic diff, validation diagnostics, and dependent readback
  hashes.
- `buildAshaAuthoringPersistenceContract`: projects manifest write policy into
  the bounded authoring contract.
- `resolveAshaAuthoringWriteTarget`: normalizes and validates write targets before
  any source write is attempted.

Scene source, catalog wrapper, and asset payload summary DTOs remain follow-up
work for the save execution/readback tasks.

Studio-only read models may wrap these DTOs with UI fields such as selection,
expanded tree rows, pending edit state, or panel-local filter state. Those wrappers
must not become public source-of-truth formats.

## Operation map

| Operation | Public API lane | Command identity | Required fail-closed diagnostics |
| --- | --- | --- | --- |
| Save proof scene source | `@asha/game-workspace` file authoring | `authoring.scene.save_source` | `unsupported_operation`, `disallowed_path`, `stale_file_hash`, `invalid_schema`, `missing_catalog_asset` |
| Save catalog source | `@asha/game-workspace` file authoring | `authoring.catalog.save_source` | `unsupported_operation`, `disallowed_path`, `stale_file_hash`, `invalid_schema`, `missing_asset_file`, `stale_import_metadata`, `asset_dependency_cycle` |
| Save asset payload | `@asha/game-workspace` file authoring | `authoring.asset.save_source` | `unsupported_operation`, `disallowed_path`, `stale_file_hash`, `invalid_schema`, `catalog_entry_mismatch` |
| Save policy source | `@asha/game-workspace` file authoring | `authoring.policy.save_source` | `unsupported_operation` until a policy schema lands |
| Runtime command proposal | `@asha/runtime-bridge` runtime session | existing runtime command batch identities | `runtime_unavailable`, `command_runtime_rejected`, `backend_incompatible`, `missing_backend_proof_ref` |
| Studio debug/readout refresh | `asha-studio` read model projection | no source write | `stale_readback`, `missing_session`, `private_mutation_path` |

## Fail-closed requirements

Every authoring save API must reject with structured diagnostics when:

- the operation kind is unsupported;
- the normalized path is outside the operation's allowed root;
- the expected previous hash does not match the file on disk;
- the payload fails schema validation;
- dependent catalog/scene/asset readback cannot be recomputed;
- the request attempts to write generated/cache/evidence output;
- the request includes a freeform method name, arbitrary JSON command body, or
  private runtime transport hint.

Every runtime proposal API must reject or classify, without source writes, when:

- no compatible runtime session is available;
- selected backend proof refs are missing for native claims;
- the command is rejected by runtime authority;
- the command tries to write source files.

## Boundary rules

- Consumers import package roots only. No `src/**`, generated-path, raw native,
  raw WASM, engine Rust, or sibling-repo private imports.
- Studio sends file-authoring requests to the public authoring API and renders the
  result readback. It does not walk the repo itself.
- Studio sends runtime commands through the public command/runtime lane and records
  timeline evidence. It does not convert runtime success into source-file success.
- `asha-testing` proof scripts may exercise the APIs and write artifacts, but those
  artifacts are evidence, not public API definitions.
