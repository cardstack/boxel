// Holds the index query engine on SQLite, the host's in-browser index, to the
// Lean model: the same cards and cases as the Postgres test, over the host's
// schema in `node:sqlite`.
import type { DBAdapter } from '@cardstack/runtime-common';

import { readVectors, VECTOR_FILES } from './conformance.ts';
import { describe, runVectors, seededEngine } from './engine-fixture.ts';
import {
  assertRewritesMatchHost,
  NodeSQLiteAdapter,
} from './sqlite-adapter.ts';

assertRewritesMatchHost();
let failed = false;
for (let file of VECTOR_FILES) {
  let vectors = readVectors(file);
  let adapter = new NodeSQLiteAdapter();
  let engine = await seededEngine(adapter as unknown as DBAdapter, vectors);
  let result = await runVectors(engine, 'sqlite', file, vectors);
  await adapter.close();
  console.log(describe(file, result));
  failed ||=
    result.stale ||
    result.failures.length > 0 ||
    result.disagreements.length > 0 ||
    result.answered.length > 0;
}
process.exitCode = failed ? 1 : 0;
