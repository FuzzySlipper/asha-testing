# asha-testing

`asha-testing` owns small synthetic regressions against ASHA's public consumer
surfaces. It is deliberately not a game, Studio substitute, publish pipeline,
or product-acceptance harness.

The repository answers two questions:

1. can an external consumer use an approved public ASHA package without an
   internal import or raw transport tunnel; and
2. does a named public behavior still accept, reject, read back, and replay as
   its contract requires?

It does not answer whether `asha-demo` is playable or whether `asha-studio` is
usable. Those repositories own their visible behavior and acceptance tests.

## Commands

Install the engine workspace and this repository, then run:

```bash
cd ../asha-engine/ts && pnpm install --frozen-lockfile
cd ../../asha-testing && npm install
npm test
```

`npm test` runs the hard import boundary and the focused public-contract suite.
The suite writes an ignored diagnostic artifact under
`harness/out/synthetic/latest/index.json`; computed results are not committed.

`npm run synthetic:native` explicitly requests the optional native provider.
If its addon is absent the result is `unavailable` and the command fails. The
default suite records that optional execution as `not_run`; it does not turn an
unexecuted provider into a green result.

## Claim and execution language

Retained checks are `synthetic_conformance`: they exercise public behavior with
fixtures and may block this repository. They are not `consumer_product_acceptance`.

Optional executions use the shared states established by ASHA task #5852:

- `passed`: the selected behavior executed and its assertions passed;
- `failed`: it executed and a behavioral assertion failed;
- `not_run`: it was not selected;
- `unavailable`: it was selected but a prerequisite was absent;
- `stale`: an expected engine revision did not match the checked-out revision.

See [the disposition ledger](docs/proof-disposition.md) for why each former
proof family was retained, consolidated, migrated, or deleted.
