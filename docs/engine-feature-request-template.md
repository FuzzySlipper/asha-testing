# ASHA engine feature request template

Use this when `asha-demo` or a future consumer cannot complete a task through the current ASHA public surfaces.

Missing public surface ≠ permission to import ASHA internals. File this request before adding a workaround.

## Summary

- Consumer repo/task:
- Requested engine capability:
- Blocking ASHA public surface gap:
- Urgency / task blocked:

## Public surface attempted

- Public package/API/tool tried (`@asha/contracts`, `@asha/runtime-bridge`, approved CLI, etc.):
- Exact command/import/API call attempted:
- Observed failure or missing operation:
- Evidence path/log/artifact:

## Proposed engine surface

- Proposed public surface or verb:
- Input/output shape, using generated contracts where possible:
- Expected fail-closed errors/diagnostics:
- Compatibility or migration impact:

## Authority / projection / contract effects

- Rust authority effect, if any:
- TypeScript expression/projection effect, if any:
- Generated contract change needed? yes/no + details:
- Runtime bridge manifest/facade change needed? yes/no + details:

## Required evidence

- Fixture/golden/replay expected:
- Render/projection evidence expected:
- Downstream conformance update expected:
- Boundary checker expectation:

## Lane ownership guess

- Likely ASHA lane(s): contracts / runtime-bridge / authority / render / tools / docs / other:
- Why this is engine-level rather than product/demo-specific:

## Planner disposition

- Decision: accepted / rejected / needs design / temporary adapter allowed
- Follow-up Den task/doc:
- Notes:
