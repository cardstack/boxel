// Holds the reading of a written query to the Lean model of the grammar
// (QueryV2/Grammar.lean): which spelling `usesNewSyntax` reads it in, what
// `assertAuthoredQuerySpelling` and `assertQuery` refuse, and, for a query
// the server accepts, what the matcher returns for it on every card. Also
// holds the model's copies of the grammar table's member lists to the table.
import { readFileSync } from 'fs';
import { isDeepStrictEqual } from 'util';

import { assertQuery } from '@cardstack/runtime-common/query';
import {
  grammarMembers,
  newerSpellingMarkers,
} from '@cardstack/runtime-common/query-grammar';
import {
  assertAuthoredQuerySpelling,
  lowerQuery,
  usesNewSyntax,
} from '@cardstack/runtime-common/query-syntax';

import {
  readVectors,
  report,
  withTypeRefs,
  type Disagreement,
} from './conformance.ts';
import { matcherFor, ref } from './matcher-cards.ts';

interface GrammarCase {
  query: Record<string, any>;
  spelling: 'older' | 'newer';
  authored: string[];
  server: string[];
  expect?: string;
}

const grammar: {
  members: Record<string, string[]>;
  cases: GrammarCase[];
} = JSON.parse(
  readFileSync(new URL('../vectors/grammar.json', import.meta.url), 'utf8'),
);
const vectors = readVectors();
const check = await matcherFor(vectors);
const problems: string[] = [];

const table: Record<string, string[]> = {
  topMarkers: newerSpellingMarkers('query'),
  pageMarkers: newerSpellingMarkers('page'),
  filterMarkers: newerSpellingMarkers('filter'),
  topKnown: grammarMembers('query', (m) => m.form !== 'entry'),
  pageKnown: grammarMembers('page'),
  filterModifiers: grammarMembers('filter', (m) => m.role === 'modifier'),
};
for (let [list, members] of Object.entries(table)) {
  if (
    !isDeepStrictEqual([...members].sort(), [...grammar.members[list]].sort())
  ) {
    problems.push(
      `the model's ${list} is ${JSON.stringify(grammar.members[list])}, the grammar table's ${JSON.stringify(members)}`,
    );
  }
}

function refusal(read: () => void): string | undefined {
  try {
    read();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? `threw ${(e as Error).message}`;
  }
}

// Where the code is known to answer otherwise than the model (which follows
// docs/search.md), each with what it does. Reported, not failed; one that
// no longer occurs fails, so that it is taken off this list.
const KNOWN: {
  about: string;
  applies: (query: Record<string, any>, actual: string | undefined) => boolean;
  seen: number;
}[] = [];

function holds(
  name: string,
  reader: string,
  actual: string | undefined,
  allowed: string[],
  query: Record<string, any>,
) {
  if (actual !== undefined && !allowed.includes(actual) && allowed.length) {
    let known = KNOWN.find((k) => k.applies(query, actual));
    if (known) {
      known.seen++;
      return;
    }
  }
  if (allowed.length === 0 && actual !== undefined) {
    problems.push(
      `${name}: ${reader} refused it (${actual}); the model accepts it`,
    );
  } else if (allowed.length > 0 && actual === undefined) {
    problems.push(
      `${name}: ${reader} accepted it; the model refuses it (${allowed.join(' or ')})`,
    );
  } else if (actual !== undefined && !allowed.includes(actual)) {
    problems.push(
      `${name}: ${reader} refused it with ${actual}; the model with ${allowed.join(' or ')}`,
    );
  }
}

const disagreements: Disagreement[] = [];
let answered = 0;
for (let c of grammar.cases) {
  let query = withTypeRefs(c.query, ref);
  let name = JSON.stringify(c.query);
  let spelling = usesNewSyntax(query) ? 'newer' : 'older';
  if (spelling !== c.spelling) {
    problems.push(
      `${name}: read in the ${spelling} spelling; the model reads it in the ${c.spelling}`,
    );
  }
  holds(
    name,
    'an author’s query',
    refusal(() => {
      assertAuthoredQuerySpelling(query);
      assertQuery(structuredClone(query));
    }),
    c.authored,
    query,
  );
  holds(
    name,
    'the server',
    refusal(() => assertQuery(structuredClone(query))),
    c.server,
    query,
  );

  if (c.expect) {
    let filter =
      spelling === 'newer' ? lowerQuery(query).query.filter : query.filter;
    let found = check(name, spelling, filter ?? { every: [] }, c.expect);
    if (found) {
      answered += vectors.cards.length;
      disagreements.push(...found);
    }
  }
}

console.log(
  `grammar: ${grammar.cases.length} written queries; ${answered} matcher answers checked`,
);
for (let k of KNOWN) {
  if (k.seen) {
    console.log(`known divergence, ${k.seen} reading(s): ${k.about}`);
  } else {
    problems.push(`no longer diverges, take it off the list: ${k.about}`);
  }
}
if (problems.length) {
  console.log(
    `\nthe reading disagrees with the model in ${problems.length} place(s):`,
  );
  console.log(problems.join('\n'));
}
if (disagreements.length) {
  console.log(`\nthe matcher disagrees with the model:`);
  console.log(report(disagreements));
}
process.exitCode = problems.length || disagreements.length ? 1 : 0;
