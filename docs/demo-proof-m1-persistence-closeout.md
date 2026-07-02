# Demo proof M1 persistence closeout

Task: `asha#3749`

## Status

M1 workspace persistence foundation is implemented and verified. Source commits
are pending in this working tree; current base commits at closeout time were:

- `asha-studio`: `f070c27`
- `asha`: `21ce38c7`
- `asha-testing`: `db44eff`

## Commands

Run from `/home/dev/asha-studio`:

```bash
pnpm run proof:workspace-open-read
pnpm run proof:scene-save-roundtrip
pnpm run proof:catalog-save-roundtrip
pnpm run proof:persistence-m1
pnpm run check:boundaries
pnpm exec nx test studio-app
```

Run from `/home/dev/asha/ts/packages/game-workspace`:

```bash
npm test
```

Run from `/home/dev/asha-testing`:

```bash
node --test --test-concurrency=1 --test-name-pattern "authoring save contract|authoring public API lanes|M1.1 bounded workspace persistence" tests/scaffold.test.mjs
npm run check:boundary
```

## Artifact readback

Aggregate artifact:

- Path: `asha-studio/artifacts/persistence-m1-proof/latest/index.json`
- Kind: `studio_persistence_m1_proof`
- Hash: `sha256:902f5cd022e7e46cad230c14812ef93005666e80f1e8fcd1d257cbcbc1e9e776`

Child artifacts:

| Kind | Path | File hash | Artifact hash |
| --- | --- | --- | --- |
| `studio_workspace_open_read_proof` | `asha-studio/artifacts/workspace-open-read-proof/latest/index.json` | `sha256:54e4709c2bc0a64f0d3add3be16b2ea70bcd01b9e13195d3c40f931db0328d6c` | `sha256:d135f9b6a9cb6a73d8c88f1ae32abfda344e1afdf10089e91fe9b5c9313c7b69` |
| `studio_scene_save_roundtrip_proof` | `asha-studio/artifacts/scene-save-roundtrip-proof/latest/index.json` | `sha256:99d0fbef5bfa87cc3a1d77817503067b286f27aaa2c9a3f6795f2bd5035469ae` | `sha256:6613ccc9fe65febadefb72f217554287020db1ad9fb7db8d5a8d8693af552cfe` |
| `studio_catalog_save_roundtrip_proof` | `asha-studio/artifacts/catalog-save-roundtrip-proof/latest/index.json` | `sha256:e3023fa50d8cdb9139a28337546fbf40493ce88fae4b38a3b40714fa7b2df17f` | `sha256:49960f6ea1289f5d558826bf6276f16732956ef637cf187f39e35a8d424d13b5` |

Changed file hashes recorded by the aggregate proof:

- Scene before: `null`
- Scene after: `sha256:604a17c20c44291dd927568780f4e6b16e12847e3d9bc1fc1ddcb0639255faed`
- Catalog before: `sha256:d51427117af9d7eefb673cec1a9a555fcb2f7f772950325cc7117d2dc61d1540`
- Catalog after: `sha256:4115d55b39b5d24025cbb17c31953e712a04b24c699175b80925760ce7395042`

## Rules Carried Forward

- Studio opens `asha.game.toml` through the existing bounded workspace loader.
- Workspace open/read enumerates only manifest-declared scene roots and catalog
  package `catalog.json` files.
- Scene saves must target `scenes/*.scene.json`, validate shape, re-read to the
  same hash, and reject stale base hashes, invalid shapes, and disallowed paths.
- Catalog saves must target `packages/game-catalogs/catalog.json`, validate with
  `validateAshaGameAssetCatalog`, re-read to the same hash, preserve stable asset
  ids/hashes, and reject duplicate ids, stale base hashes, invalid asset refs, and
  disallowed paths.
- Proof writes are reversible; the scene temp file is removed and the catalog file
  is restored byte-for-byte after proof execution.

## Non-Claims

M1 does not claim runtime authority, product readiness, hardware GPU evidence,
performance evidence, generated artifact source truth, a private asset database,
or a raw repo crawler.
