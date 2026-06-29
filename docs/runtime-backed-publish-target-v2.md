# Runtime-backed publish target V2

This document pins the V2 runtime-backed publish target for `asha-demo`.
It is a staged selected-backend artifact, not a browser/WASM target and not an
installer, store package, signing flow, or production bundle.

## Decision

The V2 selected-backend publish artifact target is:

```text
asha-demo-staged-backend-native.v2
```

The target packages the deterministic publish resource pack together with public
runtime metadata and selected-backend evidence refs. It does not embed a raw native
transport, private engine path, or Studio devtools endpoint. The current approved
selected backend is the manifest-declared native profile:

```text
backend_mode = "native"
backend_profile = "native.napi.launcher.v1"
backend_proof_refs = ["proof:dev-authority-smoke"]
```

WASM remains a deferred target until a public WASM runtime facade and proof refs
are approved. Browser-only static reference publishing remains the V1 target in
[`docs/runnable-publish-target.md`](./runnable-publish-target.md).

## Staged Artifact Layout

The V2 artifact is written under the publish artifact directory:

```text
harness/out/publish/backend-native/latest/
  manifest.json
  runtime/
    runtime-metadata.json
    backend-profile.json
    module-ref.json
  resources/
    manifest.json
    <packed assets>
  evidence/
    backend-authority-smoke.json
    dev-runtime-command-evidence.json
    publish-artifact.json
    publish-smoke.json
    dependency-guard.json
  readback/
    index.json
```

The staged artifact is an evidence-addressed directory. Later work may wrap it in
an archive, installer, signed package, or store submission only through a separate
explicit task and proof. Those formats must not be inferred from this target.

## Required Contents

The layout must include:

- manifest summary: game id, engine/runtime/publish compatibility versions, and
  manifest hash;
- backend profile: backend mode, backend profile id, selected launcher name,
  runtime entry, backend module ref, and public backend proof refs;
- packed resources: publish resource manifest, dependency order, packed resource
  paths, hashes, and byte counts;
- runtime metadata: runtime mode, runtime profile id, bridge compatibility, non-claims,
  and command/replay/evidence export support;
- evidence refs: backend authority smoke, dev runtime command evidence, publish
  artifact, publish smoke, dependency guard, and any generated readback hash;
- readback index: deterministic artifact id/hash, child file hashes, validations,
  diagnostics, and non-claims.

The backend module ref is a public artifact reference, not a raw import path. It
may identify an approved runtime-bridge profile/module by id and hash, but it must
not contain `@asha/native-bridge`, `native-bridge.node`, ASHA engine Rust paths,
private package `src/**` paths, or generated contract file paths.

## No-dev-server Smoke Requirements

The V2 smoke must run from the staged artifact without the dev server and without
the manifest devtools endpoint.

Required smoke checks:

- load `readback/index.json`, `runtime/runtime-metadata.json`, and
  `resources/manifest.json` from the staged artifact directory;
- verify all child file hashes and packed resource hashes;
- verify backend mode/profile/proof refs match the source manifest and backend
  authority evidence;
- start or simulate only through the approved public runtime-bridge launcher surface
  for the staged backend profile;
- submit one accepted and one rejected command through the public command proposal
  path, proving accepted authority/projection hash change and rejected hash
  preservation;
- export replay/evidence refs through the public facade;
- fail if any file references dev-only roots, Studio packages, localhost devtools
  URLs, raw native/WASM transports, or private ASHA internals.

The smoke must fail closed on missing backend proof refs, mismatched backend mode,
stale packed resource hashes, stale command/evidence hashes, missing replay/evidence
refs, unsupported backend mode, or any private transport hint.

## Evidence Expectations

The V2 publish evidence manifest should reference:

- staged backend artifact path and artifact hash;
- publish resource manifest path and hash;
- backend authority smoke path and hash;
- dev runtime command evidence path and hash;
- accepted/rejected command before/after authority hashes;
- runtime metadata path and hash;
- no-dev-server smoke path and hash;
- dependency guard result;
- diagnostics and validation names.

The no-dev-server smoke is:

```bash
npm run publish:backend-run-smoke
```

It writes:

```text
harness/out/publish-backend-run-smoke/latest/index.json
```

Required non-claims:

- `not_wasm_authority`;
- `not_hardware_gpu_evidence`;
- `not_performance_evidence`;
- `not_store_submission`;
- `not_installer`;
- `not_package_signing`;
- `not_private_runtime_transport`.

The target may claim selected native backend evidence only when the artifact carries
public backend proof refs and fresh command/evidence readback. It must not claim
hardware GPU, performance, store readiness, installer readiness, package signing,
or WASM authority.

## Relationship To V1

V1 remains `asha-demo-static-reference.v1`: a browser static reference runnable.
V2 is `asha-demo-staged-backend-native.v2`: a staged native backend artifact with
packed resources and runtime evidence. Both targets may share resource pack inputs,
but their runtime claims, smoke requirements, and non-claims are different.
