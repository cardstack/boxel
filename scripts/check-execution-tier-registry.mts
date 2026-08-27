#!/usr/bin/env -S node
// Makes a tier adapter visible to the record-parity harness (RP-14.4).
//
// The harness compares the records every tier produces, and it can only compare
// tiers it was handed. Writing a second `BoxelRuntime` implementation does not
// wire it in, and omitting that step fails nothing: the harness reports parity
// across the tiers it knows, so an unregistered adapter is not a red test but an
// absent one. Competing record builders that each agree with themselves and not
// with each other is the failure this guards, and it is invisible to every
// per-tier suite, because each of those agrees with its own builder.
//
// So the set of `BoxelRuntime` implementations under `packages/` is held EQUAL
// to the list recorded below, each entry naming the mode it implements. An
// implementation appearing fails the build until someone records it, which is
// the moment to hand that mode to `checkRecordParity`. One disappearing fails
// too, because a harness expecting a mode nothing implements reports that tier
// absent on every run.
//
// Two independent signals, because a check that enumerates syntaxes stops
// working the first time someone writes a form it does not list:
//
//   1. `implements` / `satisfies` naming the interface. Neither has a reading
//      other than "this is an implementation".
//   2. A file defining most of the interface's operations as its own members.
//      No syntax is involved and the interface need not be named, so this
//      covers a class expression, a decorated class, an object literal a
//      factory in another file returns, and whatever the next form is. Every
//      source file is read for it rather than only those mentioning the
//      interface: an adapter assembled by a factory elsewhere never mentions
//      it, and skipping those files is what made the claim below false the
//      first time it was written.
//
// A bare type annotation — `const x: BoxelRuntime`, or a return type — is
// deliberately NOT a signal. Those forms read identically on an implementation
// and on a consumer: a wrapper takes and returns one, a service exposes one
// through a getter, an interface declares a factory method producing one.
// Treating them as implementations fails the build for all three, and the
// remedy such a failure prints — register this mode with the harness — is
// meaningless for them, so the list would accumulate entries that are not tiers
// until it stopped meaning anything. An adapter built by a factory is caught by
// signal 2 instead, in whichever file defines the operations.
//
// What this cannot see, and does not claim to:
//
//   - an implementation that both names the interface nowhere AND defines few
//     operations of its own, because it inherits them;
//   - one that defines its operations *dynamically* — assigning them in a loop
//     over `BOXEL_RUNTIME_OPERATIONS`, or dispatching by name in a `switch` —
//     which names none of them textually. The protocol exports that list for
//     dispatch by name, so this is a shape it invites, and a transport-backed
//     adapter is the likeliest place for it;
//   - anything under a `tests` directory, skipped so a test double is not
//     mistaken for a tier.
//
// What it over-reads, all by signal 2 and all because textually they define the
// operations: a wrapper forwarding most of the interface to an inner runtime; a
// consumer that destructures the operations out of a runtime under the same
// names, or calls them bare rather than through a member access; a type-only
// structural mirror of the interface; and a stub outside a `tests` directory.
// The lookbehind separates a member-access call from a definition —
// `runtime.projectInstance(handle)` is a consumer — and does not separate a
// bare call or a renamed destructure.
//
// It is a tripwire on how an adapter is actually written, not a proof that none
// exists — and it holds files rather than behavior: recording an entry says
// someone looked, not that the mode reached `checkRecordParity`. Comment
// detection is line-local, for the reasons `check-rp-bijection.mts` gives at
// length.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scanRoot = join(repoRoot, 'packages');

// Every file implementing a tier runtime, and the mode each one implements.
// Each entry should be a mode `checkRecordParity` is given as registered.
const registered = new Map<string, string>([
  ['packages/host/app/lib/direct-boxel-runtime.ts', 'direct'],
]);

// Directories with no source of ours in them, a copy of it that is not the one
// that ships, or — for `tests` — implementations that stand in for a tier
// rather than being one.
const skipDirectories = new Set([
  'node_modules',
  'dist',
  'tmp',
  'coverage',
  '.git',
  'declarations',
  'tests',
]);

// A declaration file declares types and implements nothing, and generated
// mirrors of this repo's own source are declaration files — `bundled-types`
// holds a copy of the protocol module's own `runtime.ts`, which declares all
// eight operations and sits outside the exclusion below.
const SOURCE = /\.(ts|gts|mts)$/;
const DECLARATION_FILE = /\.d\.(ts|mts)$/;

// The module that declares the interface, which is therefore not an
// implementation of it: its own body defines all eight operations, and its
// operation list names them again. Compared with a separator, so a sibling whose
// name merely begins with the same characters is still scanned — the directory
// beside the protocol module is exactly where an adapter would sit.
const declaringDirectory = join(
  'packages',
  'runtime-common',
  'boxel-execution-protocol',
);

// `implements` may list more than one interface, so the match runs to the class
// body rather than to the next identifier.
const DECLARES_RUNTIME = [
  /\bimplements\b[^{;]*\bBoxelRuntime\b/,
  /\bsatisfies\s+BoxelRuntime\b/,
];

/**
 * The operations an implementation has to define, read out of the protocol's
 * own list rather than repeated here — a copy would drift, and a drifted copy
 * lowers the bar silently.
 */
function runtimeOperations(): string[] {
  let source = readFileSync(
    join(repoRoot, declaringDirectory, 'runtime.ts'),
    'utf8',
  );
  let list = /BOXEL_RUNTIME_OPERATIONS\s*=\s*\[([^\]]*)\]/.exec(source);
  let names = list
    ? [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    : [];
  if (names.length === 0) {
    console.error(
      `Could not read BOXEL_RUNTIME_OPERATIONS out of ${declaringDirectory}/runtime.ts.\n` +
        `The operation-shape signal is inert without it; fix the reader rather ` +
        `than leaving the check running on one signal.`,
    );
    process.exit(1);
  }
  return names;
}

const operations = runtimeOperations();

// Two thirds of the interface. Not all of it: an adapter part-way through being
// written, or one inheriting a couple of operations, is exactly what this should
// catch. The lookbehind is what separates defining an operation from calling
// one — `runtime.projectInstance(handle)` is a consumer.
const operationThreshold = Math.ceil((operations.length * 2) / 3);
const DEFINES_OPERATION = operations.map(
  (name) => new RegExp(`(?<![.\\w$])${name}\\s*[(:=]`),
);

function* walk(dir: string): Generator<string> {
  for (let entry of readdirSync(dir)) {
    if (skipDirectories.has(entry)) {
      continue;
    }
    let full = join(dir, entry);
    let stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (SOURCE.test(entry) && !DECLARATION_FILE.test(entry)) {
      yield full;
    }
  }
}

function withoutComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let withoutSpans = line.replace(/\/\*.*?\*\//g, ' ');
      return /^\s*(\/\/|\*|\/\*|\{\{!)/.test(withoutSpans) ? '' : withoutSpans;
    })
    .join('\n');
}

function implementsRuntime(source: string): boolean {
  if (DECLARES_RUNTIME.some((pattern) => pattern.test(source))) {
    return true;
  }
  return (
    DEFINES_OPERATION.filter((pattern) => pattern.test(source)).length >=
    operationThreshold
  );
}

let found: string[] = [];
for (let file of walk(scanRoot)) {
  let path = relative(repoRoot, file);
  if (
    path === `${declaringDirectory}.ts` ||
    path.startsWith(`${declaringDirectory}${sep}`)
  ) {
    continue;
  }
  let raw = readFileSync(file, 'utf8');
  if (implementsRuntime(withoutComments(raw))) {
    found.push(path);
  }
}
found.sort();

const unexpected = found.filter((file) => !registered.has(file));
const missing = [...registered.keys()]
  .sort()
  .filter((file) => !found.includes(file));

console.log(
  `execution tier adapters: ${found.length}${found.length === 0 ? '' : ` — ${found.join(', ')}`}`,
);

if (unexpected.length > 0) {
  console.error(
    `\nThese files implement a BoxelRuntime the record-parity harness does not know about:\n` +
      unexpected.map((file) => `  ${file}`).join('\n') +
      `\n\nA tier the harness is not handed is a tier RP-14.4 does not hold to\n` +
      `anything. Pass its mode to checkRecordParity as a registered mode, and\n` +
      `record the file here against that mode in the same change.\n` +
      `If it implements no tier, the signal that matched it is too broad —\n` +
      `narrow the signal rather than recording a file that is not an adapter.`,
  );
}
if (missing.length > 0) {
  console.error(
    `\nRecorded as a tier adapter but not implementing a BoxelRuntime:\n` +
      missing.map((file) => `  ${file} (${registered.get(file)})`).join('\n') +
      `\n\nA harness expecting a mode nothing implements reports that tier\n` +
      `absent on every run. Drop it from the registered modes and from this\n` +
      `script together.`,
  );
}

process.exit(unexpected.length + missing.length > 0 ? 1 : 0);
