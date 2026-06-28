# asha-demo boundary rules

`asha-demo` is a boundary-proof and prototype-quarantine repo for ASHA. It is not a product/game repo.

Allowed imports/calls (see `boundary-policy.json` for the machine-readable list):

- `@asha/contracts`
- `@asha/runtime-bridge`
- `@asha/devtools`
- `@asha/game-workspace`
- approved ASHA CLI/tool commands documented by the current task
- `@asha/renderer-three` only when a future task explicitly marks it as an unstable demo/render-evidence surface and updates the boundary policy accordingly

Forbidden:

- no imports from ASHA internal crate/package source paths;
- no direct dependency on ASHA state/sim/services/rules/render/native/WASM internals;
- no `@asha/native-bridge` imports;
- no `@asha/wasm-replay-bridge` runtime imports;
- no hand edits or local forks of generated contracts;
- no raw JSON/runtime escape hatches;
- no demo/product nouns added to ASHA core to make a prototype pass.

If the public ASHA surface cannot express the test, create an engine feature request or temporary adapter request. Do not tunnel through internals.

## Missing public surface workflow

1. Try the current public surface first (`@asha/contracts`, `@asha/runtime-bridge`, `@asha/devtools`, `@asha/game-workspace`, or an approved ASHA CLI/tool command).
2. If blocked, fill out `docs/engine-feature-request-template.md` and post/link it in the ASHA Den project. The request must explain the consumer use case, attempted public interface, missing capability, proposed engine surface, authority/projection/contract effects, required evidence, lane guess, and why the request is engine-level rather than demo/product-specific.
3. Use `docs/temporary-adapter-template.md` only when a planner/steward explicitly approves a short-lived adapter. The adapter must link the engine feature request, include approval and expiry, live only in this consumer repo, carry evidence for why it was needed, and include review/removal steps.
4. Missing public surface is never permission to import ASHA internals, raw native/WASM transports, generated file paths, or arbitrary JSON/runtime tunnels.

Required local/pre-merge command:

```bash
cd ../asha/ts && pnpm install --frozen-lockfile
cd ../../asha-demo && npm install
npm run ci
```

For the conformance harness specifically:

```bash
npm run conformance
```

For the first-person camera mover boundary scenario:

```bash
npm run camera:mover
```

For game-workspace dev/debug/publish workflow evidence:

```bash
npm run dev:smoke
npm run publish:evidence
npm run verify:workflow
```

See `docs/game-workflow.md` for the manifest, Studio attach, devtools, publish, smoke, and evidence-manifest flow.

The camera mover scenario writes `harness/out/camera-mover/latest/index.json`. Until ASHA has a public camera input/pose/projection surface, it must record the missing-surface engine feature request instead of importing internals or faking movement evidence.

The harness writes `harness/out/conformance/latest/index.json` and must keep any missing public operation as an explicit artifact gap rather than using internals.
