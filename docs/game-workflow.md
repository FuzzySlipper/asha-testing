# ASHA game workflow

`asha-demo` is a boundary-proof reference consumer, not a product game. The workflow below proves that a game-shaped workspace can be created, inspected by Studio, debugged through a typed devtools endpoint, and published into deterministic artifacts without importing ASHA internals.

## Workspace manifest

The entry point is `asha.game.toml`.

- `[asha]` pins ASHA package/protocol compatibility.
- `[workspace]` declares scene, asset, replay, catalog, and policy roots.
- `[runtime]` declares the local dev command and typed devtools endpoint.
- `[studio]` declares whether Studio attach is allowed.
- `[publish]` declares the compiled artifact command and verification command.

Validation:

```bash
npm run check:manifest
```

## Dev runtime and Studio debug

Start the local runtime endpoint:

```bash
npm run dev
```

The runtime exposes the typed `@asha/devtools` attach protocol at the endpoint declared in `asha.game.toml`. Studio uses the same protocol messages as the headless smoke client:

- `handshake.request`
- `projection.pull`
- `render_diff.snapshot`
- `telemetry.pull`
- `command.propose`
- `evidence.export`

Headless verification:

```bash
npm run dev:smoke
```

Output:

```text
harness/out/dev-smoke/latest/index.json
```

The smoke starts the runtime on an ephemeral port, performs a typed handshake, pulls projection/telemetry, proposes a command, verifies the changed projection hash, then shuts the runtime down.

## Publish

Build the compiled publish artifact:

```bash
npm run publish:artifact
```

Output:

```text
harness/out/publish/latest/index.json
```

The artifact includes the parsed workspace manifest, scene/catalog payloads, compiled publish assets, source hashes, compatibility metadata, command metadata, deterministic artifact hash/id, and explicit non-claims.

Strict readback:

```bash
npm run publish:check
```

The checker recomputes the artifact hash, validates manifest/catalog compatibility, verifies compiled asset payload hashes against source files, and rejects dev-only Studio/attach leakage in the publish payload.

Smoke:

```bash
npm run publish:smoke
```

Output:

```text
harness/out/publish-smoke/latest/index.json
```

Evidence manifest:

```bash
npm run publish:evidence
```

Output:

```text
harness/out/publish-evidence/latest/index.json
```

The evidence manifest correlates the compiled artifact, readback summary, smoke checks, dependency guard, deterministic hashes, and non-claims.

## Aggregate local checks

Current focused commands:

```bash
npm test
npm run dev:smoke
npm run publish:evidence
npm run verify:workflow
```

`npm test` includes boundary, manifest, asset, devtools, publish artifact, publish smoke, dependency guard, publish evidence, and aggregate workflow coverage. The explicit smoke/evidence commands are useful when refreshing the latest `harness/out/**` artifacts.

`npm run verify:workflow` writes:

```text
harness/out/game-workflow/latest/index.json
```

That aggregate gate runs manifest/assets/public-artifact checks, boundary check, devtools smoke, publish evidence, and the sibling Studio test/boundary targets that cover the typed attach/readout path.
