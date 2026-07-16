# Synthetic-test disposition ledger

This ledger is the terminal inventory for task #5858. `asha-testing` retains a
check only when it protects a named public contract or failure mode. A green
synthetic check never claims a Demo or Studio workflow is delivered.

| Former family | Disposition | Current claim and trigger |
| --- | --- | --- |
| `scripts/run-conformance.mjs`, Agora capture, and its fixture report | Consolidated into `run-public-contract-suite.mjs`; screenshot/report aggregation deleted | Public scene mutation and input replay behavior; run on this repo's CI and relevant public-surface changes |
| camera mover, Agora camera, voxel interaction, and voxel conversion proof scripts/tests | Deleted | They mixed reference behavior with browser/product evidence and duplicated engine provider tests; visible gameplay belongs to Demo |
| browser demo/input/controller scripts and generated HTML proof pages | Deleted | Product-shaped UI evidence had no distinct synthetic contract |
| publish, dev-runtime, Studio attach, round-trip, and V1/V2 evidence-index workflows | Deleted | They certified other artifacts or downstream workflows; Demo/Studio own actual delivery |
| game-shaped manifest, assets, catalog/policy packages, prefabs, and scenes | Deleted | Synthetic contracts construct bounded inputs directly; real game content belongs to Demo |
| product closeout, workflow, publish-target, and Studio-inspector contract docs | Deleted | This ledger and the runnable public-contract suite describe current synthetic claims |
| proof-scene, artifact, evidence-index, and compatibility-report validators | Deleted | Refresh/report-shape maintenance rather than a public behavior |
| boundary policy and negative import/path tests | Retained as a local guardrail | Reject private ASHA paths and raw transports on every `npm test` |
| reference public provider mutation/replay test | Retained and rewritten | Accept current scene mutation, reject stale mutation without state change, deterministic input replay, reject replay reuse |
| optional native provider exercise | Retained as opt-in integration execution | `npm run synthetic:native`; reports `unavailable`/`stale` rather than green when prerequisites do not match |
| engine consumer-needs/reachability/source-token/evidence catalogs (#5857) | Deleted upstream, not migrated | They certify declarations/reports, not a distinct external behavior |
| engine Demo input live wrapper (#5857) | Deleted upstream, not migrated | Demo owns its visible input/pause acceptance |
| engine gameplay-module fixture (#5857) | Converted upstream to an engine-owned public-provider regression | It catches accepted/rejected/replay behavior and is not a claim about another repository |
| Demo product proof artifacts (#5859) | Return to Demo only where they become direct visible acceptance; otherwise delete | No `asha-testing` copy |
| Studio proof/evidence apparatus (#5860) | Return to Studio only where it becomes direct authoring acceptance; otherwise delete | No `asha-testing` copy |

Computed output is ignored under `harness/out/`. No committed file must be
refreshed merely because a test ran.

## Migration qualification

Before the former Studio copies were removed, this task tree ran both
`npm test` and `npm run synthetic:native` successfully against ASHA
`6fb8e7fb5e113382e3a095b8b2157719427e03f5`. The retained behavior was the
public-provider mutation/rejection/readback and resolved-input replay contract;
no Studio UI, private global, or product fixture was copied.

This repository invokes each local suite once and does not add a scheduler or
cache beside ASHA's #5759 execution identities/receipts and #5855 trigger
selection. Engine-owned executions keep their upstream attribution and trigger
placement.
