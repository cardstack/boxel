#!/usr/bin/env -S node
// Guards the cross-boundary protocol module's defining property: it must be
// evaluable where the Host's module graph is absent — inside a SES Compartment
// and inside an origin-isolated iframe child.
//
// The property is load-bearing and invisible to every existing check. The
// module's only consumers run inside the host app, where the whole graph is
// loaded anyway, so nothing can observe a regression at runtime. Type-only
// imports are erased, so `tsc` is silent. `consistent-type-imports` catches
// dropping `type` from an existing import but says nothing about a newly added
// runtime one — and a single `import { humanReadable } from './code-ref.ts'`
// takes the runtime closure from two modules to over a thousand, pulling in
// ethers wordlists, dompurify and matrix-js-sdk.
//
// So this walks what actually survives compilation: non-type imports and
// re-exports, followed transitively, and holds the closure equal to a recorded
// set. Equal, not a subset — removing a permitted module should be a
// deliberate edit too.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(
  repoRoot,
  'packages/runtime-common/boxel-execution-protocol.ts',
);

// Every module allowed to survive erasure, entry included.
// `card-document-shape.ts` is admissible precisely because it exists to be:
// it type-imports its neighbors and defines its guards inline, so it carries
// no runtime dependency of its own.
const permitted = new Set([
  'packages/runtime-common/boxel-execution-protocol.ts',
  'packages/runtime-common/boxel-execution-protocol/child-formats.ts',
  'packages/runtime-common/boxel-execution-protocol/cloneable.ts',
  'packages/runtime-common/boxel-execution-protocol/component-update.ts',
  'packages/runtime-common/boxel-execution-protocol/instance-projection.ts',
  'packages/runtime-common/boxel-execution-protocol/projected-error.ts',
  'packages/runtime-common/boxel-execution-protocol/refusal.ts',
  'packages/runtime-common/boxel-execution-protocol/runtime.ts',
  'packages/runtime-common/boxel-execution-protocol/safe-event.ts',
  'packages/runtime-common/boxel-execution-protocol/template-bundle.ts',
  'packages/runtime-common/boxel-execution-protocol/type-description.ts',
  'packages/runtime-common/boxel-execution-protocol/untrusted-input.ts',
  'packages/runtime-common/boxel-execution-protocol/version.ts',
  'packages/runtime-common/card-document-shape.ts',
]);

// A specifier survives compilation unless the whole statement is type-only.
// `import { type A, type B }` still emits the module for its side effects, so
// only a leading `import type` / `export type` is erased outright.
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'"();]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function runtimeSpecifiers(source: string): string[] {
  let found = new Set<string>();
  for (let match of source.matchAll(IMPORT)) {
    found.add(match[1]);
  }
  for (let match of source.matchAll(BARE_IMPORT)) {
    found.add(match[1]);
  }
  return [...found];
}

let closure = new Set<string>();
let queue = [entry];
let offenders: string[] = [];

while (queue.length > 0) {
  let file = queue.pop()!;
  let key = relative(repoRoot, file);
  if (closure.has(key)) {
    continue;
  }
  closure.add(key);
  if (!existsSync(file)) {
    offenders.push(`${key} is imported but does not exist`);
    continue;
  }
  for (let specifier of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
    if (!specifier.startsWith('.')) {
      offenders.push(
        `${key} imports the package '${specifier}' at runtime; only type imports may name a package`,
      );
      continue;
    }
    queue.push(resolve(dirname(file), specifier));
  }
}

const actual = [...closure].sort();
const expected = [...permitted].sort();
const unexpected = actual.filter((file) => !permitted.has(file));
const missing = expected.filter((file) => !closure.has(file));

console.log(
  `protocol runtime import closure: ${actual.length} module(s) — ${actual.join(', ')}`,
);

if (unexpected.length > 0) {
  console.error(
    `\nThese modules would be pulled in at runtime by the protocol module:\n` +
      unexpected.map((file) => `  ${file}`).join('\n') +
      `\n\nThe module must be evaluable where the Host's module graph is absent.\n` +
      `Make the import type-only, or argue the addition and record it here.`,
  );
}
if (missing.length > 0) {
  console.error(
    `\nRecorded as permitted but no longer in the closure:\n` +
      missing.map((file) => `  ${file}`).join('\n') +
      `\n\nIf that is intended, remove it from this script in the same commit.`,
  );
}
for (let offender of offenders) {
  console.error(`  ${offender}`);
}

process.exit(unexpected.length + missing.length + offenders.length > 0 ? 1 : 0);
