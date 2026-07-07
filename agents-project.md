# ASHA Testing Local Bootstrap

`asha-testing` is a boundary-proof and prototype-quarantine repo for ASHA. It is not a product/game repo. The human-facing demo repo is `/home/dev/asha-demo`; keep proof harnesses, conformance evidence, and negative smokes here unless a task explicitly asks for product-demo work.

Use Den project ID `asha` for tasks, messages, documents, librarian queries, and guidance lookups. When creating or updating Den tasks from this repo, tag them with `asha-testing` plus any lane/system tags.

## Satellite repo boundary

This is a satellite repo. Do **not** jump into `/home/dev/asha-engine` and implement upstream engine changes as part of an `asha-testing` task, even when the task is blocked by a missing or broken ASHA surface.

If the public ASHA surface cannot express the test or proof:

1. Stop the local implementation at the satellite boundary.
2. Create a Den task in project `asha` for the upstream `asha-engine` change, tagged with `asha-engine` and `asha-testing`.
3. Link the upstream task from the blocked `asha-testing` task/message.
4. Mark the satellite task `blocked` with blocker summary, attempted remedies, and the upstream task ID.
5. Wait for the upstream task to land before continuing. Do not tunnel through internals or carry a local engine patch in this repo.

## Allowed imports/calls

See `boundary-policy.json` for the machine-readable list. Current intended public surfaces include:

- `@asha/contracts`
- `@asha/runtime-bridge`
- `@asha/devtools`
- `@asha/game-workspace`
- approved ASHA CLI/tool commands documented by the current task
- `@asha/renderer-three` only when a task explicitly marks it as an unstable demo/render-evidence surface and updates boundary policy accordingly

## Forbidden

- no imports from ASHA internal crate/package source paths;
- no direct dependency on ASHA state/sim/services/rules/render/native/WASM internals;
- no `@asha/native-bridge` imports;
- no `@asha/wasm-replay-bridge` runtime imports;
- no hand edits or local forks of generated contracts;
- no raw JSON/runtime escape hatches;
- no demo/product nouns added to ASHA core to make a prototype pass;
- no upstream engine work performed directly from this satellite repo task.

## Missing public surface workflow

1. Try the current public surface first (`@asha/contracts`, `@asha/runtime-bridge`, `@asha/devtools`, `@asha/game-workspace`, or an approved ASHA CLI/tool command).
2. If blocked, fill out `docs/engine-feature-request-template.md` and post/link it in the ASHA Den project. The request must explain the consumer use case, attempted public interface, missing capability, proposed engine surface, authority/projection/contract effects, required evidence, lane guess, and why the request is engine-level rather than demo/product-specific.
3. Use `docs/temporary-adapter-template.md` only when a planner/steward explicitly approves a short-lived adapter. The adapter must link the engine feature request, include approval and expiry, live only in this consumer repo, carry evidence for why it was needed, and include review/removal steps.
4. Missing public surface is never permission to import ASHA internals, raw native/WASM transports, generated file paths, or arbitrary JSON/runtime tunnels.

## Local commands

```bash
cd ../asha-engine/ts && pnpm install --frozen-lockfile
cd ../../asha-testing && npm install
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
