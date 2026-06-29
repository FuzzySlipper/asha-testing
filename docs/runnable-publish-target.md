# Runnable publish target V1

This document fixes the V1 runnable publish target for `asha-demo`. It is intentionally
boring: a static browser bundle with a deterministic resource pack and a tiny local
HTTP smoke. It is not an Electron package, store package, native runtime bundle, or
performance proof.

## Decision

The V1 runnable artifact target is:

```text
asha-demo-static-reference.v1
```

It is a self-contained static directory produced under the manifest's publish resource
profile:

```text
harness/out/publish/runnable/latest/
  index.html
  runtime/
    reference-runtime.json
  resources/
    manifest.json
    <packed assets>
  evidence/
    publish-artifact.json
    publish-smoke.json
    dependency-guard.json
```

The runnable entrypoint is `index.html`. It loads only static files from the artifact
directory and displays the reference runtime projection/evidence readback. The target
uses `runtimeMode: "reference"` until a later native/runtime-bridge proof is approved.

## Relationship To Publish Readback

The publish pipeline still writes a deterministic JSON readback at:

```text
harness/out/publish/latest/index.json
```

That artifact is an evidence input and index for the runnable target. V1 adds a
static layout under `harness/out/publish/runnable/latest/` around the same manifest,
resource profile, asset manifest, hashes, non-claims, and smoke results.

## Required Manifest Inputs

The runnable target consumes these manifest fields:

- `[publish] command`, `artifact_dir`, and `verify_command`
- `[publish_resource_profile] output_dir`, `archive_dir`, and `resolution_policy = "locked"`
- `[dev_resource_profile] local_roots`, `cache_dir`, and `resolution_policy = "prefer-source"`

Publish output and archive paths must not point into dev-local workspace roots. The
static runnable may copy packed resources, but it must not load `assets/`,
`packages/game-catalogs/`, `scenes/`, or other source roots directly.

## Smoke Expectations

The V1 runnable smoke does:

- serve `harness/out/publish/runnable/latest/` over local HTTP;
- open `index.html` with an HTTP-only readback checker;
- verify the resource manifest, packed asset hashes, and runtime projection marker;
- prove `runtimeMode: "reference"` with explicit non-claims;
- fail closed if any static file references dev-only source roots or Studio attach paths.

## Evidence Expectations

The runnable artifact must retain:

- source manifest hash;
- scene id and catalog asset ids;
- resource profile id/path summary;
- packed resource manifest hash;
- publish artifact hash;
- smoke artifact hash;
- dependency guard result;
- non-claims: `not_native_runtime_authority`, `not_hardware_gpu_evidence`,
  `not_performance_evidence`, and `not_store_submission`.

## Non-Goals

V1 does not claim native authority, WASM authority, GPU/hardware rendering, performance,
store submission readiness, installer/package signing, or live multiplayer/runtime
services. Those require separate proof handles and must not be inferred from a static
reference runnable.
