# ASHA game workflow V1

`asha-demo` is a boundary-proof reference consumer, not a product game. The V1
workflow proves that a game-shaped workspace can be validated, inspected by Studio,
debugged through typed devtools attach messages, resolved through dev/publish
resource profiles, and published into deterministic runnable evidence without
importing ASHA internals.

## Workspace manifest

The entry point is `asha.game.toml`.

- `[asha]` pins engine, contracts, runtime bridge, devtools, and publish artifact
  compatibility versions.
- `[workspace]` declares scene, asset, replay, catalog, and policy roots.
- `[runtime]` declares the local dev command, typed devtools endpoint, and reference
  runtime entry.
- `[studio]` declares whether Studio attach is allowed and which source roots are
  writable.
- `[publish]` declares `npm run publish:artifact`, `harness/out`, and
  `npm run conformance`.
- `[dev_resource_profile]` resolves source-first local resources into the dev cache.
- `[publish_resource_profile]` resolves locked packed resources into the publish
  output/archive paths.

Validation:

```bash
npm run check:manifest
```

The manifest check verifies required paths, repo-contained resource profile paths,
and manifest-declared command names.

## Assets and proof scenes

Catalog/resource checks:

```bash
npm run check:assets
npm run scene:proof
npm run asset:inventory
npm run verify:assets-v1
```

Important outputs:

```text
harness/out/asset-inventory/latest/index.json
harness/out/assets-v1/latest/index.json
```

`verify:assets-v1` runs manifest, catalog, proof-scene, publish-artifact,
publish-readback, and asset-inventory checks. The aggregate artifact records the
publish resource pack manifest path/hash, inventory entry count, dependency order,
and the fact that dev import metadata and publish packed resources agree.

V1 catalog IDs currently exercised by the proof scene are:

```text
mesh.demo-cube
material.demo-copper
texture.demo-checker
```

## Dev runtime and Studio attach

Start the local reference runtime endpoint:

```bash
npm run dev
```

The runtime exposes the typed `@asha/devtools` attach protocol at the endpoint
declared in `asha.game.toml`. The runtime mode is `reference`; it is deliberately
not native, WASM, GPU, or performance evidence.

Headless verification:

```bash
npm run devtools:smoke
npm run dev:smoke
npm run dev:authority-smoke
```

Important outputs:

```text
harness/out/devtools/latest/index.json
harness/out/dev-smoke/latest/index.json
harness/out/dev-authority-smoke/latest/index.json
```

The dev smoke path performs typed attach/readout work through public protocol
messages:

```text
handshake.request
projection.pull
render_diff.snapshot
telemetry.pull
command.propose
evidence.export
```

`dev:authority-smoke` proves the reference runtime command path more directly:
an accepted command changes the authority/projection hashes, a rejected command
preserves them, and command evidence is checked by
`scripts/check-dev-runtime-command-evidence.mjs`.

## Studio cockpit

Studio is the frontend-heavy public consumer for this workflow. From
`../asha-studio`, the local checks used by the aggregate workflow are:

```bash
pnpm run test
pnpm run check:boundaries
```

The V1 Studio cockpit consumes the same public read models and evidence paths as
the headless workflow. The visible panels are:

- workspace overview/compatibility: `studio-game-workspace-overview`
- asset catalog browser: `studio-assets-panel`
- proof scene list: `studio-proof-scene-panel`
- runtime/preview sessions: `studio-runtime-session-panel`
- command proposals: `studio-command-proposal-panel`
- publish/evidence status: `studio-publish-evidence-panel`
- aggregate cockpit export readout: `studio-workspace-cockpit-evidence`

The command proposal panel displays known `command.propose` actions and accepted
or rejected evidence rows. It does not expose a `call(methodName, json)` escape
hatch, direct state mutation, raw native transport, or private Studio-only retry
path.

The publish panel reads publish evidence as data. Studio does not build, mutate,
or bless publish artifacts; it displays artifact hashes, packed resource status,
dependency guard status, run-smoke projection, command-proof status, diagnostics,
and non-claims.

## Publish artifact and runnable target

V1 runnable target decision:
[`docs/runnable-publish-target.md`](./runnable-publish-target.md).

Build the publish artifact:

```bash
npm run publish:artifact
```

Output:

```text
harness/out/publish/latest/index.json
harness/out/publish/resources/manifest.json
harness/out/publish/runnable/latest/index.html
harness/out/publish/runnable/latest/runtime/reference-runtime.json
harness/out/publish/runnable/latest/resources/manifest.json
```

The publish artifact includes parsed manifest data, scene/catalog payloads,
publish asset manifest, compiled asset payloads, packed resources, runnable static
target metadata, command metadata, deterministic artifact hash/id, compatibility
metadata, and explicit non-claims.

Strict readback:

```bash
npm run publish:check
```

The checker recomputes the artifact hash, validates manifest/catalog compatibility,
checks compiled asset payload hashes against source files, verifies packed runnable
resources, and rejects dev-only Studio/attach leakage such as `@asha-studio`,
`../asha-studio`, `devtools_endpoint`, and localhost devtools URLs.

Publish smoke:

```bash
npm run publish:smoke
npm run publish:run-smoke
```

Outputs:

```text
harness/out/publish-smoke/latest/index.json
harness/out/publish-run-smoke/latest/index.json
```

`publish:smoke` validates build/readback correlation, packed resource profile
output, and dependency guard status. `publish:run-smoke` launches the static
reference runnable without a dev server and verifies reference runtime metadata,
resource resolution, projection readback, accepted-command mutation, rejected-command
preservation, and the absence of a required devtools endpoint.

## Publish evidence manifest

Generate and check the publish evidence manifest:

```bash
npm run publish:evidence
npm run publish:evidence-check
```

Output:

```text
harness/out/publish-evidence/latest/index.json
```

The evidence manifest has:

```text
evidenceKind: asha_demo_publish_evidence_manifest
evidenceVersion: publish-evidence.v1
```

It correlates:

- publish artifact path, file hash, artifact id/hash, artifact version, compiled
  asset count, publish asset count, runnable target, entrypoint hash, and resource
  pack manifest hash;
- publish smoke path/hash, checks, readback artifact hash, packed resources, and
  dependency guard result `no-studio-dev-only-fragments`;
- publish run-smoke path/hash, runnable artifact metadata, `runtimeMode: "reference"`,
  projection world hash, accepted/rejected command proof, resolved resource count,
  and checks;
- validations including `runtime_projection_readback_present`,
  `packaged_command_proof_present`, and `studio_dev_only_dependency_guard_passed`;
- non-claims including `not_native_runtime_authority`,
  `not_hardware_gpu_evidence`, `not_performance_evidence`, and
  `not_store_submission`.

## Aggregate local checks

Current focused commands:

```bash
npm test
npm run dev:smoke
npm run publish:evidence
npm run verify:workflow
npm run verify:workflow:v1
```

`npm test` runs the Node test suite plus the demo boundary check. It covers
manifest, assets, devtools, runtime evidence, publish artifact, publish smoke,
publish evidence, negative/fail-closed cases, and aggregate workflow behavior.

`npm run verify:workflow` writes the compatibility aggregate:

```text
harness/out/game-workflow/latest/index.json
```

`npm run verify:workflow:v1` writes the V1 aggregate:

```text
harness/out/game-workflow-v1/latest/index.json
```

The V1 aggregate gate runs:

```text
npm run check:manifest
npm run check:public-artifacts
npm run check:boundary
npm run verify:assets-v1
npm run dev:authority-smoke
npm run publish:evidence
npm run publish:evidence-check
pnpm run test                 # in ../asha-studio
pnpm run check:boundaries     # in ../asha-studio
pnpm exec nx typecheck studio-app  # in ../asha-studio
```

The V1 aggregate artifact records runtime authority evidence, child artifact refs
and hashes, assets V1/resource pack refs, publish target/run-smoke refs, Studio
cockpit source markers, validation names, and workflow non-claims. It fails closed
if child artifact hashes are stale or required Studio cockpit markers are missing.

## Non-claims

V1 evidence is intentionally narrow.

- `runtimeMode: "reference"` means deterministic reference runtime evidence only.
- Native runtime evidence requires an explicit native proof reference and approved
  public runtime-bridge path.
- WASM authority evidence requires an explicit WASM proof reference and approved
  public path.
- Browser or Studio screenshots are not hardware GPU evidence or performance
  evidence.
- Publish artifacts and publish evidence are not store submission, installer,
  package signing, multiplayer, native services, or production product claims.
- Studio panels are readout/control surfaces over public ASHA contracts. They are
  not the runtime authority, publish builder, asset database of record, or private
  mutation channel.

## Troubleshooting

- If `npm run check:manifest` fails, check `asha.game.toml` paths and command names
  before touching scripts.
- If asset checks fail, run `npm run check:assets`, `npm run scene:proof`, and
  `npm run asset:inventory` to isolate catalog, proof-scene, or inventory drift.
- If dev smoke fails, inspect `harness/out/dev-smoke/latest/index.json` and the
  devtools endpoint command in `[runtime]`.
- If publish readback fails, rerun `npm run publish:artifact` and then
  `npm run publish:check`; stale hashes or dev-only fragments are expected to fail
  closed.
- If publish evidence fails, run `npm run publish:evidence-check` against
  `harness/out/publish-evidence/latest/index.json` and compare its referenced
  publish, smoke, and run-smoke artifacts.
- If `verify:workflow` fails on Studio, run `pnpm run test` and
  `pnpm run check:boundaries` in `../asha-studio`.
