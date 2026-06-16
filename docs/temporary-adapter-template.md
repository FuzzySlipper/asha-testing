# ASHA temporary adapter request / record template

Use this only when an engine feature request exists but the consumer task needs a short-lived quarantine adapter before the real ASHA surface lands.

Temporary adapter ≠ permission to move hacks into ASHA internals. It must live in the consumer repo, expire, and be removed.

## Linked engine feature request

- Engine feature request Den task/doc:
- Consumer repo/task blocked:
- Missing public ASHA surface:

## Approval

- Approving planner/steward:
- Approval date:
- Allowed scope:
- Explicit non-goals:

## Expiry

- Expiry condition/date:
- Replacement engine task/surface:
- Removal owner:

## Quarantine location

- Consumer repo path:
- Boundary checker changes needed? yes/no + details:
- Labels/tags to apply: `temporary-adapter`, linked feature request ID
- Statement: this adapter must not move into ASHA internals.

## Evidence for why adapter is needed

- Public interface attempted:
- Failure/missing capability evidence:
- Why waiting for engine change blocks the current task:

## Adapter guardrails

- Must use generated contracts where possible.
- Must not import ASHA internal crate/package/source paths.
- Must not call raw native/WASM transports.
- Must not introduce product/demo vocabulary into ASHA core.
- Must fail closed if the underlying public surface changes.

## Review / removal checklist

- Adapter has tests or conformance evidence:
- Engine feature task is linked in code comments/docs:
- Expiry review scheduled:
- Removal PR/task created when engine surface lands:
- Boundary checker passes after removal:

## Current status

- active / expired / replaced / removed:
- Last review date:
- Notes:
