# Authoring save contract

Task: `asha#3736`

## Status

Accepted for M0 planning. The bounded M1.1 persistence contract now exists as
`authoring-persistence.v0` in `@asha/game-workspace`.

## Decision

Studio authoring saves must write game-owned source files only. The current M0
source-of-truth formats are:

- `scenes/*.scene.json`: proof-scene source documents with
  `schemaVersion`, `sceneId`, `name`, optional `description`, `catalogAssetIds`,
  and optional `runtimeFixture`.
- `packages/game-catalogs/catalog.json`: an `AshaGameAssetCatalog` document with
  `schemaVersion: 1` and deterministic `entries`.
- `assets/**`: asset source payloads referenced by the catalog, using the existing
  inline fixture formats for static meshes, materials, and textures.
- `packages/game-policy/**`: reserved game-owned policy source root. It is an
  allowed write root, but no M0 authoring API may invent policy schemas without a
  follow-up contract.

Generated/cache/evidence outputs are not authoring source of truth:

- `harness/out/**`;
- `harness/out/dev-cache/**`;
- `harness/out/publish/**`;
- `harness/out/v2-proof-index/**`;
- `node_modules/**`;
- sibling repos such as `../asha-engine`, `../asha-studio`, and private runtime transport
  paths.

## Allowed write roots

The only M0 Studio source-write roots are the roots declared by
`[studio].allowed_source_writes` in `asha.game.toml`:

```toml
allowed_source_writes = ["scenes", "assets", "packages/game-catalogs", "packages/game-policy"]
```

Every save must normalize the requested relative path and fail closed when it:

- is absolute;
- contains `..`;
- resolves outside the repo root;
- resolves outside the allowed root for the operation;
- targets `harness/out`, `node_modules`, `.git`, `../asha-engine`, `../asha-studio`, or
  any raw native/WASM transport path;
- writes a file extension not owned by the selected format.

## Operation ownership

| Operation | Allowed root | Format | Required validator |
| --- | --- | --- | --- |
| Save proof scene | `scenes` | `*.scene.json` | scene schema checks plus catalog id existence against `packages/game-catalogs/catalog.json` |
| Save catalog | `packages/game-catalogs` | `catalog.json` | `validateAshaGameAssetCatalog` with source file existence and source hash checks |
| Save asset payload | `assets` | existing inline `*.mesh.json`, `*.material.json`, `*.texture.json` payloads | catalog entry must name the asset source and kind; payload kind must match entry kind/import profile |
| Save policy file | `packages/game-policy` | deferred | no M0 write until a policy schema contract exists |

Studio may stage an authoring proposal in memory, but committing it must go through
the public `@asha/game-workspace` authoring contract. No private Studio asset
database, raw repo crawler, arbitrary JSON command hatch, or UI-only filesystem
write is approved by this ADR.

No private Studio asset database is approved as a source of truth.

## Validation and readback

Each save command must produce a readback record before reporting success:

- operation id and command identity;
- normalized path;
- allowed root;
- previous file hash or `null` for new files;
- next file hash;
- deterministic semantic diff summary;
- validation diagnostics;
- source manifest hash for `asha.game.toml`;
- catalog hash when a scene or asset save depends on catalog state.

A save is successful only when:

- the written file re-reads byte-for-byte to `nextFileHash`;
- the format validator passes;
- dependent read models re-hash cleanly:
  - catalog saves must refresh asset inventory/publish manifest readback;
  - scene saves must refresh proof-scene readback;
  - asset saves must refresh catalog import metadata or report stale metadata as a
    classified diagnostic instead of silently passing;
- generated proof/cache artifacts are not modified as part of the authoring save.

## Non-claims

This ADR does not approve:

- a browser runtime writing directly to source roots;
- Studio becoming the asset database of record;
- native/WASM runtime authority over source files;
- generated `harness/out/**` artifacts as committed authoring state;
- store submission, installer, signing, hardware GPU, or performance claims.

## Follow-up requirements

Later M0 tasks must define:

- public authoring API package ownership and typed request/result shapes;
- browser interactive proof controls and readback;
- Studio live debug inspector proof fields;
- final round-trip evidence that correlates authoring save, runtime launch, browser
  proof, Studio debug readout, publish, and V2 aggregate evidence.
