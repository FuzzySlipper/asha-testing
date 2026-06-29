# Demo proof M0 contract

Task: `asha#3741`

## Status

M0 contract complete. This document consolidates the M0 proof decisions for the
proper end-to-end ASHA demo proof campaign (`asha#3727`).

## Contract docs

- Inventory: [`demo-proof-m0-inventory.md`](./demo-proof-m0-inventory.md)
  (`asha#3735`).
- Authoring save/write scope:
  [`authoring-save-contract.md`](./authoring-save-contract.md) (`asha#3736`).
- Public authoring API lanes:
  [`authoring-public-api-lanes.md`](./authoring-public-api-lanes.md)
  (`asha#3737`).
- Browser interactive proof:
  [`browser-interactive-proof-contract.md`](./browser-interactive-proof-contract.md)
  (`asha#3738`).
- Studio live debug inspector proof:
  [`studio-live-debug-inspector-contract.md`](./studio-live-debug-inspector-contract.md)
  (`asha#3739`).
- Round-trip evidence:
  [`round-trip-evidence-contract.md`](./round-trip-evidence-contract.md)
  (`asha#3740`).

## Milestone task tree

The Den task tree for `asha#3727` is materialized:

| Milestone | Super task | Child tasks | Dependency state |
| --- | --- | --- | --- |
| M0 capability map and proof contract | `asha#3728` | `asha#3735` - `asha#3741` | ready to close |
| M1 Studio workspace persistence foundation | `asha#3729` | `asha#3744` - `asha#3749` | waits on M0 |
| M2 Studio asset and scene authoring UX proof | `asha#3730` | `asha#3750` - `asha#3757` | waits on M1 |
| M3 Browser interactive gameplay proof | `asha#3731` | `asha#3758` - `asha#3764` | waits on M2 |
| M4 Studio live gameplay debug inspectors | `asha#3732` | `asha#3765` - `asha#3771` | waits on M3 |
| M5 Author-to-runtime round trip | `asha#3733` | `asha#3772` - `asha#3778` | waits on M2/M3/M4 |
| M6 Proper end-to-end demo proof capstone | `asha#3734` | `asha#3779` - `asha#3783` | waits on M5 |

The next implementation task after M0 closes is expected to be `asha#3744`
(`M1.1 Add bounded workspace persistence contract`).

## Anti-stub gates

All later milestone implementation must preserve these M0 gates:

- no raw repo crawler as an authoring API;
- no private Studio asset database;
- no raw native/WASM/devtools transport imports in consumers;
- no arbitrary JSON command hatch;
- no browser marker-only interaction proof;
- no stale fixture readback presented as live debug evidence;
- no generated/cache/evidence artifact treated as authored source;
- no selected native/WASM claim without backend proof refs and fresh child hashes;
- no GPU/performance/store/product/multiplayer claim without separate proof.

## Verification handles

M0 contract docs are covered by the `asha-demo` scaffold tests:

```bash
node --test --test-concurrency=1 --test-name-pattern "M0 demo proof inventory|authoring save contract|authoring public API lanes|browser interactive proof contract|Studio live debug inspector contract|round-trip evidence contract|M0 contract" tests/scaffold.test.mjs
npm run check:boundary
```

Full campaign compatibility remains covered by:

```bash
npm test
npm run verify:workflow:v2
```

## Handoff

Proceed to M1 only after `asha#3728` is marked done. M1 should start with
`asha#3744`, then follow Den dependency order. The implementation should add
bounded public authoring/persistence surfaces before any Studio UI attempts source
file writes.
