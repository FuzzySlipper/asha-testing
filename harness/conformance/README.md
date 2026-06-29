# Conformance harness

Task #2539 owns the first `asha-demo` public-boundary conformance harness; V2
keeps it as the compatibility/public-surface proof beside the stronger selected
backend artifacts.

Command:

```bash
npm run conformance
```

Artifact output:

```text
harness/out/conformance/latest/index.json
```

The harness intentionally uses only Tier 1 public packages:

- `@asha/contracts`
- `@asha/runtime-bridge`

Current flow:

1. read `harness/conformance/fixtures/minimal-world.json`;
2. initialize a runtime through the public `@asha/runtime-bridge` facade and probe
   native availability without importing raw transports;
3. load an abstract world fixture through `loadWorldBundle`;
4. submit a generated contract-shaped command through `submitCommands`;
5. step simulation;
6. read public render-diff evidence;
7. save current world summary;
8. write artifact metadata with deterministic state hash, boundary-check result,
   public imports, resolved evidence, and explicit gaps/non-claims.

The stronger V2 native authority proof is intentionally separate:

```text
harness/out/backend-authority-smoke/latest/index.json
harness/out/v2-proof-index/latest/index.json
harness/out/game-workflow-v2/latest/index.json
```

Do not infer hardware GPU, performance, installer, signing, store submission, or
WASM authority from the conformance harness.
