# Browser interactive gameplay proof contract

Task: `asha#3738`

## Status

Accepted for M0 planning.

## Decision

A browser interactive gameplay proof must demonstrate real browser input flowing
through a typed public ASHA control/command path and producing correlated runtime
or projection readback. A page that only renders marker text or precomputed JSON is
not sufficient.

## Accepted input sources

The proof may use any of these browser-visible input sources:

- keyboard events (`keydown`, `keyup`) dispatched to the browser page;
- mouse or pointer events (`pointerdown`, `pointermove`, `pointerup`, `wheel`);
- gamepad state sampled through the browser Gamepad API when available;
- headless browser automation that dispatches the same DOM events a user would
  trigger.

Synthetic Node-only function calls may prepare fixtures, but they do not count as
browser interaction unless the browser page receives and records DOM input events.

## Typed ASHA mapping

Every accepted input must map to a typed public ASHA request:

| Browser input | Public ASHA path | Required evidence |
| --- | --- | --- |
| Keyboard movement/look/action | `@asha/runtime-bridge` camera or command DTOs | input event log, typed request, before/after projection or camera readback |
| Mouse/pointer look/select/edit | `@asha/runtime-bridge` pick/camera/command DTOs | screen point, viewport size, typed ray/request, hit/no-hit readback |
| Gamepad axis/button | `@asha/runtime-bridge` camera or command DTOs | sampled gamepad state, normalized typed request, before/after readback |
| Headless browser automation | same as user input path | browser event log proving DOM input dispatch, not direct function mutation |

The browser page may call a local adapter, but the adapter must expose typed DTOs
and must not accept arbitrary method names or freeform JSON command bodies.

## Required evidence

A valid browser interaction artifact must include:

- page URL or static artifact path;
- browser/input source classification;
- ordered browser event log with timestamps or deterministic sequence ids;
- typed ASHA request/command DTOs derived from the input;
- before and after projection, camera, selection, command, or render readback;
- replay or command evidence when the interaction mutates runtime authority;
- screenshot or visual hash when the interaction claims visible change;
- readiness markers showing the page was loaded before input;
- proof-content markers that are generated after input, not embedded as static
  success text;
- non-claims for GPU, performance, store/installer/signing, and any runtime mode
  not actually exercised.

The artifact must correlate input sequence ids with readback sequence ids. If a
visual screenshot is used, it must be tied to the same after-readback hash or
command sequence.

## Required negative checks

The proof checker must fail closed when:

- proof markers exist but no browser input event log exists;
- input events exist but no typed ASHA request/command is recorded;
- typed requests exist but no before/after readback changes or classified no-op
  result exists;
- the page imports or depends on `asha-studio`;
- the page reaches into generated/private ASHA package paths instead of public
  package roots;
- the page accepts `call(methodName, json)`, `methodName`, `commandJson`,
  `arbitraryJson`, or equivalent command hatches;
- screenshot/visual hash is stale relative to the after-readback;
- runtime mode claims native/WASM without selected backend proof refs;
- headless automation mutates page globals directly instead of dispatching DOM
  input events.

## Existing prototypes

Current `asha-testing` scripts are useful prototypes but not the complete M0 proof:

- `npm run camera:mover`;
- `npm run camera:agora-control`;
- `npm run voxel:interaction`.

They already show public package imports and fixed browser proof pages. The M0
implementation must add the stricter input event/readback/replay correlation above.

## Non-claims

Browser interaction proof does not imply:

- Studio debug/readout correctness;
- source authoring save correctness;
- native/WASM authority unless the runtime mode and backend proof refs are present;
- hardware GPU acceleration;
- performance evidence;
- store submission, installer, or signing readiness.
