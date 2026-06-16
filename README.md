# asha-demo

`asha-demo` is the separate ASHA reference consumer / boundary-proof repo. It exists to prove that a repo outside `/home/dev/asha` can consume ASHA through curated public engine surfaces only.

It is **not**:

- a product/game repo;
- a future product naming decision;
- a public example marketplace;
- a place to import ASHA internals for convenience;
- a source of product/domain vocabulary for ASHA core.

## Current dependency boundary

V1 is TypeScript/runtime-bridge first. The machine-readable source of truth for the current allow/deny list is `boundary-policy.json`; prose in this README and `AGENTS.md` must agree with that file.

The only ASHA package dependencies in this scaffold are:

- `@asha/contracts` via `file:../asha/ts/packages/contracts`
- `@asha/runtime-bridge` via `file:../asha/ts/packages/runtime-bridge`

`@asha/runtime-bridge` is the only package that may mediate native runtime behavior. `asha-demo` must not import `@asha/native-bridge`, `@asha/wasm-replay-bridge`, ASHA package `src/*` paths, Rust crates, or generated contract files directly.

## Prototype quarantine rule

Prototype tests such as first-person camera movers belong here only when they use public ASHA engine interfaces. If a prototype cannot be expressed through the public facade, file an ASHA engine feature request or temporary adapter request; do not tunnel through internals.

## Commands

```bash
npm test
npm run check:boundary
npm run ci
```

`npm run ci` is also wired into `.github/workflows/boundary.yml`. The boundary check fails closed on unapproved `@asha/*` dependencies/imports, direct ASHA `src/*` path imports, generated-contract file-path imports, generic runtime JSON tunnels, and ASHA Rust crate path dependencies.

## Source-of-truth links

- Den task: `asha#2537`
- Parent Den task: `asha#2533`
- Tier 1 public surface design: `asha/engine-boundary-public-surfaces`
- Engine posture: `asha/asha-in-house-engine-substrate`
