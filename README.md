# asha-testing

`asha-testing` is the separate ASHA reference consumer / boundary-proof repo. It exists to prove that a repo outside `/home/dev/asha` can consume ASHA through curated public engine surfaces only.

It is **not**:

- a product/game repo;
- a future product naming decision;
- a public example marketplace;
- a place to import ASHA internals for convenience;
- a source of product/domain vocabulary for ASHA core.

## Current dependency boundary

V2 is selected-backend/runtime-bridge first. The machine-readable source of truth for the current allow/deny list is `boundary-policy.json`; prose in this README and `AGENTS.md` must agree with that file.

The approved ASHA package roots for the game-workflow scaffold are:

- `@asha/contracts` via `file:../asha/ts/packages/contracts`
- `@asha/runtime-bridge` via `file:../asha/ts/packages/runtime-bridge`
- `@asha/devtools` via `file:../asha/ts/packages/devtools` or ASHA public package bundle tarball
- `@asha/game-workspace` via `file:../asha/ts/packages/game-workspace` or ASHA public package bundle tarball

`@asha/runtime-bridge` is the only package that may mediate native runtime behavior. `asha-testing` must not import `@asha/native-bridge`, `@asha/wasm-replay-bridge`, ASHA package `src/*` paths, Rust crates, or generated contract files directly.

Some committed artifact ids, target ids, and fixture game ids still contain
`asha-demo` because they describe the sample product/workspace identity being
tested. Do not read those strings as repo ownership. The human-facing demo repo
is `/home/dev/asha-demo`; synthetic proof harnesses and conformance evidence live
here.

## Prototype quarantine rule

Prototype tests such as first-person camera movers belong here only when they use public ASHA engine interfaces. If a prototype cannot be expressed through the public facade, file an ASHA engine feature request or temporary adapter request; do not tunnel through internals.

Templates:

- `docs/engine-feature-request-template.md` — use when a consumer needs a new ASHA public surface.
- `docs/temporary-adapter-template.md` — use only after planner/steward approval for a short-lived quarantined adapter linked to an engine feature request.

Temporary adapters must have approval, expiry, quarantine location, evidence, review, and removal steps. They must stay in the consumer repo and must not move into ASHA internals.

## Commands

For a fresh checkout, install the ASHA TypeScript workspace first so `@asha/runtime-bridge` can resolve its internal workspace-only transport wrapper while `asha-testing` itself still depends only on Tier 1 public packages:

```bash
cd ../asha/ts && pnpm install --frozen-lockfile
cd ../../asha-testing && npm install
```

Then run:

```bash
npm test
npm run conformance
npm run backend:authority-smoke
npm run camera:mover
npm run dev:smoke
npm run publish:evidence
npm run proof:v2-index
npm run check:boundary
npm run verify:workflow:v2
npm run ci
```

`npm run ci` is also wired into `.github/workflows/boundary.yml`. The workflow checks out `asha` beside `asha-testing` so the local `file:../asha/...` public package dependencies resolve before running the conformance suite. The boundary check fails closed on unapproved `@asha/*` dependencies/imports, direct ASHA `src/*` path imports, generated-contract file-path imports, generic runtime JSON tunnels, and ASHA Rust crate path dependencies.

## Game workspace workflow

The current game-shaped workflow is documented in `docs/game-workflow.md`.

Main commands:

- `npm run check:manifest` validates `asha.game.toml`;
- `npm run backend:authority-smoke` proves the manifest-selected native backend through the public runtime bridge, including accepted/rejected command hashes and normalized reference comparison;
- `npm run dev:smoke` starts the typed devtools runtime and verifies Studio-equivalent attach/projection/telemetry/command flow;
- `npm run publish:artifact` writes `harness/out/publish/latest/index.json`;
- `npm run publish:check` recomputes publish hashes and rejects dev-only Studio/attach leakage;
- `npm run publish:smoke` writes publish smoke evidence;
- `npm run publish:backend-run-smoke` runs the staged native backend artifact without a dev server;
- `npm run publish:evidence` writes the validated publish evidence manifest;
- `npm run proof:v2-index` writes the V2 proof index consumed by closeout;
- `npm run verify:workflow` writes the compatibility aggregate and `npm run verify:workflow:v2` writes the V2 native runtime/publish/Studio aggregate artifact.

Backend mode opt-in lives in `asha.game.toml` under `[runtime]`. A reference-only
consumer must declare `backend_mode = "reference"` and
`backend_profile = "reference"`. A selected runtime-backed consumer declares a
public profile such as `backend_mode = "native"`,
`backend_profile = "native.napi.launcher.v1"`, and at least one
`backend_proof_refs` entry. The manifest validator rejects raw transport hints
such as `@asha/native-bridge`, `native-bridge.node`, WASM memory handles, ASHA
`src/` paths, or `engine-rs/` paths; downstream repos must go through the
`@asha/runtime-bridge` public launcher/facade.

## Conformance harness

`npm run conformance` runs the public-boundary proof and writes `harness/out/conformance/latest/index.json`.

Current strongest available slice:

1. load `harness/conformance/fixtures/minimal-world.json`;
2. initialize `@asha/runtime-bridge` through the public facade and probe native availability through the approved facade path;
3. load the abstract world fixture through `loadWorldBundle`;
4. submit a generated contract-shaped command through `submitCommands`;
5. step simulation and read public render-diff evidence;
6. save current world summary;
7. record deterministic artifact metadata including state hash, boundary-check result, resolved evidence, and explicit non-claims/gaps.

The V2 workflow's stronger native proof lives in:

```text
harness/out/backend-authority-smoke/latest/index.json
harness/out/v2-proof-index/latest/index.json
harness/out/game-workflow-v2/latest/index.json
```

Remaining non-claims are explicit: the workflow is not hardware GPU evidence,
performance evidence, store submission, installer, or package-signing proof.

## Camera mover prototype

`npm run camera:mover` runs the first first-person camera mover boundary scenario and writes `harness/out/camera-mover/latest/index.json`.

Current strongest available slice:

1. load the same minimal abstract world fixture used by the conformance harness;
2. initialize `@asha/runtime-bridge` through the public mock facade;
3. submit a generated contract-shaped command through `submitCommands`;
4. record the intended first-person camera input sequence;
5. inspect the public runtime bridge manifest for camera operations;
6. record deterministic artifact metadata, boundary-check result, and the missing public camera surface feature request.

Explicit gap:

- public camera input/pose/projection surface is absent from the current Tier 1 contracts/runtime bridge; the artifact links Den doc `asha/first-person-camera-public-surface-request` and follow-up task #2561 instead of importing ASHA internals or fabricating movement evidence.

## Source-of-truth links

- Den task: `asha#2537`
- Camera mover task: `asha#2540`
- Camera surface request: `asha/first-person-camera-public-surface-request` / `asha#2561`
- Parent Den task: `asha#2533`
- Tier 1 public surface design: `asha/engine-boundary-public-surfaces`
- Engine posture: `asha/asha-in-house-engine-substrate`
