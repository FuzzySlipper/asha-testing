# Conformance harness placeholder

Task #2537 only creates the separate reference-consumer scaffold. The first real harness is owned by ASHA task #2539.

Expected future flow:

1. initialize runtime through `@asha/runtime-bridge`;
2. load a world bundle / abstract fixture through the public load surface;
3. submit a generated command batch from `@asha/contracts`;
4. verify accepted/rejected typed results;
5. read render diffs or projection evidence through the facade;
6. save world/evidence through public save/export surfaces;
7. emit artifact metadata with ASHA source revision, package versions, command sequence, results, evidence paths, and boundary-check result.

Until #2539 lands, the scaffold test suite records this as an explicit skipped test rather than faking success.
