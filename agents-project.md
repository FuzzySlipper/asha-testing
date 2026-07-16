# ASHA Testing Local Bootstrap

`asha-testing` owns focused synthetic regressions against public ASHA consumer
surfaces. It is not a product/game repository and must not claim that Demo
gameplay or Studio authoring is delivered.

Use Den project ID `asha`; tag tasks with `asha-testing` and the relevant public
surface.

## Boundary

- Import approved package roots from `boundary-policy.json` only.
- Do not import engine source paths, raw native/WASM transports, generated file
  paths, or Rust authority internals.
- A missing public capability becomes an upstream Den task, not a local tunnel.
- Synthetic fixtures may use the documented reference backend. They never
  become product authority or product acceptance.

## Test posture

Keep a test only when it names a concrete public contract or failure mode.
Prefer direct behavioral assertions over evidence catalogs, screenshots,
source-token checks, or reports that certify other reports.

Distinguish:

- **local guardrail**: import and repository-boundary policy;
- **provider regression**: accepted/rejected commands, readbacks, call counts,
  replay, and deterministic public outcomes;
- **synthetic conformance**: an external fixture exercising a public surface;
- **consumer acceptance**: visible Demo or Studio behavior, owned downstream.

Computed results belong under ignored `harness/out/` or in Den/CI evidence. Do
not commit refresh-only result files.

Optional prerequisites report `passed`, `failed`, `not_run`, `unavailable`, or
`stale`. Only an executed, current result may be `passed`.

## Commands

```bash
npm test
npm run synthetic
npm run synthetic:native
```
