# Conformance harness

Task #2539 owns the first `asha-demo` public-boundary conformance harness.

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
2. initialize a runtime through the public `@asha/runtime-bridge` mock facade;
3. load an abstract world fixture through `loadWorldBundle`;
4. submit a generated contract-shaped command through `submitCommands`;
5. step simulation;
6. read public render-diff evidence;
7. save current world summary;
8. write artifact metadata with deterministic state hash, boundary-check result, public imports, and explicit gaps.

This is the strongest available proof without cheating through ASHA internals. The artifact records the remaining gaps instead of pretending the full future path exists:

- native authority is unavailable or unwired when the native addon is absent or a native operation fail-closes; this is linked to follow-up task #2559;
- screenshot/headless render evidence is pending task #2509;
- consumer compatibility metadata is pending task #2536.
