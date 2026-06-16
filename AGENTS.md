# asha-demo boundary rules

`asha-demo` is a boundary-proof and prototype-quarantine repo for ASHA. It is not a product/game repo.

Allowed imports/calls (see `boundary-policy.json` for the machine-readable list):

- `@asha/contracts`
- `@asha/runtime-bridge`
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

The harness writes `harness/out/conformance/latest/index.json` and must keep any missing public operation as an explicit artifact gap rather than using internals.
