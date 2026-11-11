import QUnit from 'qunit';
const { module, test } = QUnit;
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { PgAdapter } from '@cardstack/postgres';
import {
  FilterRefersToNonexistentTypeError,
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  SEARCH_TEXT_KEY,
  SearchRequestError,
  VectorSerializer,
  VirtualNetwork,
  assertQuery,
  facetFieldSpecsOf,
  hasVectorIndex,
  internalKeyFor,
  logSearchResponse,
  parseSearchEntryQueryFromPayload,
  query as runSql,
  rri,
  searchEntryWireQueryFromQuery,
  syncLogFile,
  type Definition,
  type DefinitionLookup,
  type Expression,
  type LogLineIndexHost,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';
import {
  lowerQuery,
  usesNewSyntax,
} from '@cardstack/runtime-common/query-syntax';
import { applyServerSearchPageBound } from '@cardstack/runtime-common/search-bounds';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// The adversarial sweep of the query language: hostile and broken input at
// every entry point that accepts a query. The standard is a database's own
// query language. No input may crash, hang, change state, run anything, or
// surface a raw database or JavaScript error: every input is a valid query
// with a correct answer, or it is refused with a coded error.
//
// Everything is deterministic. Random cases come from a seeded generator, and
// every failure names its seed, so it fails again the same way.
//
// One function, `survives`, checks a case at each entry point:
//   assertQuery            the grammar check every surface runs
//   lowerQuery             the newer spellings' lowering, reached as its
//                          callers reach it (only for a query that uses them)
//   wire                   parseSearchEntryQueryFromPayload, for JSON input
//   engine                 engine.searchCards, for a query the grammar accepts,
//                          under the page bound the server applies first
//   select / log           the table and log forms, where a case names them
// and holds it to the invariant:
//   1. it returns, or throws a query error with a documented code;
//   2. it finishes within the hang bound;
//   3. a refusal's message carries no SQL, stack, path or other row's value;
//   4. rows are fixture rows, and a value lookup returns exactly the rows a
//      plain JavaScript filter over the fixture returns;
//   5. the index is unchanged (checked after every group).
//
// Each group collects what it finds and asserts once at its end, so one run
// lists every hole instead of stopping at the first.

// ---------------------------------------------------------------------------
// The documented refusal codes (docs/search.md "Refusals", and the list in
// invalid-query-error.ts).
// ---------------------------------------------------------------------------

const DOCUMENTED_CODES = new Set([
  'unknown-key',
  'unknown-field',
  'invalid-value',
  'missing-member',
  'conflicting-members',
  'limit-exceeded',
  'invalid-nesting',
  'invalid-type',
  'needs-type',
  'sort-needs-type',
  'needs-declaration',
  'needs-postgres',
  'matches-required',
  'engine-only',
  'invalid-expression',
  'expression-placement',
  'expression-unsupported',
  'unknown-function',
  'unknown-binding',
  'binding-kind',
  'vector-space-mismatch',
  'policy-linked-from',
  'invalid-page',
  'invalid-json',
  'invalid-filter',
  'not-selectable',
  'select-excludes-fields',
]);

// How long any one entry point may take with one input before it counts as a
// hang. Not a performance bound: the slowest honest case here takes a small
// fraction of it.
const HANG_MS = 8_000;
// How many generated cases with no expected rows a group runs against the
// database (cases with expected rows always run).
const DB_SAMPLE = 150;

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const dateRef = ref('@cardstack/base/date', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const T = ref(`${testRealm}specimen`, 'Specimen');
const K = ref(`${testRealm}keyword`, 'Keyword');

const CANARY_SECRET = 'canary-value-9f2c41d7';
const SENTINEL_FILE = join(tmpdir(), `query-fuzz-sentinel-${process.pid}`);
// A secret in the environment that gives itself away as a number: its length
// (613) and its value (0.000713) are numbers nothing in the fixture makes.
const ENV_SECRET = `0.000713${'0'.repeat(605)}`;

// The strings a hostile caller sends. Each is the `label` of one Specimen (and
// a tag of the next one), so a query that looks for one has a right answer:
// the engine treats it as data and finds exactly the rows that hold it.
const HOSTILE_VALUES: string[] = [
  // SQL
  `Robert'); DROP TABLE boxel_index;--`,
  `' OR '1'='1`,
  `1; SELECT pg_sleep(30)--`,
  `x' UNION SELECT url, search_doc FROM boxel_index--`,
  `$$; COPY boxel_index TO PROGRAM 'touch ${SENTINEL_FILE}'; $$`,
  `$1`,
  `C:\\temp\\`,
  `E'\\x27'`,
  `\uFF07 OR \uFF071\uFF07=\uFF071`,
  `" || true)`,
  `100%`,
  `100 percent`,
  `a_b`,
  `axb`,
  `a & b | !c <-> d:*`,
  // spreadsheet formulas and error literals
  `=1+1`,
  `+SUM(A1:B2)`,
  `-2+3`,
  `@SUM(1)`,
  `\t=cmd|' /C calc'!A0`,
  `\r=HYPERLINK("http://example.invalid")`,
  `#DIV/0!`,
  `#N/A`,
  `#NAME?`,
  `#NULL!`,
  `#NUM!`,
  `#REF!`,
  `#VALUE!`,
  `#SPILL!`,
  `#CALC!`,
  // encodings
  `Cr\u00E8me`, // NFC
  `Cre\u0300me`, // NFD
  `\uFEFFbom`,
  `z\u0300\u0301\u0302\u0303\u0304\u0305`,
  `zero\u200Bwidth\u200Djoiner`,
  `\u202Eevil\u202C`,
  `\u0440\u0430\u0443\u0440\u0430l`, // "paypal" in Cyrillic look-alikes
  `paypal`,
  `\uFF11\uFF12\uFF13\uFF21\uFF22\uFF23`, // full-width 123ABC
  `\u0130stanbul`,
  `istanbul`,
  `\u0131stanbul`,
  `stra\u00DFe`,
  `strasse`,
  `\uFB01nal`, // "fi" ligature
  `\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u{1F1EF}\u{1F1F5} \u{1F44D}\u{1F3FD}`,
  `\u{1D11E}mid\u{1D11E}`,
  `\uFFFD`,
  `bell\u0007tab\tline\nend`,
  `%27%20OR%201%3D1`,
  `JyBPUiAxPTE=`,
  `&lt;script&gt;&#39;`,
  `%2527`,
  // JavaScript
  '${7*7}',
  '`${globalThis.__queryFuzzCanary = "pwned"}`',
  `</script><script>globalThis.__queryFuzzCanary="pwned"</script>`,
  `javascript:alert(1)`,
  `constructor.constructor('return process')()`,
  `__proto__`,
  // words the language or the database reserves
  `null`,
  `true`,
  `select`,
  `undefined`,
  `NaN`,
  // relative-date look-alikes: literals anywhere but a date range
  `now`,
  `now-1d`,
  // a date that is not one
  `2024-13-45 not a date`,
  // one long token
  `L${'o'.repeat(3000)}ng`,
  `canary`,
];

interface Specimen {
  n: number;
  url: string;
  label: string;
  note: string;
  code: string;
  tags: string[];
  amount: number;
  rating: number | null;
  day: string | null;
  embedding: number[] | null;
  secret: string | null;
}

// Codes hold the characters globs and regular expressions give meaning to.
const SPECIAL_CODES = [
  'a*b',
  'a?b',
  'a.b',
  'a+b',
  '(a+)+$',
  '[x]',
  'a\\b',
  'a%b',
  // a long run for a backtracking pattern to chew on
  `${'a'.repeat(4000)}!`,
];

const SPECIMENS: Specimen[] = HOSTILE_VALUES.map((label, n) => ({
  n,
  url: `${testRealm}Specimen/s${String(n).padStart(2, '0')}`,
  label,
  note: n % 4 === 0 ? `plain note ${n}` : `lighthouse keeper ${n}`,
  code:
    n < SPECIAL_CODES.length
      ? SPECIAL_CODES[n]
      : `C-${String(n).padStart(3, '0')}`,
  // the previous row's label is a tag here, so every hostile string is also
  // inside a list
  tags: [
    ['red', 'green', 'blue'][n % 3],
    HOSTILE_VALUES[(n + HOSTILE_VALUES.length - 1) % HOSTILE_VALUES.length],
    ...(n % 5 === 0 ? [] : ['shared']),
  ],
  amount: n,
  rating: n % 6 === 5 ? null : n % 5,
  day: n % 7 === 6 ? null : `2026-0${1 + (n % 9)}-1${n % 10}`,
  embedding: n % 3 === 2 ? null : [1, (n % 7) / 7, (n % 4) / 4],
  secret: label === 'canary' ? CANARY_SECRET : null,
}));

// A type whose fields are named with words SQL, JavaScript and the query
// language reserve. A query on them must work like a query on any field.
const SAFE_KEYWORD_FIELDS = [
  'select',
  'from',
  'where',
  'null',
  'true',
  'false',
  'default',
  'user',
  'current_user',
  'order',
  'Order',
  'group',
  'table',
  'i',
  'le',
  'fv',
  'search_doc',
  'url',
  'realm_url',
  'types',
  'undefined',
  'NaN',
  'filter',
  'sort',
  'on',
  'type',
  'eq',
  'not',
  'any',
  'every',
  'item',
  'by',
  'near',
  'page',
  'this',
  'cardURL',
  'lastModified',
];
// Names every JavaScript object already answers to. Seeded in a second pass,
// so a writer that trips on them does not take the whole fixture with it.
const INHERITED_KEYWORD_FIELDS = [
  'constructor',
  'prototype',
  'hasOwnProperty',
  'toString',
  'valueOf',
  'length',
  'then',
];
let keywordFields: string[] = [
  ...SAFE_KEYWORD_FIELDS,
  ...INHERITED_KEYWORD_FIELDS,
];
const KEYWORD_ROWS = 9;
// `Order` and `order` differ only by case, so their values differ in step.
const keywordValue = (field: string, n: number) =>
  `${field}-${(n + (field === 'Order' ? 1 : 0)) % 3}`;
const keywordUrl = (n: number) => `${testRealm}Keyword/k${n}`;

// Every field but a vector is a facet: the fuzzer tests what a query does
// with its values, not which fields declare one.
function primitive(
  fieldOrCard: ResolvedCodeRef,
  extra: Record<string, unknown> = {},
) {
  let search = extra.search as Record<string, unknown> | undefined;
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...extra,
    ...(extra.serializerName === 'vector'
      ? {}
      : { search: { ...(search ?? {}), facet: true } }),
  };
}

const specimenDef = {
  type: 'card-def',
  codeRef: T,
  displayName: 'Specimen',
  fields: {
    label: 'f0',
    note: 'f1',
    code: 'f2',
    tags: 'f3',
    amount: 'f4',
    rating: 'f5',
    day: 'f6',
    embedding: 'f7',
    secret: 'f8',
  },
  fieldDefs: {
    f0: primitive(stringRef, { search: { role: 'title', typos: true } }),
    f1: primitive(stringRef, { search: { role: 'body' } }),
    f2: primitive(stringRef, {
      search: { role: 'identifier', patterns: true },
    }),
    f3: { ...primitive(stringRef), type: 'containsMany' },
    f4: primitive(numberRef, {
      serializerName: 'number',
      search: { rank: 'popularity' },
    }),
    f5: primitive(numberRef, { serializerName: 'number' }),
    f6: primitive(dateRef, { serializerName: 'date' }),
    f7: primitive(vectorRef, {
      serializerName: 'vector',
      search: { neighbors: true },
    }),
    f8: primitive(stringRef),
  },
} as unknown as Definition;

function keywordDef(): Definition {
  return {
    type: 'card-def',
    codeRef: K,
    displayName: 'Keyword',
    fields: Object.fromEntries([
      ...keywordFields.map((name, i) => [name, `k${i}`]),
      ['rank', 'rank'],
    ]),
    fieldDefs: Object.fromEntries([
      ...keywordFields.map((_name, i) => [`k${i}`, primitive(stringRef)]),
      ['rank', primitive(numberRef, { serializerName: 'number' })],
    ]),
    // what every card type inherits from CardDef's `static indexFields`
    indexFields: {
      _type: { search: { facet: true } },
      _realm: { search: { facet: true } },
      createdAt: { search: { facet: true } },
      lastModified: { search: { facet: true } },
      _cardType: { search: { facet: true } },
    },
  } as unknown as Definition;
}

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef?.module === T.module && codeRef?.name === T.name) {
        return specimenDef;
      }
      if (codeRef?.module === K.module && codeRef?.name === K.name) {
        return keywordDef();
      }
      // what the realm's own lookup raises for a type that does not exist
      throw new FilterRefersToNonexistentTypeError(codeRef);
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

// A log, for the `from: { log }` form.
const LOG_PATH = 'Audit/trail.jsonl';
const LOG_URL = `${testRealm}${LOG_PATH}`;
const LOG_ACTIONS = [
  'like',
  'skip',
  `'; DROP TABLE boxel_log_lines;--`,
  `=1+1`,
  '100%',
  'a_b',
  'save',
  'like',
];
const LOG_LINES = LOG_ACTIONS.map((action, i) =>
  JSON.stringify({
    at: `2026-11-10 06:0${i}:00`,
    actor: i % 2 ? '@ada:localhost' : '@bo:localhost',
    what: JSON.stringify({ action, weight: i }),
  }),
);

// ---------------------------------------------------------------------------
// The plain evaluation: what a value lookup must return, computed here from
// the fixture and nothing else.
// ---------------------------------------------------------------------------

const idsWhere = (holds: (s: Specimen) => boolean) =>
  SPECIMENS.filter(holds).map((s) => s.url);
const ALL_SPECIMENS = SPECIMENS.map((s) => s.url);
const ALL_KEYWORDS = Array.from({ length: KEYWORD_ROWS }, (_, n) =>
  keywordUrl(n),
);
const FIXTURE_IDS = new Set([...ALL_SPECIMENS, ...ALL_KEYWORDS]);

// Case differences in ASCII letters only: what "ignoring case" means without
// dispute. A string with other letters is checked only for the rows that hold
// it exactly (see `contains` below).
const asciiFold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
// The widest folding a database might apply: compatibility forms, accents,
// case, the dotless and dotted i, the sharp s.
const wideFold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u00df/g, 'ss');
// eslint-disable-next-line no-control-regex
const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
// Text that Postgres text and jsonb cannot hold: a null byte, or a surrogate
// with no partner.
const isUnstorable = (s: string) =>
  s.includes('\u0000') ||
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    s,
  );
const isRelativeDateLike = (s: string) =>
  /^now([+-]\d+[smhdwMy])?(\/[smhdwMy])?$/.test(s);

// A glob over a whole value, ignoring ASCII case, path-aware: `*` is any run
// within one `/` segment, `**` (two or more `*`) any run at all, `?` one
// character other than `/`, everything else itself (docs/search.md,
// `pattern`).
function globMatches(glob: string, value: string): boolean {
  // `**…` as one token, U+E000 standing for it (a glob the oracle checks is
  // ASCII)
  let p = [...asciiFold(glob).replace(/\*{2,}/g, '\uE000')];
  let v = [...asciiFold(value)];
  let memo = new Map<number, boolean>();
  let go = (i: number, j: number): boolean => {
    let key = i * (v.length + 1) + j;
    let hit = memo.get(key);
    if (hit !== undefined) return hit;
    let out: boolean;
    if (i === p.length) out = j === v.length;
    else if (p[i] === '\uE000')
      out = go(i + 1, j) || (j < v.length && go(i, j + 1));
    else if (p[i] === '*')
      out = go(i + 1, j) || (j < v.length && v[j] !== '/' && go(i, j + 1));
    else
      out =
        j < v.length &&
        (p[i] === '?' ? v[j] !== '/' : p[i] === v[j]) &&
        go(i + 1, j + 1);
    memo.set(key, out);
    return out;
  };
  return go(0, 0);
}

// ---------------------------------------------------------------------------
// A fixed pseudo-random sequence (mulberry32).
// ---------------------------------------------------------------------------

function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <X>(next: () => number, list: readonly X[]): X =>
  list[Math.floor(next() * list.length)];

// ---------------------------------------------------------------------------
// Large inputs are written as recipes and built where they are checked, so a
// megabyte string or a structure ten thousand levels deep is never printed,
// copied or serialized by the test itself.
//   { $text: [unit, count] }           unit repeated
//   { $seq: [count, prefix] }          [prefix0, prefix1, …]
//   { $keys: count }                   an object with that many members
//   { $nest: [wrap, depth, leaf] }     leaf wrapped depth times: 'not',
//                                      'every', 'any', '[]' or 'obj'
// ---------------------------------------------------------------------------

const RECIPE_KEYS = ['$text', '$seq', '$keys', '$nest'];
function isRecipe(v: unknown): boolean {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  let keys = Object.keys(v);
  return keys.length === 1 && RECIPE_KEYS.includes(keys[0]);
}
function hasRecipe(v: unknown, depth = 0): boolean {
  if (v == null || typeof v !== 'object' || depth > 40) return false;
  if (isRecipe(v)) return true;
  return Object.values(v).some((x) => hasRecipe(x, depth + 1));
}
function build(v: any): any {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(build);
  if (isRecipe(v)) {
    if ('$text' in v) return String(v.$text[0]).repeat(v.$text[1]);
    if ('$seq' in v) {
      return Array.from({ length: v.$seq[0] }, (_, i) => `${v.$seq[1]}${i}`);
    }
    if ('$keys' in v) {
      let out: Record<string, number> = {};
      for (let i = 0; i < v.$keys; i++) out[`k${i}`] = i;
      return out;
    }
    let [wrap, depth, leaf] = v.$nest;
    let out = build(leaf);
    for (let i = 0; i < depth; i++) {
      out =
        wrap === 'not'
          ? { not: out }
          : wrap === 'every' || wrap === 'any'
            ? { [wrap]: [out] }
            : wrap === '[]'
              ? [out]
              : { a: out };
    }
    return out;
  }
  let out: Record<string, unknown> = {};
  for (let key of Object.keys(v)) out[key] = build(v[key]);
  return out;
}

// The same checks in a thread of their own, for a large input: a check that
// never returns is then stopped and reported instead of taking the run with
// it. The thread builds the input from its recipe.
const PROBE_THREAD = `
const { parentPort } = require('node:worker_threads');
const RECIPE_KEYS = ['$text', '$seq', '$keys', '$nest'];
function isRecipe(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  let keys = Object.keys(v);
  return keys.length === 1 && RECIPE_KEYS.includes(keys[0]);
}
function build(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(build);
  if (isRecipe(v)) {
    if ('$text' in v) return String(v.$text[0]).repeat(v.$text[1]);
    if ('$seq' in v) return Array.from({ length: v.$seq[0] }, (_, i) => v.$seq[1] + i);
    if ('$keys' in v) { let o = {}; for (let i = 0; i < v.$keys; i++) o['k' + i] = i; return o; }
    let [wrap, depth, leaf] = v.$nest;
    let out = build(leaf);
    for (let i = 0; i < depth; i++) {
      out = wrap === 'not' ? { not: out }
        : wrap === 'every' || wrap === 'any' ? { [wrap]: [out] }
        : wrap === '[]' ? [out] : { a: out };
    }
    return out;
  }
  let out = {};
  for (let key of Object.keys(v)) out[key] = build(v[key]);
  return out;
}
(async () => {
  const q = await import('@cardstack/runtime-common/query');
  const syntax = await import('@cardstack/runtime-common/query-syntax');
  const entry = await import('@cardstack/runtime-common/search-entry');
  const utils = await import('@cardstack/runtime-common/search-utils');
  const bxl = await import('@cardstack/bxl/compiler');
  const run = {
    assertQuery: (input) => { q.assertQuery(input); },
    lowerQuery: (input) => {
      if (syntax.usesNewSyntax(input)) {
        syntax.lowerQuery(input, { knownFunctions: bxl.BXL_FORMULA_FUNCTIONS });
      }
    },
    wire: (input) => { entry.parseSearchEntryQueryFromPayload(input); },
  };
  parentPort.on('message', ({ id, entry: name, recipe }) => {
    let started = Date.now();
    let out;
    try {
      run[name](build(recipe));
      out = { ok: true };
    } catch (e) {
      let kind = e instanceof q.InvalidQueryError ? 'query'
        : e instanceof utils.SearchRequestError ? 'request' : 'raw';
      out = {
        ok: false,
        thrown: {
          kind,
          name: String(e && e.name),
          code: kind === 'query' ? e.code : kind === 'request' ? e.queryCode : undefined,
          requestCode: kind === 'request' ? e.code : undefined,
          message: String(e && e.message).slice(0, 2000),
        },
      };
    }
    out.ms = Date.now() - started;
    parentPort.postMessage({ id, out });
  });
  parentPort.postMessage({ ready: true });
})().catch((e) => parentPort.postMessage({ boot: String((e && e.stack) || e) }));
`;

// ---------------------------------------------------------------------------
// Cases, outcomes and the invariant
// ---------------------------------------------------------------------------

type Entry =
  | 'assertQuery'
  | 'lowerQuery'
  | 'wire'
  | 'engine'
  | 'engine (wire)'
  | 'select'
  | 'log'
  | 'state';

interface Thrown {
  kind: 'query' | 'request' | 'raw';
  name: string;
  // the grammar's code: InvalidQueryError's `code`, a request error's
  // `queryCode`
  code?: string;
  requestCode?: string;
  message: string;
  sqlstate?: string;
}

type Probe =
  | { ok: true; value?: any; ms: number }
  | { ok: false; thrown: Thrown; ms: number }
  // still running at the hang bound; `stopped` when it then stopped on being
  // cancelled, as a search does when its time budget runs out
  | { hang: true; stopped?: boolean };

interface Case {
  // reproduces the case: the group, the generator's seed and the case number
  seed: string;
  // the query, in the card grammar (a recipe tree for a large input)
  input: any;
  // said in place of the input where it cannot be printed
  label?: string;
  // the wire payload, when it is not the input itself; false for an input
  // that is not JSON
  wire?: any;
  // the wire payload is `wire` whatever it is (null and false included)
  wireAsGiven?: boolean;
  // the case is about its wire payload alone: the input is not checked
  wireOnly?: boolean;
  // the input holds values that must not be read before the checks read
  // them (a getter that counts its reads, a Proxy that throws)
  inProcess?: boolean;
  // true always runs the case against the database when the grammar accepts
  // it, false never does; otherwise a sample of the group's cases runs
  db?: boolean;
  // A search may run until the time budget stops it, where that budget is
  // the documented bound (a slow pattern): being cancelled at the hang bound
  // and stopping is then an answer, not a failure.
  budgetIsEnough?: boolean;
  // the realm searched, when it is not the fixture's
  realm?: string;
  expect?: {
    // the rows a value lookup returns, by url; `ordered` when order matters
    ids?: string[];
    ordered?: boolean;
    // at least these rows, where the exact set is not decided
    atLeast?: string[];
    // beside `ids`: rows that may come back or not, the rule being undecided
    maybe?: string[];
    // the grammar refuses it, with this code (or any documented one)
    refused?: string | true;
    // the refusal names this
    suggests?: string;
    // the grammar accepts it
    accepted?: boolean;
    // Expected rows are an answer, so a refusal in their place is a failure,
    // unless the case allows one: any coded refusal (true), or this code.
    orRefused?: true | string;
    // the table a `select` answers with, without its id column
    table?: unknown[][];
  };
}

type FailureKind =
  | 'state'
  | 'crash'
  | 'raw'
  | 'hang'
  | 'rows'
  | 'leak'
  | 'uncoded'
  | 'expectation';

interface Failure {
  kind: FailureKind;
  entry: Entry;
  seed: string;
  input: string;
  what: string;
}

function show(c: Pick<Case, 'input' | 'label'>): string {
  let text: string | undefined;
  if (!c.label) {
    try {
      text = JSON.stringify(c.input);
    } catch {
      // a cycle, a BigInt or a hostile accessor: print what can be printed
      let seen = new WeakSet<object>();
      try {
        text = JSON.stringify(c.input, (_key, value) => {
          if (typeof value === 'bigint') return `${value}n`;
          if (typeof value === 'function') return '[function]';
          if (typeof value === 'symbol') return String(value);
          if (value && typeof value === 'object') {
            if (seen.has(value)) return '[seen above]';
            seen.add(value);
          }
          return value;
        });
      } catch {
        text = undefined;
      }
    }
  }
  text = c.label ?? text ?? '[an input that cannot be printed]';
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

// What an input said itself, so a refusal that quotes the input back is not
// taken for a leak.
function ownText(c: Case): string {
  try {
    return `${JSON.stringify(c.input)} ${JSON.stringify(c.wire ?? '')} ${c.label ?? ''}`;
  } catch {
    return c.label ?? '';
  }
}

const LEAKS: [string, RegExp][] = [
  [
    'SQL text',
    /\bSELECT\s[^]*\sFROM\s|\bINSERT INTO\b|\bDELETE FROM\b|\bGROUP BY\b|\bORDER BY\b|jsonb_\w+\(|::(jsonb|text|numeric|double precision|timestamptz)\b|\bboxel_index\b|\bsearch_doc\b|\bpristine_doc\b|\$\d+::/,
  ],
  ['a stack trace', /\n\s+at\s.+:\d+:\d+|\bat\s+\S+\s+\(.*:\d+:\d+\)/],
  [
    'a file path',
    /file:\/\/|node_modules|\/packages\/|\/Users\/|\/home\/|\.(ts|js|mjs|cjs):\d+/,
  ],
  ["another row's value", new RegExp(CANARY_SECRET)],
  ["a function's source", /\[native code\]|\bfunction \w*\(/],
];

// Whether a refusal's message carries something it should not. A refusal may
// quote the input back (in any case), and that is not a leak.
function leakIn(message: string, own: string): string | undefined {
  let said = own.toLowerCase();
  // a message that quotes a very long input back is read only at its head
  let head = message.slice(0, 4_000);
  for (let [what, pattern] of LEAKS) {
    let found = pattern.exec(head)?.[0];
    if (found && !said.includes(found.trim().slice(0, 12).toLowerCase())) {
      return what;
    }
  }
  return undefined;
}

function describe(e: unknown): Thrown {
  let thrown = e as any;
  let name: string;
  let message: string;
  try {
    name = String(thrown?.name ?? typeof e);
  } catch {
    name = '[unreadable name]';
  }
  try {
    message = String(thrown?.message ?? e);
  } catch {
    message = '[unreadable message]';
  }
  if (e instanceof InvalidQueryError) {
    return { kind: 'query', name, code: e.code, message };
  }
  if (e instanceof SearchRequestError) {
    return {
      kind: 'request',
      name,
      code: e.queryCode,
      requestCode: e.code,
      message,
    };
  }
  let sqlstate: string | undefined;
  try {
    sqlstate =
      typeof thrown?.code === 'string' && /^[0-9A-Z]{5}$/.test(thrown.code)
        ? thrown.code
        : undefined;
  } catch {
    sqlstate = undefined;
  }
  return { kind: 'raw', name, message, sqlstate };
}

function attempt(fn: () => unknown): Probe {
  let started = Date.now();
  try {
    let value = fn();
    return { ok: true, value, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, thrown: describe(e), ms: Date.now() - started };
  }
}

// Whether a refusal names a member: as a whole word, past the pointer that
// says where the mistake is.
function namesMember(message: string, name: string): boolean {
  let said = message.slice(message.indexOf(': ') + 1);
  return new RegExp(`(^|[^A-Za-z_])${name}([^A-Za-z_]|$)`).test(said);
}

// One failure's kind of mistake, with what varies from case to case taken
// out, so a thousand cases that fail one way print as one line.
function signature(what: string): string {
  let kind = what
    .slice(0, 600)
    .replace(/\/\/?[\w[\]/.$ -]*(?=: )/, '<where>')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'…'")
    .replace(/-?\d+(\.\d+)?(e[+-]?\d+)?/gi, 'N')
    .replace(/( to search for '…' in ).*$/, '$1a primitive');
  // a quotation the slice cut short
  if ((kind.match(/"/g) ?? []).length % 2 === 1) {
    kind = kind.replace(/"[^"]*$/, '"…');
  }
  return kind.slice(0, 160);
}

class Sweep {
  failures: Failure[] = [];
  cases = 0;
  checks = 0;
  dbRuns = 0;
  stoppedAtBound = 0;
  started = Date.now();
  #asked = 0;
  #sampled = 0;
  group: string;
  // one case in `stride` is sampled, so the sample spreads over the group
  stride: number;
  constructor(group: string, stride = 1) {
    this.group = group;
    this.stride = stride;
  }

  fail(kind: FailureKind, entry: Entry, c: Case, what: string) {
    // a failure on the wire side prints the payload the wire carried
    let wireSide =
      (entry === 'wire' || entry === 'engine (wire)' || entry === 'select') &&
      c.wire !== undefined &&
      (c.wire !== false || c.wireAsGiven);
    let input = show(wireSide ? { input: c.wire, label: c.label } : c);
    this.failures.push({ kind, entry, seed: c.seed, input, what });
  }

  // Whether a generated case with no expected rows still gets a database run.
  sample(): boolean {
    return this.#asked++ % this.stride === 0 && this.#sampled++ < DB_SAMPLE;
  }

  of(...kinds: FailureKind[]): Failure[] {
    return this.failures.filter((f) => kinds.includes(f.kind));
  }

  report(...kinds: FailureKind[]): string {
    let failures = this.of(...kinds);
    if (failures.length === 0) return 'none';
    let groups = new Map<string, Failure[]>();
    for (let f of failures) {
      let key = `${f.entry}: ${signature(f.what)}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    let lines = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 60)
      .map(([key, fs]) => {
        let examples = fs
          .slice(0, 2)
          .map(
            (f) =>
              `      seed ${f.seed}: ${f.input}\n        ${f.what.slice(0, 300)}`,
          )
          .join('\n');
        return `  [${fs.length}x] ${key}\n${examples}`;
      });
    let more =
      groups.size > 60 ? `\n  …and ${groups.size - 60} more kinds` : '';
    return `${failures.length} failing checks of ${groups.size} kinds:\n${lines.join('\n')}${more}`;
  }
}

// ---------------------------------------------------------------------------
// Generators shared by the groups
// ---------------------------------------------------------------------------

// Every name the grammar has, by where it goes.
const GRAMMAR = {
  query: [
    'type',
    'filter',
    'sort',
    'page',
    'facets',
    'collapse',
    'let',
    'explain',
  ],
  operator: [
    'eq',
    'in',
    'range',
    'contains',
    'matches',
    'pattern',
    'regex',
    'near',
    'linkedFrom',
    'any',
    'every',
    'not',
    'exists',
    'missing',
  ],
  matchesOption: ['prefix', 'typos', 'scope', 'within', 'fields'],
  rangeBound: ['gt', 'gte', 'lt', 'lte'],
  nearFilter: ['to', 'minSimilarity'],
  linkedFrom: ['card', 'field'],
  sort: ['by', 'direction', 'missing'],
  signal: ['blend', 'expression', 'boost', 'relevance'],
  blend: ['method', 'k'],
  blendSignal: ['weight'],
  expressionSort: ['top', 'direction', 'compare'],
  page: ['size', 'number', 'total'],
  facet: [
    'by',
    'size',
    'own',
    'stats',
    'ranges',
    'interval',
    'prefix',
    'missing',
    'order',
    'measure',
  ],
  facetRange: ['key', 'from', 'to'],
  collapse: ['by', 'keep', 'on'],
  binding: ['from', 'select', 'one'],
  bindingFrom: ['filter', 'sort', 'page'],
  compare: ['filter', 'by', 'near', 'k', 'minSimilarity'],
} as const;
const ALL_NAMES = new Set<string>(Object.values(GRAMMAR).flat());

// A valid query with `name` in the place the grammar gives it. Each is
// written with the right name first; the typo test then swaps it.
const TEMPLATES: Record<string, (name: string) => any> = {
  // query members
  'query.type': (n) => ({ [n]: T, filter: { eq: { label: 'canary' } } }),
  'query.filter': (n) => ({ type: T, [n]: { eq: { label: 'canary' } } }),
  'query.sort': (n) => ({ type: T, [n]: [{ by: 'amount' }] }),
  'query.page': (n) => ({ type: T, [n]: { size: 5 } }),
  'query.facets': (n) => ({ type: T, [n]: [{ by: 'rating' }] }),
  'query.collapse': (n) => ({ type: T, [n]: 'rating' }),
  'query.let': (n) => ({
    type: T,
    [n]: { $hot: { from: { type: T }, select: 'code' } },
    filter: { eq: { label: 'canary' } },
  }),
  'query.explain': (n) => ({ type: T, [n]: true }),
  // filter operators
  'operator.eq': (n) => ({ type: T, filter: { [n]: { label: 'canary' } } }),
  'operator.in': (n) => ({ type: T, filter: { [n]: { label: ['canary'] } } }),
  'operator.range': (n) => ({
    type: T,
    filter: { [n]: { amount: { gt: 1 } } },
  }),
  'operator.contains': (n) => ({ type: T, filter: { [n]: { label: 'can' } } }),
  'operator.matches': (n) => ({ type: T, filter: { [n]: 'canary' } }),
  'operator.pattern': (n) => ({ type: T, filter: { [n]: { code: 'C-0*' } } }),
  'operator.regex': (n) => ({ type: T, filter: { [n]: { code: '^C-' } } }),
  'operator.near': (n) => ({
    type: T,
    filter: { [n]: { embedding: { to: [1, 0, 0] } } },
  }),
  'operator.linkedFrom': (n) => ({
    type: T,
    filter: { [n]: { card: SPECIMENS[0].url, field: 'tags' } },
  }),
  'operator.any': (n) => ({
    type: T,
    filter: { [n]: [{ eq: { label: 'canary' } }] },
  }),
  'operator.every': (n) => ({
    type: T,
    filter: { [n]: [{ eq: { label: 'canary' } }] },
  }),
  'operator.not': (n) => ({ type: T, filter: { [n]: { eq: { label: 'x' } } } }),
  'operator.exists': (n) => ({ type: T, filter: { [n]: 'rating' } }),
  'operator.missing': (n) => ({ type: T, filter: { [n]: 'rating' } }),
  // beside matches
  'matchesOption.prefix': (n) => ({
    type: T,
    filter: { matches: 'cana', [n]: true },
  }),
  'matchesOption.typos': (n) => ({
    type: T,
    filter: { matches: 'canary', [n]: true },
  }),
  'matchesOption.scope': (n) => ({
    type: T,
    filter: { matches: 'canary', [n]: 'title' },
  }),
  'matchesOption.within': (n) => ({
    type: T,
    filter: { matches: 'canary', [n]: 'tags' },
  }),
  'matchesOption.fields': (n) => ({
    type: T,
    filter: { matches: 'canary', [n]: ['label'] },
  }),
  ...Object.fromEntries(
    GRAMMAR.rangeBound.map((bound) => [
      `rangeBound.${bound}`,
      (n: string) => ({ type: T, filter: { range: { amount: { [n]: 3 } } } }),
    ]),
  ),
  'nearFilter.to': (n) => ({
    type: T,
    filter: { near: { embedding: { [n]: [1, 0, 0] } } },
  }),
  'nearFilter.minSimilarity': (n) => ({
    type: T,
    filter: { near: { embedding: { to: [1, 0, 0], [n]: 0.5 } } },
  }),
  'linkedFrom.card': (n) => ({
    type: T,
    filter: { linkedFrom: { [n]: SPECIMENS[0].url, field: 'tags' } },
  }),
  'linkedFrom.field': (n) => ({
    type: T,
    filter: { linkedFrom: { card: SPECIMENS[0].url, [n]: 'tags' } },
  }),
  // sort
  'sort.by': (n) => ({ type: T, sort: [{ [n]: 'amount' }] }),
  'sort.direction': (n) => ({ type: T, sort: [{ by: 'amount', [n]: 'desc' }] }),
  'sort.missing': (n) => ({ type: T, sort: [{ by: 'rating', [n]: 'first' }] }),
  'signal.blend': (n) => ({
    type: T,
    sort: [{ [n]: [{ by: 'amount' }, { by: 'rating' }] }],
  }),
  'signal.expression': (n) => ({ type: T, sort: [{ [n]: 'amount * 2' }] }),
  'signal.boost': (n) => ({
    type: T,
    sort: [
      {
        blend: [{ by: 'amount' }, { [n]: { eq: { tags: 'red' } }, weight: 2 }],
      },
    ],
  }),
  'signal.relevance': (n) => ({
    type: T,
    filter: { matches: 'canary' },
    sort: [{ [n]: true }],
  }),
  'blend.method': (n) => ({
    type: T,
    sort: [{ blend: [{ by: 'amount' }], [n]: 'rrf' }],
  }),
  'blend.k': (n) => ({
    type: T,
    sort: [{ blend: [{ by: 'amount' }], [n]: 10 }],
  }),
  'blendSignal.weight': (n) => ({
    type: T,
    sort: [{ blend: [{ by: 'amount', [n]: 2 }] }],
  }),
  'expressionSort.top': (n) => ({
    type: T,
    sort: [{ expression: 'amount * 2', [n]: 10 }],
  }),
  'expressionSort.direction': (n) => ({
    type: T,
    sort: [{ expression: 'amount * 2', [n]: 'asc' }],
  }),
  'expressionSort.compare': (n) => ({
    type: T,
    sort: [{ expression: 'amount / stats.amount.max', [n]: { by: 'rating' } }],
  }),
  // page
  'page.size': (n) => ({ type: T, page: { [n]: 5 } }),
  'page.number': (n) => ({ type: T, page: { size: 5, [n]: 1 } }),
  'page.total': (n) => ({ type: T, page: { size: 5, [n]: 'exact' } }),
  // facets
  'facet.by': (n) => ({ type: T, facets: [{ [n]: 'rating' }] }),
  'facet.size': (n) => ({ type: T, facets: [{ by: 'rating', [n]: 3 }] }),
  'facet.own': (n) => ({ type: T, facets: [{ by: 'rating', [n]: 'ignore' }] }),
  'facet.stats': (n) => ({ type: T, facets: [{ by: 'amount', [n]: true }] }),
  'facet.ranges': (n) => ({
    type: T,
    facets: [{ by: 'amount', [n]: [{ from: 1, to: 9 }] }],
  }),
  'facet.interval': (n) => ({ type: T, facets: [{ by: 'day', [n]: 'month' }] }),
  'facet.prefix': (n) => ({ type: T, facets: [{ by: 'tags', [n]: 're' }] }),
  'facet.missing': (n) => ({ type: T, facets: [{ by: 'rating', [n]: true }] }),
  'facet.order': (n) => ({ type: T, facets: [{ by: 'rating', [n]: 'value' }] }),
  'facet.measure': (n) => ({
    type: T,
    facets: [{ by: 'rating', [n]: { avg: 'amount' } }],
  }),
  'facetRange.key': (n) => ({
    type: T,
    facets: [{ by: 'amount', ranges: [{ [n]: 'low', from: 1, to: 9 }] }],
  }),
  'facetRange.from': (n) => ({
    type: T,
    facets: [{ by: 'amount', ranges: [{ [n]: 1, to: 9 }] }],
  }),
  'facetRange.to': (n) => ({
    type: T,
    facets: [{ by: 'amount', ranges: [{ from: 1, [n]: 9 }] }],
  }),
  // collapse
  'collapse.by': (n) => ({ type: T, collapse: { [n]: 'rating' } }),
  'collapse.keep': (n) => ({ type: T, collapse: { by: 'rating', [n]: 2 } }),
  'collapse.on': (n) => ({ type: T, collapse: { by: 'rating', [n]: T } }),
  // let
  'binding.from': (n) => ({
    type: T,
    let: { $hot: { [n]: { type: T }, select: 'code' } },
    filter: { in: { code: '$hot' } },
  }),
  'binding.select': (n) => ({
    type: T,
    let: { $hot: { from: { type: T }, [n]: 'code' } },
    filter: { in: { code: '$hot' } },
  }),
  'binding.one': (n) => ({
    type: T,
    let: { $it: { from: { type: T }, [n]: true } },
    filter: { eq: { rating: '$it.rating' } },
  }),
  'bindingFrom.filter': (n) => ({
    type: T,
    let: { $hot: { from: { [n]: { type: T } }, select: 'code' } },
    filter: { in: { code: '$hot' } },
  }),
  'bindingFrom.sort': (n) => ({
    type: T,
    let: {
      $hot: {
        from: { filter: { type: T }, [n]: [{ by: 'lastModified' }] },
        select: 'code',
      },
    },
    filter: { in: { code: '$hot' } },
  }),
  'bindingFrom.page': (n) => ({
    type: T,
    let: {
      $hot: { from: { filter: { type: T }, [n]: { size: 5 } }, select: 'code' },
    },
    filter: { in: { code: '$hot' } },
  }),
  'compare.filter': (n) => ({
    type: T,
    sort: [
      {
        expression: 'amount / stats.amount.max',
        compare: { [n]: { range: { amount: { gte: 0 } } } },
      },
    ],
  }),
  'compare.by': (n) => ({
    type: T,
    sort: [
      {
        expression: 'amount / stats.amount.max',
        compare: { [n]: 'rating' },
      },
    ],
  }),
  'compare.near': (n) => ({
    type: T,
    sort: [
      {
        expression: 'amount / stats.amount.max',
        compare: { [n]: 'embedding' },
      },
    ],
  }),
  'compare.k': (n) => ({
    type: T,
    sort: [
      {
        expression: 'amount / stats.amount.max',
        compare: { near: 'embedding', [n]: 3 },
      },
    ],
  }),
  'compare.minSimilarity': (n) => ({
    type: T,
    sort: [
      {
        expression: 'amount / stats.amount.max',
        compare: { near: 'embedding', [n]: 0.1 },
      },
    ],
  }),
};

// One-edit misspellings of a name, each labeled with the edit.
function misspellings(name: string): [string, string][] {
  let out: [string, string][] = [];
  let mid = Math.max(1, Math.floor(name.length / 2));
  if (name.length >= 2) {
    out.push([
      'transposition',
      name.slice(0, mid - 1) + name[mid] + name[mid - 1] + name.slice(mid + 1),
    ]);
    out.push(['deletion', name.slice(0, mid) + name.slice(mid + 1)]);
  }
  out.push(['insertion', name.slice(0, mid) + 'x' + name.slice(mid)]);
  out.push([
    'substitution',
    name.slice(0, mid) + (name[mid] === 'q' ? 'z' : 'q') + name.slice(mid + 1),
  ]);
  out.push(['upper case', name.toUpperCase()]);
  out.push(['capitalized', name[0].toUpperCase() + name.slice(1)]);
  out.push(['trailing space', `${name} `]);
  out.push(['leading space', ` ${name}`]);
  out.push(
    name.endsWith('s')
      ? ['singular', name.slice(0, -1)]
      : ['plural', `${name}s`],
  );
  if (/[A-Z]/.test(name)) {
    out.push([
      'snake case',
      name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
    ]);
    out.push(['lower case', name.toLowerCase()]);
  }
  return out.filter(
    ([, wrong], i, all) =>
      wrong !== name &&
      !ALL_NAMES.has(wrong) &&
      all.findIndex(([, w]) => w === wrong) === i,
  );
}

// Forty valid queries that between them use every member of the language.
// The mutation fuzzer starts from these.
function baseQueries(vectors: boolean): any[] {
  let bases: any[] = [
    {},
    { type: T },
    { filter: { type: T } },
    { filter: { on: T, eq: { label: 'canary' } } },
    { type: T, filter: { eq: { label: 'canary', amount: 68 } } },
    { type: T, filter: { in: { label: ['canary', 'paypal'] } } },
    { type: T, filter: { range: { amount: { gt: 3, lte: 20 } } } },
    { type: T, filter: { range: { day: { gte: 'now-30d/d', lt: 'now+1w' } } } },
    { type: T, filter: { contains: { label: 'pay' } } },
    { type: T, filter: { matches: 'lighthouse keeper' } },
    { type: T, filter: { matches: 'lightho', prefix: true } },
    { type: T, filter: { matches: 'canary', scope: 'title' } },
    { type: T, filter: { matches: 'canery', typos: true } },
    { type: T, filter: { matches: 'keeper', fields: ['label', 'note'] } },
    {
      type: T,
      filter: { prefix: true, scope: 'title', matches: 'can', typos: true },
    },
    { type: T, filter: { pattern: { code: 'C-0*' } } },
    { type: T, filter: { regex: { code: '^C-0[0-9]+$' } } },
    {
      type: T,
      filter: { linkedFrom: { card: SPECIMENS[0].url, field: 'tags' } },
    },
    {
      type: T,
      filter: {
        any: [{ eq: { label: 'canary' } }, { not: { exists: 'rating' } }],
      },
    },
    { type: T, filter: { every: [{ exists: 'rating' }, { missing: 'day' }] } },
    { type: T, filter: { not: { eq: { tags: 'red' } } } },
    {
      type: T,
      sort: [
        { by: 'amount', direction: 'desc', missing: 'first' },
        { by: 'lastModified' },
      ],
    },
    {
      type: T,
      filter: { matches: 'lighthouse' },
      sort: [{ by: 'textRelevance' }],
    },
    {
      type: T,
      filter: { matches: 'lighthouse' },
      sort: [
        {
          blend: [
            { by: 'textRelevance' },
            { by: 'amount', weight: 0.5 },
            { boost: { eq: { tags: 'red' } }, weight: 1.5 },
            { expression: 'IFERROR(amount / rating, 0)', weight: -1 },
          ],
          k: 60,
          method: 'rrf',
        },
      ],
    },
    {
      type: T,
      sort: [
        {
          expression: 'rating / LN(amount + 2)',
          direction: 'asc',
        },
      ],
    },
    { type: T, sort: [{ expression: 'MEDIAN(amount, rating) + amount' }] },
    {
      type: T,
      filter: { matches: 'lighthouse' },
      sort: [{ relevance: { text: 0.6, popularity: 0.2 } }],
    },
    {
      type: T,
      let: {
        $hot: {
          from: {
            type: T,
            filter: { range: { amount: { gte: 10 } } },
            page: { size: 50 },
          },
          select: 'code',
        },
      },
      filter: { in: { code: '$hot' } },
    },
    {
      type: T,
      let: {
        $it: {
          from: { type: T, filter: { eq: { label: 'canary' } } },
          one: true,
        },
      },
      filter: { range: { amount: { lt: '$it.amount' } } },
    },
    { type: T, collapse: 'rating' },
    {
      type: T,
      collapse: { by: 'rating', keep: 2 },
      sort: [{ by: 'amount' }],
    },
    {
      type: T,
      sort: [
        { expression: 'COUNT(amount) * 0 + amount', top: 20, direction: 'asc' },
        { by: 'rating' },
      ],
    },
    {
      type: T,
      sort: [
        {
          expression: 'PERCENTRANK_INC(peers.amount, amount)',
          compare: { by: 'rating', filter: { range: { amount: { gte: 0 } } } },
          top: 50,
        },
      ],
    },
    {
      type: T,
      facets: [
        { by: 'rating', size: 5, missing: true },
        { by: 'tags', own: 'ignore', prefix: 'r', order: 'value' },
        {
          by: 'amount',
          stats: true,
          ranges: [{ key: 'low', to: 10 }, { from: 10 }],
        },
        { by: 'day', interval: 'month' },
        { by: 'note', measure: { avg: 'amount' }, order: 'measure' },
      ],
    },
    {
      type: T,
      explain: true,
      filter: { matches: 'lighthouse' },
      sort: [{ blend: [{ by: 'textRelevance' }, { by: 'amount' }] }],
    },
    { type: T, page: { size: 10, number: 1, total: 'exact' } },
    {
      filter: { on: T, eq: { label: 'canary' } },
      sort: [{ on: T, by: 'amount', direction: 'desc' }, { by: 'cardURL' }],
      page: { size: 10, exactTotal: true },
    },
    {
      filter: {
        every: [
          { type: T },
          { on: T, contains: { note: 'keeper' } },
          { on: T, not: { in: { tags: ['red', 'blue'] } } },
        ],
      },
    },
    {
      type: T,
      filter: { eq: { 'item.label': 'canary' } },
      sort: [{ by: '"Amount"' }],
    },
    {
      type: K,
      filter: { eq: { select: 'select-1' } },
      sort: [{ by: 'order' }],
    },
  ];
  if (vectors) {
    bases.push(
      {
        type: T,
        filter: { near: { embedding: { to: [1, 0, 0], minSimilarity: 0.5 } } },
      },
      {
        type: T,
        sort: [{ by: 'embedding', near: [1, 0, 0] }],
        page: { size: 5 },
      },
      {
        type: T,
        sort: [
          {
            expression: 'stats.amount.median - amount',
            compare: { near: 'embedding', k: 3, minSimilarity: 0.1 },
          },
        ],
      },
    );
  }
  return bases;
}

// JSON values of every kind, for the places a query or a member goes.
const JSON_ATOMS: [string, any][] = [
  ['null', null],
  ['true', true],
  ['false', false],
  ['0', 0],
  ['1', 1],
  ['-1', -1],
  ['0.5', 0.5],
  ['1e308', 1e308],
  ['-1e308', -1e308],
  ['2^53+1', 2 ** 53 + 1],
  ['1e21', 1e21],
  ['an empty string', ''],
  ['a space', ' '],
  ['"x"', 'x'],
  ['"0"', '0'],
  ['"true"', 'true'],
  ['"null"', 'null'],
  ['"[]"', '[]'],
  ['"{}"', '{}'],
  ['an empty object', {}],
  ['an empty array', []],
  ['an array of arrays', [[], [[]]]],
  ['an object with numeric keys', { 0: 'a', 1: 'b' }],
  ['a null byte', 'a\u0000b'],
  ['a quote and a comment', `'; DROP TABLE boxel_index;--`],
  ['a template', '${7*7}'],
  ['"__proto__"', '__proto__'],
  ['"now-1d"', 'now-1d'],
  ['a backtracking pattern', '(a+)+$'],
  ['a megabyte of one letter', { $text: ['a', 1_000_000] }],
  ['a megabyte of words', { $text: ['lorem ipsum ', 90_000] }],
  ['20,000 open parentheses', { $text: ['(', 20_000] }],
  ['an object with 10,000 keys', { $keys: 10_000 }],
  ['a list of 10,000 strings', { $seq: [10_000, 'v'] }],
  ['arrays nested 10,000 deep', { $nest: ['[]', 10_000, 1] }],
  ['objects nested 10,000 deep', { $nest: ['obj', 10_000, 1] }],
  [
    'a filter nested 10,000 deep in not',
    { $nest: ['not', 10_000, { eq: { label: 'x' } }] },
  ],
  [
    'a filter nested 10,000 deep in every',
    { $nest: ['every', 10_000, { eq: { label: 'x' } }] },
  ],
];

// Set while the engine runs a query: a value that passes every check and
// then changes reads one way before this and another after.
let engineRunning = false;

// Values JSON cannot carry, for the entry points a caller in the same
// process reaches. Each is made fresh, so no case sees another's state.
function inProcessAtoms(): [string, any][] {
  let cyclicObject: any = { filter: {} };
  cyclicObject.filter.self = cyclicObject;
  let cyclicArray: any[] = [];
  cyclicArray.push(cyclicArray);
  let boom = (what: string) => () => {
    throw new Error(`a hostile ${what} threw`);
  };
  let flips = (first: any, then: any) => () => (engineRunning ? then : first);
  return [
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['-0', -0],
    ['a function', () => ({ filter: { type: T } })],
    ['a symbol', Symbol('query')],
    ['a BigInt', 10n],
    ['a Date', new Date(0)],
    ['an invalid Date', new Date(NaN)],
    ['a Map', new Map([['filter', { type: T }]])],
    ['a Set', new Set(['filter'])],
    ['a RegExp', /(a+)+$/],
    ['a boxed string', new String('label')],
    ['a boxed number', new Number(5)],
    ['an Error', new Error('an error as a value')],
    ['a typed array', new Float32Array([1, 0, 0])],
    ['a sparse array', [, 1, , 2]], // eslint-disable-line no-sparse-arrays
    ['an object with no prototype', Object.create(null)],
    ['a cyclic object', cyclicObject],
    ['a cyclic array', cyclicArray],
    [
      'a Proxy that throws on any access',
      new Proxy(
        {},
        {
          get: boom('proxy get'),
          has: boom('proxy has'),
          ownKeys: boom('proxy ownKeys'),
          getOwnPropertyDescriptor: boom('proxy descriptor'),
        },
      ),
    ],
    [
      'an object with a throwing getter',
      Object.defineProperty({}, 'filter', {
        enumerable: true,
        get: boom('getter'),
      }),
    ],
    ['an object whose toJSON throws', { toJSON: boom('toJSON') }],
    ['an object whose toString throws', { toString: boom('toString') }],
    [
      'an object whose toString returns SQL',
      { toString: () => `'; DROP TABLE boxel_index;--` },
    ],
    ['an object whose valueOf throws', { valueOf: boom('valueOf') }],
    [
      'an object with a then method',
      {
        then(resolve: (v: unknown) => void) {
          (globalThis as any).__queryFuzzCanary = 'pwned';
          resolve({ filter: { type: T } });
        },
      },
    ],
    [
      'a page whose size reads 5 when checked and SQL when run',
      Object.defineProperty({}, 'size', {
        enumerable: true,
        get: flips(5, '5; SELECT pg_sleep(30)'),
      }),
    ],
    [
      'a sort entry whose direction reads "asc" when checked and SQL when run',
      Object.defineProperty({ by: 'lastModified' }, 'direction', {
        enumerable: true,
        get: flips('asc', 'asc; SELECT pg_sleep(30)'),
      }),
    ],
    [
      'an array whose length lies',
      Object.defineProperty([1, 2, 3], 'length', { value: 3, writable: false }),
    ],
    [
      'an array with a hostile map',
      Object.assign([{ by: 'amount' }], { map: boom('array map') }),
    ],
  ];
}

// Where a value goes: every place a query takes a member, as a function
// from the value to a query.
const POSITIONS: [string, (v: any) => any][] = [
  ['the query', (v) => v],
  ['type', (v) => ({ type: v })],
  ['type.module', (v) => ({ type: { module: v, name: 'Specimen' } })],
  ['type.name', (v) => ({ type: { module: T.module, name: v } })],
  ['filter', (v) => ({ type: T, filter: v })],
  ['filter.on', (v) => ({ filter: { on: v, eq: { label: 'canary' } } })],
  ['filter.type', (v) => ({ filter: { type: v } })],
  ['eq', (v) => ({ type: T, filter: { eq: v } })],
  ['an eq value', (v) => ({ type: T, filter: { eq: { label: v } } })],
  ['in', (v) => ({ type: T, filter: { in: v } })],
  ['an in list', (v) => ({ type: T, filter: { in: { label: v } } })],
  [
    'an in value',
    (v) => ({ type: T, filter: { in: { label: ['canary', v] } } }),
  ],
  ['contains', (v) => ({ type: T, filter: { contains: { label: v } } })],
  ['range', (v) => ({ type: T, filter: { range: v } })],
  ['range bounds', (v) => ({ type: T, filter: { range: { amount: v } } })],
  [
    'a range bound',
    (v) => ({ type: T, filter: { range: { amount: { gte: v } } } }),
  ],
  [
    'a date bound',
    (v) => ({ type: T, filter: { range: { day: { gte: v } } } }),
  ],
  ['matches', (v) => ({ type: T, filter: { matches: v } })],
  ['prefix', (v) => ({ type: T, filter: { matches: 'canary', prefix: v } })],
  ['typos', (v) => ({ type: T, filter: { matches: 'canary', typos: v } })],
  ['scope', (v) => ({ type: T, filter: { matches: 'canary', scope: v } })],
  ['fields', (v) => ({ type: T, filter: { matches: 'canary', fields: v } })],
  ['within', (v) => ({ type: T, filter: { matches: 'canary', within: v } })],
  [
    'typeahead',
    (v) => ({ type: T, filter: { prefix: true, scope: 'title', matches: v } }),
  ],
  ['pattern', (v) => ({ type: T, filter: { pattern: { code: v } } })],
  ['regex', (v) => ({ type: T, filter: { regex: { code: v } } })],
  ['near', (v) => ({ type: T, filter: { near: v } })],
  ['near.to', (v) => ({ type: T, filter: { near: { embedding: { to: v } } } })],
  [
    'near.minSimilarity',
    (v) => ({
      type: T,
      filter: { near: { embedding: { to: [1, 0, 0], minSimilarity: v } } },
    }),
  ],
  ['linkedFrom', (v) => ({ type: T, filter: { linkedFrom: v } })],
  ['any', (v) => ({ type: T, filter: { any: v } })],
  ['every', (v) => ({ type: T, filter: { every: v } })],
  [
    'an every member',
    (v) => ({ type: T, filter: { every: [{ type: T }, v] } }),
  ],
  ['not', (v) => ({ type: T, filter: { not: v } })],
  ['exists', (v) => ({ type: T, filter: { exists: v } })],
  ['sort', (v) => ({ type: T, sort: v })],
  ['a sort entry', (v) => ({ type: T, sort: [v] })],
  ['sort by', (v) => ({ type: T, sort: [{ by: v }] })],
  [
    'sort direction',
    (v) => ({ type: T, sort: [{ by: 'amount', direction: v }] }),
  ],
  ['sort missing', (v) => ({ type: T, sort: [{ by: 'amount', missing: v }] })],
  ['sort near', (v) => ({ type: T, sort: [{ by: 'embedding', near: v }] })],
  ['blend', (v) => ({ type: T, sort: [{ blend: v }] })],
  [
    'a blend signal',
    (v) => ({ type: T, sort: [{ blend: [{ by: 'amount' }, v] }] }),
  ],
  [
    'weight',
    (v) => ({ type: T, sort: [{ blend: [{ by: 'amount', weight: v }] }] }),
  ],
  ['k', (v) => ({ type: T, sort: [{ blend: [{ by: 'amount' }], k: v }] })],
  ['boost', (v) => ({ type: T, sort: [{ blend: [{ boost: v, weight: 1 }] }] })],
  ['expression', (v) => ({ type: T, sort: [{ expression: v }] })],
  [
    'a blend expression',
    (v) => ({ type: T, sort: [{ blend: [{ expression: v }] }] }),
  ],
  [
    'relevance',
    (v) => ({
      type: T,
      filter: { matches: 'canary' },
      sort: [{ relevance: v }],
    }),
  ],
  ['page', (v) => ({ type: T, page: v })],
  ['page.size', (v) => ({ type: T, page: { size: v } })],
  ['page.number', (v) => ({ type: T, page: { size: 5, number: v } })],
  ['page.total', (v) => ({ type: T, page: { size: 5, total: v } })],
  ['facets', (v) => ({ type: T, facets: v })],
  ['a facet', (v) => ({ type: T, facets: [v] })],
  ['facet by', (v) => ({ type: T, facets: [{ by: v }] })],
  ['facet size', (v) => ({ type: T, facets: [{ by: 'rating', size: v }] })],
  ['facet ranges', (v) => ({ type: T, facets: [{ by: 'amount', ranges: v }] })],
  [
    'a facet range bound',
    (v) => ({ type: T, facets: [{ by: 'amount', ranges: [{ from: v }] }] }),
  ],
  [
    'facet interval',
    (v) => ({ type: T, facets: [{ by: 'day', interval: v }] }),
  ],
  ['facet prefix', (v) => ({ type: T, facets: [{ by: 'tags', prefix: v }] })],
  [
    'facet measure',
    (v) => ({ type: T, facets: [{ by: 'rating', measure: v }] }),
  ],
  ['collapse', (v) => ({ type: T, collapse: v })],
  ['collapse.by', (v) => ({ type: T, collapse: { by: v } })],
  ['collapse.keep', (v) => ({ type: T, collapse: { by: 'rating', keep: v } })],
  ['let', (v) => ({ type: T, let: v })],
  ['a binding', (v) => ({ type: T, let: { $hot: v } })],
  [
    'a binding from',
    (v) => ({ type: T, let: { $hot: { from: v, select: 'code' } } }),
  ],
  [
    'a binding select',
    (v) => ({ type: T, let: { $hot: { from: { type: T }, select: v } } }),
  ],
  [
    'a $literal',
    (v) => ({
      type: T,
      let: { $hot: { from: { type: T }, select: 'code' } },
      filter: { in: { code: [{ $literal: v }] } },
    }),
  ],
  [
    'a binding path',
    (v) => ({
      type: T,
      let: { $it: { from: { type: T }, one: true } },
      // a path is text; any other value stands where the reference would
      filter: { eq: { rating: typeof v === 'string' ? `$it.${v}` : v } },
    }),
  ],
  ['explain', (v) => ({ type: T, explain: v })],
  // `rerank` is not a member: any value under it is refused
  ['rerank', (v) => ({ type: T, rerank: v })],
  [
    'expression with top',
    (v) => ({ type: T, sort: [{ expression: v, top: 10 }] }),
  ],
  [
    'expression.top',
    (v) => ({ type: T, sort: [{ expression: 'amount', top: v }] }),
  ],
  [
    'expression.compare',
    (v) => ({ type: T, sort: [{ expression: 'amount', compare: v }] }),
  ],
  [
    'compare.k',
    (v) => ({
      type: T,
      sort: [{ expression: 'amount', compare: { near: 'embedding', k: v } }],
    }),
  ],
];

// One of the mutations the fuzzer applies to a valid query.
const MUTATIONS = [
  'delete a member',
  'duplicate a member',
  'swap a value for one of another type',
  'replace a value with a hostile one',
  'rename a key',
  'wrap a value in an array',
  'truncate a list',
  'nest the query inside itself',
] as const;

interface Slot {
  parent: any;
  key: string | number;
}
function slotsOf(tree: any, out: Slot[] = [], depth = 0): Slot[] {
  if (
    tree == null ||
    typeof tree !== 'object' ||
    isRecipe(tree) ||
    depth > 12
  ) {
    return out;
  }
  let keys: (string | number)[] = Array.isArray(tree)
    ? tree.map((_x, i) => i)
    : Object.keys(tree);
  for (let key of keys) {
    out.push({ parent: tree, key });
    slotsOf(tree[key], out, depth + 1);
  }
  return out;
}

function typoOf(key: string, next: () => number): string {
  let options = misspellings(key);
  return options.length ? pick(next, options)[1] : `${key}x`;
}

function otherType(value: any, next: () => number): any {
  let options: any[] =
    typeof value === 'string'
      ? [0, true, null, [value], { value }]
      : typeof value === 'number'
        ? [String(value), true, null, [value], { value }]
        : typeof value === 'boolean'
          ? [String(value), Number(value), null, [value]]
          : Array.isArray(value)
            ? ['x', 1, null, { 0: value[0] }, true]
            : ['x', 1, null, true, [value]];
  return pick(next, options);
}

function mutate(
  base: any,
  next: () => number,
  atoms: [string, any][],
): { tree: any; note: string } {
  let tree = structuredClone(base);
  let notes: string[] = [];
  let times = next() < 0.3 ? 2 : 1;
  for (let t = 0; t < times; t++) {
    let slots = slotsOf(tree);
    let mutation = pick(next, MUTATIONS);
    if (slots.length === 0) {
      let [name, atom] = pick(next, atoms);
      tree = next() < 0.5 ? atom : { ...tree, [typoOf('filter', next)]: atom };
      notes.push(`an empty query given ${name}`);
      continue;
    }
    let { parent, key } = pick(next, slots);
    let value = parent[key];
    let inList = Array.isArray(parent);
    switch (mutation) {
      case 'delete a member':
        if (inList) parent.splice(key as number, 1);
        else delete parent[key];
        break;
      case 'duplicate a member':
        if (inList) parent.splice(key as number, 0, structuredClone(value));
        else parent[String(key).toUpperCase()] = structuredClone(value);
        break;
      case 'swap a value for one of another type':
        parent[key] = otherType(value, next);
        break;
      case 'replace a value with a hostile one': {
        let [name, atom] = pick(next, atoms);
        parent[key] = structuredClone(atom);
        mutation = `${mutation} (${name})` as any;
        break;
      }
      case 'rename a key':
        if (inList) {
          parent[key] = { [typoOf('by', next)]: value };
        } else {
          delete parent[key];
          parent[typoOf(String(key), next)] = value;
        }
        break;
      case 'wrap a value in an array':
        parent[key] = [value];
        break;
      case 'truncate a list':
        if (Array.isArray(value)) value.length = Math.floor(value.length / 2);
        else if (inList) parent.length = key as number;
        else parent[key] = [];
        break;
      case 'nest the query inside itself':
        parent[key] = structuredClone(base);
        break;
    }
    notes.push(`${mutation} at ${String(key)}`);
  }
  return { tree, note: notes.join(', then ') };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let virtualNetwork: VirtualNetwork;
  let vectors = false;
  let baseline: Record<string, unknown>;
  let prototypes: string[];
  let keywordSeedError: string | undefined;
  let unhandled: string[] = [];
  let running = 'setup';
  let onUnhandled = (reason: unknown) => {
    unhandled.push(
      `${running}: ${describe(reason).name}: ${describe(reason).message.slice(0, 200)}`,
    );
  };

  // -- the probe thread ------------------------------------------------------

  let probeThread: Worker | undefined;
  let probeReady: Promise<void> | undefined;
  let probeWaiting = new Map<number, (probe: Probe) => void>();
  let probeId = 0;
  let probeBootError: string | undefined;

  function startProbeThread(): Promise<void> {
    let worker = new Worker(PROBE_THREAD, { eval: true });
    probeThread = worker;
    worker.unref();
    return new Promise<void>((resolve) => {
      worker.on('message', (message: any) => {
        if (message.ready) return resolve();
        if (message.boot) {
          probeBootError = message.boot;
          return resolve();
        }
        let done = probeWaiting.get(message.id);
        probeWaiting.delete(message.id);
        done?.(message.out);
      });
      worker.on('error', (e) => {
        probeBootError ??= String(e);
        resolve();
      });
    });
  }

  async function stopProbeThread() {
    let worker = probeThread;
    probeThread = undefined;
    probeReady = undefined;
    await worker?.terminate();
  }

  // One check of a large input, in the probe thread. A check still running at
  // the hang bound is stopped with its thread.
  async function probe(
    entry: 'assertQuery' | 'lowerQuery' | 'wire',
    recipe: unknown,
  ): Promise<Probe> {
    probeReady ??= startProbeThread();
    await probeReady;
    if (probeBootError) {
      throw new Error(`the probe thread did not start: ${probeBootError}`);
    }
    let id = ++probeId;
    let timer: ReturnType<typeof setTimeout>;
    let answer = await new Promise<Probe>((resolve) => {
      probeWaiting.set(id, resolve);
      timer = setTimeout(() => resolve({ hang: true }), HANG_MS);
      try {
        probeThread!.postMessage({ id, entry, recipe });
      } catch (e) {
        resolve({ ok: false, thrown: describe(e), ms: 0 });
      }
    });
    clearTimeout(timer!);
    probeWaiting.delete(id);
    if ('hang' in answer) {
      await stopProbeThread();
    }
    return answer;
  }

  // -- state -----------------------------------------------------------------

  async function stateOfIndex(): Promise<Record<string, unknown>> {
    let [index] = (await adapter.execute(
      `SELECT COUNT(*)::int AS rows, md5(string_agg(url || '|' || type || '|' || coalesce(search_doc::text, '') || '|' || coalesce(pristine_doc::text, '') || '|' || coalesce(is_deleted::text, ''), ',' ORDER BY url, type)) AS checksum FROM boxel_index`,
    )) as Record<string, unknown>[];
    let [log] = (await adapter.execute(
      `SELECT COUNT(*)::int AS rows, md5(string_agg(url || '|' || line_no || '|' || entry::text, ',' ORDER BY url, line_no)) AS checksum FROM boxel_log_lines`,
    )) as Record<string, unknown>[];
    let [canary] = (await adapter.execute(
      `SELECT search_doc ->> 'secret' AS secret FROM boxel_index WHERE search_doc ->> 'label' = 'canary'`,
    )) as Record<string, unknown>[];
    return {
      indexRows: index.rows,
      indexChecksum: index.checksum,
      logRows: log.rows,
      logChecksum: log.checksum,
      canary: canary?.secret,
    };
  }

  const prototypesNow = () =>
    [Object.prototype, Array.prototype, Function.prototype].map((p) =>
      Reflect.ownKeys(p).map(String).sort().join(' '),
    );

  // -- the entry points ------------------------------------------------------

  // A search bounded by the hang detector. At the bound the search is
  // cancelled, so the next case finds the connection free.
  async function bounded<R>(
    run: (signal: AbortSignal) => Promise<R>,
  ): Promise<Probe> {
    let controller = new AbortController();
    let started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let settled = run(controller.signal).then(
      (value): Probe => ({ ok: true, value, ms: Date.now() - started }),
      (e): Probe => ({
        ok: false,
        thrown: describe(e),
        ms: Date.now() - started,
      }),
    );
    let answer = await Promise.race([
      settled,
      new Promise<Probe>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ hang: true });
        }, HANG_MS);
      }),
    ]);
    clearTimeout(timer!);
    if ('hang' in answer) {
      // The cancelled statement unwinds before the next case; a search that
      // does not stop when cancelled is one no time budget can bound.
      answer.stopped = await Promise.race([
        settled.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), HANG_MS),
        ),
      ]);
    }
    return answer;
  }

  function judge(sweep: Sweep, c: Case, entry: Entry, answer: Probe) {
    sweep.checks++;
    if ('hang' in answer) {
      if (answer.stopped && c.budgetIsEnough) {
        sweep.stoppedAtBound++;
      } else {
        sweep.fail(
          'hang',
          entry,
          c,
          answer.stopped
            ? `still running after ${HANG_MS / 1000} s, and stopped only when cancelled`
            : `still running after ${HANG_MS / 1000} s${answer.stopped === false ? ', and did not stop when cancelled' : ''}`,
        );
      }
      return;
    }
    if (answer.ms > HANG_MS) {
      sweep.fail(
        'hang',
        entry,
        c,
        `returned only after the ${HANG_MS / 1000} s hang bound`,
      );
    }
    if (answer.ok) return;
    let t = answer.thrown;
    if (t.kind === 'raw') {
      sweep.fail(
        'raw',
        entry,
        c,
        `${t.name}${t.sqlstate ? ` (SQLSTATE ${t.sqlstate})` : ''}: ${t.message}`,
      );
      return;
    }
    if (!t.code) {
      sweep.fail(
        'uncoded',
        entry,
        c,
        `refused with no grammar code (${t.name} ${t.requestCode ?? ''}): ${t.message}`,
      );
    } else if (!DOCUMENTED_CODES.has(t.code)) {
      sweep.fail(
        'uncoded',
        entry,
        c,
        `refused with the undocumented code "${t.code}": ${t.message}`,
      );
    }
    let leak = leakIn(t.message, ownText(c));
    if (leak) {
      sweep.fail('leak', entry, c, `the refusal carries ${leak}: ${t.message}`);
    }
  }

  function judgeRows(sweep: Sweep, c: Case, entry: Entry, ids: string[]) {
    let strays = ids.filter((id) => !FIXTURE_IDS.has(id));
    if (strays.length) {
      sweep.fail(
        'rows',
        entry,
        c,
        `returned rows the fixture does not hold: ${strays.slice(0, 3).join(', ')}`,
      );
    }
    let expected = c.expect?.ids;
    let short = (urls: string[]) =>
      `[${urls.map((u) => u.replace(testRealm, '')).join(' ')}]`.slice(0, 400);
    if (expected) {
      let maybe = c.expect?.maybe ?? [];
      let decided = ids.filter((id) => !maybe.includes(id));
      let same = c.expect?.ordered
        ? ids.join('\n') === expected.join('\n')
        : [...decided].sort().join('\n') === [...expected].sort().join('\n');
      if (!same) {
        sweep.fail(
          'rows',
          entry,
          c,
          `expected ${short(expected)} but got ${short(ids)}`,
        );
      }
    }
    let atLeast = c.expect?.atLeast;
    if (atLeast) {
      let missing = atLeast.filter((id) => !ids.includes(id));
      if (missing.length) {
        sweep.fail(
          'rows',
          entry,
          c,
          `did not return ${short(missing)}; got ${short(ids)}`,
        );
      }
    }
  }

  const idOf = (card: { id?: string }) =>
    String(card.id ?? '').replace(/\.json$/, '');

  // A case that expects rows was refused instead: a failure, unless the
  // case allows that refusal.
  function judgeRefusedAnswer(
    sweep: Sweep,
    c: Case,
    entry: Entry,
    answer: Probe,
  ) {
    let expects = c.expect?.ids ?? c.expect?.atLeast;
    if (!expects || 'hang' in answer || answer.ok) return;
    let t = answer.thrown;
    // a raw error is already counted
    if (t.kind === 'raw') return;
    let allowed = c.expect?.orRefused;
    if (allowed === true || (allowed !== undefined && allowed === t.code)) {
      return;
    }
    sweep.fail(
      'rows',
      entry,
      c,
      `expected ${expects.length} rows, but it was refused (${t.code}): ${t.message}`,
    );
  }

  async function searchEngine(
    sweep: Sweep,
    c: Case,
    entry: Entry,
    q: any,
    opts: Record<string, unknown> = {},
  ) {
    sweep.dbRuns++;
    let answer = await bounded(async (signal) => {
      // A query in the newer spellings is lowered first, as the wire parser
      // lowers it: `engine.searchCards` reads no top-level `type` (the test
      // of that is with the base queries, below).
      let lowered = usesNewSyntax(q)
        ? lowerQuery(q, { knownFunctions: BXL_FORMULA_FUNCTIONS })
        : undefined;
      let withPage = applyServerSearchPageBound((lowered?.query ?? q) as Query);
      engineRunning = true;
      try {
        return await engine.searchCards(
          new URL(c.realm ?? testRealm),
          withPage,
          {
            ...opts,
            signal,
          },
        );
      } finally {
        engineRunning = false;
      }
    });
    judge(sweep, c, entry, answer);
    judgeRefusedAnswer(sweep, c, entry, answer);
    if (!('hang' in answer) && answer.ok) {
      judgeRows(sweep, c, entry, answer.value.cards.map(idOf));
    }
    return answer;
  }

  // The table form: the columns the wire parser read, planned and read.
  async function searchTable(sweep: Sweep, c: Case, parsed: any) {
    sweep.dbRuns++;
    let anchor = parsed.itemQuery?.filter?.on ?? parsed.itemQuery?.filter?.type;
    let answer = await bounded(async (signal) => {
      if (!anchor) {
        throw new InvalidQueryError('select needs a type', 'needs-type');
      }
      let plans = await engine.planColumns(anchor, parsed.columns);
      return await engine.searchColumns(
        new URL(testRealm),
        applyServerSearchPageBound(parsed.itemQuery),
        { signal },
        plans,
      );
    });
    judge(sweep, c, 'select', answer);
    judgeRefusedAnswer(sweep, c, 'select', answer);
    if (!('hang' in answer) && answer.ok) {
      judgeRows(
        sweep,
        c,
        'select',
        answer.value.rows.map((row: unknown[]) =>
          String(row[0]).replace(/\.json$/, ''),
        ),
      );
      if (c.expect?.table) {
        let got = JSON.stringify(
          answer.value.rows.map((row: unknown[]) => row.slice(1)),
        );
        let want = JSON.stringify(c.expect.table);
        if (got !== want) {
          sweep.fail(
            'rows',
            'select',
            c,
            `the table should read ${want.slice(0, 300)} but reads ${got.slice(0, 300)}`,
          );
        }
      }
    }
    return answer;
  }

  // The invariant, for one case, at every entry point that accepts it.
  async function survives(sweep: Sweep, c: Case) {
    sweep.cases++;
    running = c.seed;
    let large = !c.inProcess && hasRecipe(c.input);
    let input = large ? undefined : c.input;
    let accepted = false;

    if (!c.wireOnly) {
      // 1. the grammar
      let asserted = large
        ? await probe('assertQuery', c.input)
        : attempt(() => assertQuery(input));
      judge(sweep, c, 'assertQuery', asserted);
      judgeRefusedAnswer(sweep, c, 'assertQuery', asserted);
      accepted = !('hang' in asserted) && asserted.ok;
      if (c.expect?.accepted && !accepted) {
        sweep.fail(
          'expectation',
          'assertQuery',
          c,
          `a valid query was refused: ${'hang' in asserted ? 'hang' : !asserted.ok ? asserted.thrown.message : ''}`,
        );
      }
      if (c.expect?.refused) {
        if (accepted) {
          sweep.fail(
            'expectation',
            'assertQuery',
            c,
            `accepted, where the grammar should refuse it${c.expect.refused === true ? '' : ` (${c.expect.refused})`}`,
          );
        } else if (!('hang' in asserted) && !asserted.ok) {
          let t = asserted.thrown;
          if (c.expect.refused !== true && t.code !== c.expect.refused) {
            sweep.fail(
              'expectation',
              'assertQuery',
              c,
              `refused with "${t.code}" where "${c.expect.refused}" is documented: ${t.message}`,
            );
          }
          if (c.expect.suggests && !namesMember(t.message, c.expect.suggests)) {
            sweep.fail(
              'expectation',
              'assertQuery',
              c,
              `the refusal does not name "${c.expect.suggests}": ${t.message}`,
            );
          }
        }
      }
      // a check that hangs once is not run again through the other doors
      if ('hang' in asserted) return;

      // 2. the lowering, reached as its callers reach it
      let lowered = large
        ? await probe('lowerQuery', c.input)
        : attempt(() => {
            if (usesNewSyntax(input)) {
              lowerQuery(input, { knownFunctions: BXL_FORMULA_FUNCTIONS });
            }
          });
      judge(sweep, c, 'lowerQuery', lowered);
      if ('hang' in lowered) return;
    }

    // 3. the wire parser, for input JSON can carry
    let parsed: Probe | undefined;
    let hasOwnWire =
      c.wireAsGiven || (c.wire !== undefined && c.wire !== false);
    if (!c.inProcess && (hasOwnWire || c.wire !== false)) {
      let wire = hasOwnWire ? c.wire : c.input;
      if (hasRecipe(wire)) {
        parsed = await probe('wire', wire);
      } else {
        let json = attempt(() => JSON.parse(JSON.stringify(wire) ?? 'null'));
        if (!('hang' in json) && json.ok) {
          let payload = json.value;
          parsed = attempt(() => parseSearchEntryQueryFromPayload(payload));
        }
      }
      if (parsed) {
        judge(sweep, c, 'wire', parsed);
        if (c.wireOnly) judgeRefusedAnswer(sweep, c, 'wire', parsed);
      }
    }

    // 4. the engine, for a query the grammar accepts
    if (c.db === false) return;
    let wanted = c.db === true || Boolean(c.expect?.ids || c.expect?.atLeast);
    if (accepted && (wanted || sweep.sample())) {
      await searchEngine(sweep, c, 'engine', large ? build(c.input) : input);
    }
    if (parsed && !('hang' in parsed) && parsed.ok && parsed.value) {
      let entryQuery = parsed.value;
      // The parsed form of the same query runs too where the wire payload is
      // the case's own, or where the grammar check did not take the query.
      let own = hasOwnWire && (c.wireOnly || wanted);
      if (entryQuery.columns) {
        if (own || sweep.sample()) await searchTable(sweep, c, entryQuery);
      } else if (own || (!accepted && sweep.sample())) {
        await searchEngine(sweep, c, 'engine (wire)', entryQuery.itemQuery, {
          ...(entryQuery.cardUrls ? { cardUrls: entryQuery.cardUrls } : {}),
        });
      }
    }
  }

  // A log query, through the `_search` answer for one: a 200, or a 400 that
  // carries the code for a refused log query.
  const LOG_REFUSAL_CODES = new Set([
    'invalid-value',
    'invalid-page',
    'unknown-key',
    'missing-member',
    'conflicting-members',
    'limit-exceeded',
  ]);
  async function logSurvives(sweep: Sweep, c: Case) {
    sweep.cases++;
    sweep.dbRuns++;
    running = c.seed;
    let answer = await bounded(() =>
      logSearchResponse(adapter, testRealm, c.input),
    );
    judge(sweep, c, 'log', answer);
    if ('hang' in answer || !answer.ok) return;
    let { status, body } = answer.value as { status: number; body: any };
    if (status === 200) {
      if (!Array.isArray(body.data) || body.data.length > LOG_LINES.length) {
        sweep.fail('rows', 'log', c, `returned more lines than the log holds`);
      }
      return;
    }
    let error = body?.errors?.[0];
    // A refusal carries the card grammar's code for the mistake, or a log's
    // own: a log no pass has synced (409) or one that does not exist (404).
    let coded =
      (status === 400 && LOG_REFUSAL_CODES.has(error?.code)) ||
      (status === 409 && error?.code === 'log-not-indexed') ||
      (status === 404 && error?.code === 'log-not-found');
    if (!coded) {
      sweep.fail(
        'uncoded',
        'log',
        c,
        `status ${status} with code ${error?.code}`,
      );
    }
    let leak = leakIn(String(error?.message), ownText(c));
    if (leak) {
      sweep.fail(
        'leak',
        'log',
        c,
        `the refusal carries ${leak}: ${error?.message}`,
      );
    }
  }

  // What every group asserts once its cases have run.
  async function conclude(assert: Assert, sweep: Sweep) {
    running = `${sweep.group} (end)`;
    // a late rejection has a turn to arrive
    await new Promise((resolve) => setTimeout(resolve, 20));
    let tally = `${sweep.group}: ${sweep.cases} cases, ${sweep.checks} checks, ${sweep.dbRuns} run against the database${sweep.stoppedAtBound ? ` (${sweep.stoppedAtBound} stopped at the ${HANG_MS / 1000} s bound)` : ''}, in ${Math.round((Date.now() - sweep.started) / 1000)} s`;
    assert.ok(true, tally);
    // a TAP comment, so a run's log says how much each group covered
    console.log(`# query-fuzz ${tally}`);
    let live = await bounded(() =>
      engine.searchCards(new URL(testRealm), {
        filter: { on: T, eq: { label: 'canary' } },
      }),
    );
    assert.deepEqual(
      !('hang' in live) && live.ok ? live.value.cards.map(idOf) : live,
      idsWhere((s) => s.label === 'canary'),
      'the engine still answers an ordinary query afterward',
    );
    assert.deepEqual(
      await stateOfIndex(),
      baseline,
      'the index, the log and the canary row are unchanged',
    );
    assert.deepEqual(
      prototypesNow(),
      prototypes,
      'Object.prototype, Array.prototype and Function.prototype have no new properties',
    );
    assert.strictEqual(
      (globalThis as any).__queryFuzzCanary,
      'intact',
      'the canary global is untouched',
    );
    assert.strictEqual(
      ({} as any).polluted,
      undefined,
      'no object inherits a planted property',
    );
    assert.false(
      existsSync(SENTINEL_FILE),
      'no payload wrote the sentinel file',
    );
    assert.deepEqual(unhandled, [], 'no rejection went unhandled');
    unhandled = [];
    assert.strictEqual(
      sweep.of('crash').length,
      0,
      `no input takes down the thread or the process that evaluates it, or reads what it must not: ${sweep.report('crash')}`,
    );
    assert.strictEqual(
      sweep.of('raw').length,
      0,
      `no input surfaces a raw JavaScript or database error: ${sweep.report('raw')}`,
    );
    assert.strictEqual(
      sweep.of('hang').length,
      0,
      `no input hangs an entry point: ${sweep.report('hang')}`,
    );
    assert.strictEqual(
      sweep.of('rows').length,
      0,
      `rows are fixture rows, and a value lookup returns exactly the rows that hold the value: ${sweep.report('rows')}`,
    );
    assert.strictEqual(
      sweep.of('leak').length,
      0,
      `no refusal carries SQL, a stack, a path or another row's value: ${sweep.report('leak')}`,
    );
    assert.strictEqual(
      sweep.of('uncoded').length,
      0,
      `every refusal carries a documented code: ${sweep.report('uncoded')}`,
    );
    assert.strictEqual(
      sweep.of('expectation').length,
      0,
      `the grammar accepts and refuses what the documentation says: ${sweep.report('expectation')}`,
    );
  }

  // -- setup -----------------------------------------------------------------

  hooks.before(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    vectors = await hasVectorIndex(adapter);
    let { encodeVector, queryableValue } = VectorSerializer;

    let writer = new IndexWriter(adapter);
    let seedBatch = async (
      typeRef: ResolvedCodeRef,
      rows: { url: string; doc: Record<string, unknown>; markdown: string }[],
    ) => {
      let batch = await writer.createBatch(
        new URL(testRealm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      let lookup = makeDefinitionLookup();
      let facets = await facetFieldSpecsOf(
        await lookup.lookupDefinition(typeRef),
        (r) => lookup.lookupDefinition(r as ResolvedCodeRef),
      );
      for (let row of rows) {
        let cardURL = new URL(`${row.url}.json`);
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(row.url),
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: { module: rri(typeRef.module), name: typeRef.name },
            },
          },
          lastModified: 1_000,
          resourceCreatedAt: 1_000,
          // the declared facet fields, as a render stamps them
          searchData: {
            ...row.doc,
            [SEARCH_TEXT_KEY]: {
              ...((row.doc[SEARCH_TEXT_KEY] as object) ?? {}),
              facets,
            },
          },
          markdown: row.markdown,
          deps: new Set(),
          displayNames: [typeRef.name],
          types: [internalKeyFor(typeRef, undefined, virtualNetwork)],
          isolatedHtml: `<div>${typeRef.name}</div>`,
        } as any);
      }
      await batch.done();
    };

    await seedBatch(
      T,
      SPECIMENS.map((s) => ({
        url: s.url,
        markdown: `${s.label}\n\n${s.note}`,
        doc: {
          label: s.label,
          note: s.note,
          code: s.code,
          tags: s.tags,
          amount: s.amount,
          rating: s.rating,
          day: s.day,
          secret: s.secret,
          ...(s.embedding && vectors
            ? { embedding: queryableValue(encodeVector(s.embedding)) }
            : {}),
          [SEARCH_TEXT_KEY]: {
            A: s.label,
            D: s.note,
            typos: s.label,
            patterns: s.code,
          },
          _typeahead: s.label,
        },
      })),
    );

    let keywordRows = () =>
      Array.from({ length: KEYWORD_ROWS }, (_, n) => ({
        url: keywordUrl(n),
        markdown: `keyword ${n}`,
        doc: Object.fromEntries([
          ...keywordFields.map((field) => [field, keywordValue(field, n)]),
          ['rank', n],
        ]),
      }));
    try {
      await seedBatch(K, keywordRows());
    } catch (e) {
      // The names every object inherits could not be indexed: the fixture
      // goes on without them, and a test below says so.
      keywordSeedError = `${describe(e).name}: ${describe(e).message}`;
      keywordFields = [...SAFE_KEYWORD_FIELDS];
      await seedBatch(K, keywordRows());
    }

    let host: LogLineIndexHost = {
      dbAdapter: adapter,
      realmURL: testRealm,
      query: (e: Expression) => runSql(adapter, e) as any,
      readLogFile: async (url) =>
        url === LOG_URL
          ? { content: LOG_LINES.map((l) => `${l}\n`).join('') }
          : undefined,
    } as LogLineIndexHost;
    await syncLogFile(host, LOG_URL);

    (globalThis as any).__queryFuzzCanary = 'intact';
    process.env.QUERY_FUZZ_SECRET = ENV_SECRET;
    process.on('unhandledRejection', onUnhandled);
    baseline = await stateOfIndex();
    prototypes = prototypesNow();
  });

  hooks.after(async function () {
    process.off('unhandledRejection', onUnhandled);
    delete process.env.QUERY_FUZZ_SECRET;
    delete (globalThis as any).__queryFuzzCanary;
    await stopProbeThread();
    await closeTestPgAdapter(adapter);
  });

  // -- the fixture itself ----------------------------------------------------

  test('the fixture holds every hostile string, and the index writer stored each one unchanged', async function (assert) {
    let rows = (await adapter.execute(
      `SELECT url, spill_text(search_doc -> 'label') AS label FROM boxel_index WHERE type = 'instance' AND search_doc ? 'label' ORDER BY url`,
    )) as { url: string; label: string }[];
    assert.deepEqual(
      rows.map((r) => r.label),
      SPECIMENS.map((s) => s.label),
      'each label reads back as it was written',
    );
    assert.true(
      Number(baseline.indexRows) >= SPECIMENS.length + KEYWORD_ROWS,
      'the rows are there',
    );
    assert.strictEqual(baseline.canary, CANARY_SECRET, 'and so is the canary');
    assert.strictEqual(
      baseline.logRows,
      LOG_LINES.length,
      'the log is indexed',
    );
  });

  test('a card type may name its fields with words every JavaScript object inherits', function (assert) {
    assert.strictEqual(
      keywordSeedError,
      undefined,
      `fields named ${INHERITED_KEYWORD_FIELDS.join(', ')} are indexed like any other`,
    );
  });

  // -- group 1: wrong input shapes ------------------------------------------

  test('the valid queries the fuzzer starts from are valid at every entry point', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('base queries');
    let bases = baseQueries(vectors);
    assert.true(bases.length >= 40, `${bases.length} base queries`);
    for (let [i, base] of bases.entries()) {
      await survives(sweep, {
        seed: `base/${i}`,
        input: base,
        wire: usesNewSyntax(base)
          ? undefined
          : searchEntryWireQueryFromQuery(base as Query),
        expect: { accepted: true, atLeast: [] },
      });
    }
    await conclude(assert, sweep);
  });

  test('a query that names its type once, at the top, is about that type when the engine is handed it as written', async function (assert) {
    // "A query may name its card type once, at the top": the filter and every
    // sort entry inherit it. The rest of this file lowers such a query before
    // the engine sees it, as the wire parser does; here the engine gets it as
    // the grammar accepted it.
    let ids = async (q: Record<string, unknown>) => {
      let answer = await bounded((signal) =>
        engine.searchCards(new URL(testRealm), q as Query, { signal }),
      );
      return 'hang' in answer
        ? 'hang'
        : answer.ok
          ? answer.value.cards.map(idOf)
          : `${answer.thrown.name}: ${answer.thrown.message}`;
    };
    assert.deepEqual(
      await ids({ type: K }),
      ALL_KEYWORDS,
      '{ type } alone is every card of the type, and no other',
    );
    assert.deepEqual(
      await ids({ type: K, filter: { eq: { select: 'select-1' } } }),
      [1, 4, 7].map(keywordUrl),
      'the filter reads its fields on that type',
    );
    assert.deepEqual(
      await ids({
        type: T,
        sort: [{ by: 'amount', direction: 'desc' }],
        page: { size: 3 },
      }),
      [...SPECIMENS]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3)
        .map((s) => s.url),
      'and so does a sort entry',
    );
  });

  test('group 1: any JSON value where a query or a member is expected', async function (assert) {
    assert.timeout(900_000);
    let sweep = new Sweep('group 1, JSON values');
    let n = 0;
    for (let [where, place] of POSITIONS) {
      for (let [what, atom] of JSON_ATOMS) {
        let large = isRecipe(atom);
        await survives(sweep, {
          seed: `g1/json/${n++}`,
          input: place(atom),
          label: large ? `${what} as ${where}` : undefined,
        });
      }
    }
    await conclude(assert, sweep);
  });

  test('group 1: values JSON cannot carry, at the in-process entry points', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('group 1, in-process values');
    let n = 0;
    let count = inProcessAtoms().length;
    for (let [where, place] of POSITIONS) {
      for (let a = 0; a < count; a++) {
        let [what, atom] = inProcessAtoms()[a];
        await survives(sweep, {
          seed: `g1/in-process/${n++}`,
          input: place(atom),
          label: `${what} as ${where}`,
          wire: false,
          inProcess: true,
        });
      }
    }
    // The two values that read one way when checked and another when run,
    // where they matter, always against the database.
    for (let [what, atom] of inProcessAtoms().filter(([name]) =>
      name.includes('when run'),
    )) {
      await survives(sweep, {
        seed: `g1/in-process/${n++}`,
        input: what.startsWith('a page')
          ? { filter: { type: T }, page: atom }
          : { filter: { type: T }, sort: [atom] },
        label: what,
        wire: false,
        inProcess: true,
        db: true,
      });
    }
    await conclude(assert, sweep);
  });

  for (let seed of [0x51ed270b, 0x0badc0de, 0x7f4a7c15]) {
    test(`group 1: valid queries, randomly mutated (seed 0x${seed.toString(16)})`, async function (assert) {
      assert.timeout(900_000);
      let sweep = new Sweep('group 1, mutations');
      let next = sequence(seed);
      let bases = baseQueries(vectors);
      let wireExtras = [
        {},
        { select: ['label', { n: 'amount' }] },
        { scope: 'cards' },
        { realms: [testRealm] },
        { federation: { results: 'merged' } },
        { cardUrls: [SPECIMENS[0].url] },
        { fields: { entry: ['item'] } },
      ];
      for (let n = 0; n < 500; n++) {
        let b = Math.floor(next() * bases.length);
        let base = bases[b];
        let { tree, note } = mutate(base, next, JSON_ATOMS);
        // The same base as the wire spells it, mutated on its own: a
        // newer-spelling query travels as written, an older one through
        // `item.` paths.
        let wireBase = {
          ...(usesNewSyntax(base)
            ? base
            : searchEntryWireQueryFromQuery(base as Query)),
          ...pick(next, wireExtras),
        };
        let wire = mutate(wireBase, next, JSON_ATOMS);
        let large = hasRecipe(tree) || hasRecipe(wire.tree);
        await survives(sweep, {
          seed: `g1/mutation seed=0x${seed.toString(16)} case=${n} base=${b}`,
          input: tree,
          wire: wire.tree,
          wireAsGiven: true,
          label: large
            ? `base ${b}: ${note}; on the wire: ${wire.note}`
            : undefined,
        });
      }
      await conclude(assert, sweep);
    });
  }

  test('group 1: valid queries mutated with values JSON cannot carry (seed 0x2545f491)', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('group 1, in-process mutations');
    let next = sequence(0x2545f491);
    let bases = baseQueries(vectors);
    for (let n = 0; n < 400; n++) {
      let b = Math.floor(next() * bases.length);
      let tree = structuredClone(bases[b]);
      let slots = slotsOf(tree);
      let atoms = inProcessAtoms();
      let [what, atom] = pick(next, atoms);
      let where = 'the query';
      if (slots.length === 0 || next() < 0.05) {
        tree = atom;
      } else {
        let { parent, key } = pick(next, slots);
        parent[key] = atom;
        where = String(key);
      }
      await survives(sweep, {
        seed: `g1/in-process-mutation seed=0x2545f491 case=${n} base=${b}`,
        input: tree,
        label: `base ${b} with ${what} at ${where}`,
        wire: false,
        inProcess: true,
      });
    }
    await conclude(assert, sweep);
  });

  // -- group 2: typos in the language itself ---------------------------------

  test('group 2: a misspelled member of a newer-spelling query is refused with unknown-key and the right name', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('group 2, misspelled members');
    for (let [place, template] of Object.entries(TEMPLATES)) {
      let name = place.split('.')[1];
      // the template with the right name is a valid query
      await survives(sweep, {
        seed: `g2/right/${place}`,
        input: template(name),
        expect: { accepted: true },
        db: false,
      });
      for (let [edit, wrong] of misspellings(name)) {
        // `type` misspelled leaves no newer member, and the query is then in
        // the older spelling, where a top-level member is refused all the same
        await survives(sweep, {
          seed: `g2/typo/${place}/${edit}`,
          input: template(wrong),
          expect: { refused: 'unknown-key', suggests: name },
          db: false,
        });
      }
    }
    await conclude(assert, sweep);
  });

  test('group 2: an unknown member beside a valid one is ignored in the older spelling', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('group 2, older spelling');
    // The three places queries saved in realms carry members the grammar
    // never read (older-query-spelling-test.ts): a filter, a sort entry, a
    // page. The answer is the one the query gives without the member.
    let canary = idsWhere((s) => s.label === 'canary');
    let byAmount = [...SPECIMENS]
      .sort((a, b) => b.amount - a.amount)
      .map((s) => s.url);
    let n = 0;
    for (let name of [
      ...GRAMMAR.operator,
      ...GRAMMAR.matchesOption,
      ...GRAMMAR.sort,
      ...GRAMMAR.page,
    ]) {
      for (let [edit, wrong] of misspellings(name)) {
        await survives(sweep, {
          seed: `g2/older/filter/${name}/${edit}/${n++}`,
          input: { filter: { on: T, eq: { label: 'canary' }, [wrong]: 'x' } },
          wire: false,
          expect: { accepted: true, ids: canary },
        });
        await survives(sweep, {
          seed: `g2/older/sort/${name}/${edit}/${n++}`,
          input: {
            filter: { type: T },
            sort: [{ on: T, by: 'amount', direction: 'desc', [wrong]: 'x' }],
          },
          wire: false,
          expect: { accepted: true, ids: byAmount, ordered: true },
        });
        await survives(sweep, {
          seed: `g2/older/page/${name}/${edit}/${n++}`,
          input: {
            filter: { on: T, eq: { label: 'canary' } },
            page: { size: 10, [wrong]: 'x' },
          },
          wire: false,
          expect: { accepted: true, ids: canary },
        });
      }
    }
    await conclude(assert, sweep);
  });

  test('group 2: a near-miss value is refused, not read as the nearest one', async function (assert) {
    assert.timeout(120_000);
    let sweep = new Sweep('group 2, near-miss values');
    let cases: [string, any, string][] = [];
    for (let direction of [
      'ascending',
      'ASC',
      'Asc',
      'descend',
      'descending',
      'DESC',
      ' asc',
      'asc ',
      'up',
      '',
    ]) {
      cases.push([
        'a sort direction',
        { type: T, sort: [{ by: 'amount', direction }] },
        'invalid-value',
      ]);
      cases.push([
        'the direction of an expression with top',
        { type: T, sort: [{ expression: 'amount', direction, top: 10 }] },
        'invalid-value',
      ]);
      cases.push([
        'an older-spelling sort direction',
        { filter: { type: T }, sort: [{ on: T, by: 'amount', direction }] },
        'invalid-value',
      ]);
    }
    for (let total of [
      'exactly',
      'Exact',
      'EXACT',
      'cap',
      'all',
      'no',
      '',
      true,
      1,
    ]) {
      cases.push([
        'page.total',
        { type: T, page: { size: 5, total } },
        'invalid-page',
      ]);
    }
    for (let missing of ['First', 'start', 'end', 'nulls first', true]) {
      cases.push([
        'sort missing',
        { type: T, sort: [{ by: 'amount', missing }] },
        'invalid-value',
      ]);
    }
    for (let flag of ['true', 'false', 'yes', 1, 0, 'TRUE']) {
      cases.push([
        'explain as text',
        { type: T, explain: flag },
        'invalid-value',
      ]);
      cases.push([
        'prefix as text',
        { type: T, filter: { matches: 'canary', prefix: flag } },
        'invalid-value',
      ]);
      cases.push([
        'typos as text',
        { type: T, filter: { matches: 'canary', typos: flag } },
        'invalid-value',
      ]);
      cases.push([
        'typeahead typos as text',
        {
          type: T,
          filter: { prefix: true, scope: 'title', matches: 'can', typos: flag },
        },
        'invalid-value',
      ]);
      cases.push([
        'facet stats as text',
        { type: T, facets: [{ by: 'amount', stats: flag }] },
        'invalid-value',
      ]);
      cases.push([
        'facet missing as text',
        { type: T, facets: [{ by: 'amount', missing: flag }] },
        'invalid-value',
      ]);
      cases.push([
        'one as text',
        {
          type: T,
          let: { $it: { from: { type: T }, one: flag } },
          filter: { eq: { rating: '$it.rating' } },
        },
        // Two rules are broken at once here (the value is of the wrong kind,
        // and the reference then names a binding of the wrong kind), so any
        // documented refusal will do.
        '',
      ]);
      cases.push([
        'exactTotal as text',
        { type: T, page: { size: 5, exactTotal: flag } },
        'invalid-page',
      ]);
    }
    for (let [value, member] of [
      ['RRF', 'method'],
      ['rrf ', 'method'],
      // `placement` is no member now: every expression runs in SQL
      ['SQL', 'placement'],
      ['Top', 'placement'],
    ] as const) {
      cases.push([
        member,
        member === 'method'
          ? { type: T, sort: [{ blend: [{ by: 'amount' }], method: value }] }
          : { type: T, sort: [{ expression: 'amount * 2', placement: value }] },
        member === 'method' ? 'invalid-value' : 'unknown-key',
      ]);
    }
    for (let value of ['Ignore', 'ignored', true]) {
      cases.push([
        'facet own',
        { type: T, facets: [{ by: 'rating', own: value }] },
        'invalid-value',
      ]);
    }
    for (let value of ['months', 'Month', 'monthly', 'quarter']) {
      cases.push([
        'facet interval',
        { type: T, facets: [{ by: 'day', interval: value }] },
        'invalid-value',
      ]);
    }
    for (let value of ['counts', 'Value', 'alphabetical']) {
      cases.push([
        'facet order',
        { type: T, facets: [{ by: 'rating', order: value }] },
        'invalid-value',
      ]);
    }
    for (let value of ['Title', 'titles', 'body']) {
      cases.push([
        'matches scope',
        { type: T, filter: { matches: 'canary', scope: value } },
        'invalid-value',
      ]);
    }
    for (let [i, [what, input, code]] of cases.entries()) {
      await survives(sweep, {
        seed: `g2/near-miss/${i} (${what})`,
        input,
        expect: { refused: code || true },
        db: false,
      });
    }
    await conclude(assert, sweep);
  });

  // -- shared: a string in every place a query takes one --------------------

  // A string as a VALUE of every operator. Where the value is data, the
  // expected rows come from the fixture.
  function valueCases(group: string, p: string, i: number): Case[] {
    let seed = (channel: string) => `${group}/value/${channel}/#${i}`;
    let exact = idsWhere((s) => s.label === p);
    let inTags = idsWhere((s) => s.tags.includes(p));
    let cases: Case[] = [
      {
        seed: seed('eq'),
        input: { type: T, filter: { eq: { label: p } } },
        expect: { ids: exact },
      },
      {
        seed: seed('eq, older spelling'),
        input: { filter: { on: T, eq: { label: p } } },
        wire: searchEntryWireQueryFromQuery({
          filter: { on: T, eq: { label: p } },
        } as Query),
        expect: { ids: exact },
      },
      {
        seed: seed('in'),
        input: { type: T, filter: { in: { label: [p, p] } } },
        expect: { ids: exact },
      },
      {
        seed: seed('eq on a list'),
        input: { type: T, filter: { eq: { tags: p } } },
        expect: { ids: inTags },
      },
      {
        seed: seed('in on a list'),
        input: { type: T, filter: { in: { tags: [p] } } },
        expect: { ids: inTags },
      },
      // a `not` over a list: the cards with no such element
      {
        seed: seed('not eq on a list'),
        input: { type: T, filter: { not: { eq: { tags: p } } } },
        expect: { ids: idsWhere((s) => !s.tags.includes(p)) },
      },
      {
        seed: seed('contains'),
        input: { type: T, filter: { contains: { label: p } } },
        // Ignoring case in ASCII is not in dispute. How other letters fold
        // is (pins nothing; rule not yet decided): a row whose label matches
        // only under a wider folding may come back or not, and a string with
        // letters outside ASCII is held only to the rows that hold it as
        // written.
        expect:
          p === ''
            ? {}
            : isAscii(p)
              ? {
                  ids: idsWhere((s) =>
                    asciiFold(s.label).includes(asciiFold(p)),
                  ),
                  maybe: idsWhere(
                    (s) =>
                      !asciiFold(s.label).includes(asciiFold(p)) &&
                      wideFold(s.label).includes(wideFold(p)),
                  ),
                }
              : { atLeast: idsWhere((s) => s.label.includes(p)) },
      },
      {
        seed: seed('range, both bounds the value'),
        input: { type: T, filter: { range: { label: { gte: p, lte: p } } } },
        // pins current behavior; rule not yet decided: on a text field a
        // bound that reads as a relative date is left unchecked here
        expect: isRelativeDateLike(p) ? {} : { ids: exact },
      },
      {
        seed: seed('pattern'),
        input: { type: T, filter: { pattern: { code: p } } },
        expect:
          p === ''
            ? { refused: 'invalid-value' }
            : isAscii(p)
              ? { ids: idsWhere((s) => globMatches(p, s.code)) }
              : {},
      },
      {
        seed: seed('regex'),
        input: { type: T, filter: { regex: { code: p } } },
      },
      { seed: seed('matches'), input: { type: T, filter: { matches: p } } },
      {
        seed: seed('matches, prefix'),
        input: { type: T, filter: { matches: p, prefix: true } },
      },
      {
        seed: seed('matches, typos'),
        input: { type: T, filter: { matches: p, typos: true } },
      },
      {
        seed: seed('matches, title'),
        input: { type: T, filter: { matches: p, scope: 'title' } },
      },
      {
        seed: seed('matches, fields'),
        input: { type: T, filter: { matches: p, fields: ['label', 'tags'] } },
      },
      {
        seed: seed('matches, text relevance'),
        input: {
          type: T,
          filter: { matches: p },
          sort: [{ by: 'textRelevance' }],
        },
      },
      {
        seed: seed('typeahead'),
        input: {
          type: T,
          filter: { prefix: true, scope: 'title', matches: p },
        },
      },
      {
        seed: seed('typeahead, typos'),
        input: {
          type: T,
          filter: { prefix: true, scope: 'title', matches: p, typos: true },
        },
      },
      {
        seed: seed('facet prefix'),
        input: { type: T, facets: [{ by: 'tags', prefix: p }] },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: seed('facet range bounds'),
        input: {
          type: T,
          facets: [{ by: 'label', ranges: [{ key: p, from: p, to: `${p}~` }] }],
        },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: seed('linkedFrom card'),
        input: {
          type: T,
          filter: { linkedFrom: { card: `${testRealm}${p}`, field: 'tags' } },
        },
      },
      {
        seed: seed('date bound'),
        input: { type: T, filter: { range: { day: { gte: p } } } },
      },
      {
        seed: seed('boost'),
        input: {
          type: T,
          sort: [
            {
              blend: [
                { by: 'amount' },
                { boost: { eq: { label: p } }, weight: 2 },
              ],
            },
          ],
        },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: seed('binding filter'),
        input: {
          type: T,
          let: {
            $hot: {
              // a value that spells the binding is escaped, or it reads it
              from: {
                type: T,
                filter: {
                  eq: {
                    label:
                      typeof p === 'string' && /^\$hot(\.|$)/.test(p)
                        ? { $literal: p }
                        : p,
                  },
                },
              },
              select: 'code',
            },
          },
          filter: { in: { code: '$hot' } },
        },
        expect: { ids: exact },
      },
      {
        seed: seed('comparison filter'),
        input: {
          type: T,
          sort: [
            {
              expression: 'amount - stats.amount.max',
              compare: { filter: { eq: { label: p } } },
            },
          ],
        },
        expect: { ids: ALL_SPECIMENS },
      },
    ];
    // A string the database cannot hold (a null byte, half a surrogate pair)
    // is in no row: the answer is the rows the plain evaluation gives, or a
    // coded refusal.
    if (isUnstorable(p)) {
      for (let c of cases) {
        if (c.expect?.ids || c.expect?.atLeast) c.expect.orRefused = true;
      }
    }
    return cases;
  }

  // A string as a NAME: a field, a path, a binding, an alias, a function.
  function nameCases(group: string, p: string, i: number): Case[] {
    let seed = (channel: string) => `${group}/name/${channel}/#${i}`;
    let q = (input: any, channel: string, more: Partial<Case> = {}): Case => ({
      seed: seed(channel),
      input,
      ...more,
    });
    return [
      q({ type: T, filter: { eq: { [p]: 'x' } } }, 'eq key'),
      q({ filter: { on: T, eq: { [p]: 'x' } } }, 'eq key, older spelling', {
        wire: false,
      }),
      q({ type: T, filter: { in: { [p]: ['x'] } } }, 'in key'),
      q({ type: T, filter: { contains: { [p]: 'x' } } }, 'contains key'),
      q({ type: T, filter: { range: { [p]: { gt: 1 } } } }, 'range key'),
      q({ type: T, filter: { pattern: { [p]: 'x*' } } }, 'pattern key'),
      q({ type: T, filter: { regex: { [p]: 'x' } } }, 'regex key'),
      q({ type: T, filter: { near: { [p]: { to: [1, 0, 0] } } } }, 'near key'),
      q(
        { type: T, filter: { eq: { [`label.${p}`]: 'x' } } },
        'a path under a field',
      ),
      q(
        { type: T, filter: { eq: { [`tags.${p}`]: 'x' } } },
        'a path under a list',
      ),
      q(
        { type: T, filter: { eq: { [`${p}.label`]: 'x' } } },
        'a path over a field',
      ),
      q({ type: T, filter: { exists: p } }, 'exists'),
      q({ type: T, filter: { missing: p } }, 'missing'),
      q(
        { type: T, filter: { matches: 'canary', fields: [p] } },
        'matches fields',
      ),
      q(
        { type: T, filter: { matches: 'canary', within: p } },
        'matches within',
      ),
      q(
        {
          type: T,
          filter: { linkedFrom: { card: SPECIMENS[0].url, field: p } },
        },
        'linkedFrom field',
      ),
      q({ type: T, sort: [{ by: p }] }, 'sort by'),
      q(
        { filter: { type: T }, sort: [{ on: T, by: p }] },
        'sort by, older spelling',
        { wire: false },
      ),
      q(
        { type: T, sort: [{ blend: [{ by: p }, { by: 'amount' }] }] },
        'blend signal',
      ),
      q({ type: T, collapse: p }, 'collapse'),
      q({ type: T, collapse: { by: p, keep: 2 } }, 'collapse by'),
      q({ type: T, facets: [{ by: p }] }, 'facet by'),
      q(
        { type: T, facets: [{ by: p, stats: true, missing: true }] },
        'facet by, stats',
      ),
      q(
        { type: T, facets: [{ by: 'rating', measure: { avg: p } }] },
        'facet measure',
      ),
      q(
        {
          type: T,
          let: { $hot: { from: { type: T }, select: p } },
          filter: { in: { code: '$hot' } },
        },
        'binding select',
      ),
      q(
        {
          type: T,
          let: { [`$${p}`]: { from: { type: T }, select: 'code' } },
          filter: { in: { code: `$${p}` } },
        },
        'binding name',
      ),
      q(
        {
          type: T,
          let: { $hot: { from: { type: T }, select: 'code' } },
          filter: { in: { code: [`$${p}`] } },
        },
        'a string naming no binding is text',
      ),
      q(
        {
          type: T,
          let: { $it: { from: { type: T }, one: true } },
          filter: { eq: { rating: `$it.${p}` } },
        },
        'a card binding path',
      ),
      q(
        {
          type: T,
          sort: [
            { expression: 'amount - stats.amount.max', compare: { by: p } },
          ],
        },
        'compare by',
      ),
      q(
        {
          type: T,
          sort: [
            { expression: 'amount - stats.amount.max', compare: { near: p } },
          ],
        },
        'compare near',
      ),
      q(
        { type: T, sort: [{ expression: `stats.${p}.max`, top: 10 }] },
        'a stats field',
      ),
      q(
        {
          type: T,
          sort: [{ relevance: { [p]: 1 } }],
          filter: { matches: 'canary' },
        },
        'relevance signal',
      ),
      q({ type: T }, 'select path', {
        wireOnly: true,
        wire: { type: T, select: [p] },
      }),
      q({ type: T }, 'select alias', {
        wireOnly: true,
        wire: { type: T, select: [{ [p]: 'label' }] },
      }),
      q({ type: T }, 'a top-level member', {
        wireOnly: true,
        wire: { type: T, [p]: 1 },
      }),
      q({ type: T, [p]: 1 }, 'a top-level member, in process', { wire: false }),
      q({ type: { module: p, name: 'Specimen' } }, 'type module'),
      q({ type: { module: T.module, name: p } }, 'type name'),
      q({ filter: { on: { module: p, name: p }, eq: { label: 'x' } } }, 'on', {
        wire: false,
      }),
      q(
        { filter: { type: { module: `${testRealm}${p}`, name: p } } },
        'filter type',
      ),
      q(
        { type: T, sort: [{ on: { module: p, name: p }, by: 'amount' }] },
        'sort on',
      ),
      q(
        { type: T, collapse: { by: 'rating', on: { module: p, name: p } } },
        'collapse on',
      ),
    ];
  }

  // A string where the grammar takes one of a few words, or a number.
  function wordCases(group: string, p: string, i: number): Case[] {
    let seed = (channel: string) => `${group}/word/${channel}/#${i}`;
    let q = (input: any, channel: string, more: Partial<Case> = {}): Case => ({
      seed: seed(channel),
      input,
      ...more,
    });
    return [
      q({ type: T, sort: [{ by: 'amount', direction: p }] }, 'sort direction'),
      q(
        { filter: { type: T }, sort: [{ by: 'lastModified', direction: p }] },
        'sort direction, older spelling',
        { wire: false },
      ),
      q({ type: T, sort: [{ by: 'amount', missing: p }] }, 'sort missing'),
      q(
        {
          type: T,
          sort: [{ blend: [{ by: 'amount' }], direction: p, method: p }],
        },
        'blend direction and method',
      ),
      q(
        { type: T, sort: [{ expression: 'amount', placement: p }] },
        'placement',
      ),
      q(
        { type: T, sort: [{ expression: 'amount', direction: p, top: 10 }] },
        'the direction of an expression with top',
      ),
      q({ type: T, page: { size: p } }, 'page size'),
      q({ type: T, page: { size: 5, number: p } }, 'page number'),
      q({ type: T, page: { size: 5, total: p } }, 'page total'),
      q({ type: T, facets: [{ by: 'rating', size: p }] }, 'facet size'),
      q({ type: T, facets: [{ by: 'rating', own: p }] }, 'facet own'),
      q({ type: T, facets: [{ by: 'rating', order: p }] }, 'facet order'),
      q({ type: T, facets: [{ by: 'day', interval: p }] }, 'facet interval'),
      q({ type: T, filter: { matches: 'canary', scope: p } }, 'matches scope'),
      q({ type: T, collapse: { by: 'rating', keep: p } }, 'collapse keep'),
      q(
        { type: T, sort: [{ expression: 'amount', top: p }] },
        'an expression sort entry top',
      ),
      q(
        { type: T, filter: { near: { embedding: { to: [p] } } } },
        'a vector component',
      ),
      q({ type: T, filter: { near: { embedding: { to: p } } } }, 'a vector'),
      q(
        {
          type: T,
          filter: {
            near: {
              embedding: {
                to: { dims: 3, encoding: 'int8', scale: 1, data: p },
              },
            },
          },
        },
        'a stored vector',
      ),
      q(
        {
          type: T,
          filter: {
            near: { embedding: { to: { dims: 3, encoding: p, data: 'AAAA' } } },
          },
        },
        'a vector encoding',
      ),
      q({ type: T, sort: [{ by: 'embedding', near: p }] }, 'a sort vector'),
      q({ type: T }, 'scope member', {
        wireOnly: true,
        wire: { type: T, scope: p },
      }),
      q({ type: T }, 'federation', {
        wireOnly: true,
        wire: { type: T, federation: { results: p } },
      }),
      q({ type: T }, 'realms', {
        wireOnly: true,
        wire: { type: T, realms: [p] },
      }),
      q({ type: T }, 'cardUrls', {
        wireOnly: true,
        wire: { type: T, cardUrls: [p] },
        // decided: text no index can store (a null byte, a lone surrogate)
        // is refused with invalid-value, here as everywhere in a request
        expect: isUnstorable(p)
          ? { ids: [], orRefused: 'invalid-value' }
          : { ids: [] },
      }),
      q({ type: T }, 'the realm searched', {
        realm: `http://query-fuzz.invalid/${Buffer.from(p.slice(0, 200)).toString('hex')}/x${p.length}/`,
        expect: { ids: [] },
        wire: false,
      }),
    ];
  }

  // A string as an expression, where one is evaluated.
  function expressionCases(group: string, p: string, i: number): Case[] {
    let seed = (channel: string) => `${group}/expression/${channel}/#${i}`;
    return [
      {
        seed: seed('sort'),
        input: { type: T, sort: [{ expression: p }] },
        db: true,
      },
      {
        seed: seed('sort, placement'),
        input: { type: T, sort: [{ expression: p, placement: 'sql' }] },
        expect: { refused: true },
      },
      {
        seed: seed('blend'),
        input: {
          type: T,
          sort: [{ blend: [{ by: 'amount' }, { expression: p }] }],
        },
      },
      {
        seed: seed('sort entry with top'),
        input: { type: T, sort: [{ expression: p, top: 100 }] },
      },
      {
        seed: seed('sort entry with top, beside an anchored filter'),
        input: {
          filter: { type: T },
          sort: [{ expression: p, top: 100 }, { by: 'cardURL' }],
        },
        wire: false,
        db: true,
      },
      {
        seed: seed('sort entry with a comparison set'),
        input: {
          type: T,
          sort: [{ expression: p, compare: { by: 'rating' } }],
        },
      },
    ];
  }

  // A log query with the string in each place a log query takes one.
  function logCases(group: string, p: string, i: number): Case[] {
    let seed = (channel: string) => `${group}/log/${channel}/#${i}`;
    let from = { log: LOG_PATH };
    let q = (input: any, channel: string): Case => ({
      seed: seed(channel),
      input,
    });
    return [
      q({ from: { log: p } }, 'the log name'),
      q({ from: { log: `${p}.jsonl` } }, 'a log path'),
      q({ from: { log: `${LOG_PATH}?${p}` } }, 'a log query string'),
      q({ from, filter: { eq: { 'what.action': p } } }, 'eq value'),
      q({ from, filter: { eq: { actor: p } } }, 'actor'),
      q({ from, filter: { eq: { line: p } } }, 'line'),
      q({ from, filter: { eq: { at: p } } }, 'at'),
      q({ from, filter: { eq: { [p]: 'x' } } }, 'eq path'),
      q({ from, filter: { in: { 'what.action': [p] } } }, 'in value'),
      q({ from, filter: { in: { 'what.action': p } } }, 'in, not a list'),
      q({ from, filter: { contains: { 'what.action': p } } }, 'contains'),
      q({ from, filter: { contains: { [p]: 'x' } } }, 'contains path'),
      q({ from, filter: { range: { at: { gte: p } } } }, 'a time bound'),
      q({ from, filter: { range: { line: { gte: p } } } }, 'a line bound'),
      q(
        { from, filter: { range: { 'what.weight': { gte: p } } } },
        'a range bound',
      ),
      q(
        { from, filter: { range: { 'what.weight': { [p]: 1 } } } },
        'a range operator',
      ),
      q({ from, filter: { exists: p } }, 'exists'),
      q({ from, filter: { [p]: 1 } }, 'a filter operator'),
      q({ from, filter: p }, 'a filter'),
      q({ from, filter: { every: p } }, 'every, not a list'),
      q({ from, sort: [{ by: p }] }, 'sort by'),
      q({ from, sort: [{ by: 'at', direction: p }] }, 'sort direction'),
      q({ from, sort: p }, 'sort, not a list'),
      q({ from, page: { size: p } }, 'page size'),
      q({ from, page: { number: p } }, 'page number'),
      q({ from, page: { total: p } }, 'page total'),
      q({ from, select: [p] }, 'select'),
      q({ from, select: p }, 'select, not a list'),
      q({ from, facets: [{ by: p }] }, 'facet by'),
      q({ from, facets: [{ by: 'what.action', size: p }] }, 'facet size'),
      q({ from, group: { by: p } }, 'group by'),
      q({ from, group: { by: [p, 'actor'] } }, 'group by, a list'),
      q(
        { from, group: { by: 'actor', aggregates: { [p]: { count: true } } } },
        'aggregate name',
      ),
      q(
        {
          from,
          group: { by: 'actor', aggregates: { n: { [p]: 'what.weight' } } },
        },
        'aggregate operator',
      ),
      q(
        { from, group: { by: 'actor', aggregates: { n: { sum: p } } } },
        'aggregate path',
      ),
      q(
        {
          from,
          group: { by: 'actor', aggregates: { n: { count: true } } },
          sort: [{ by: p }],
        },
        'grouped sort',
      ),
      q({ from, [p]: 1 }, 'a member'),
    ];
  }

  async function sweepStrings(
    assert: Assert,
    sweep: Sweep,
    group: string,
    strings: string[],
    kinds: ('value' | 'main values' | 'name' | 'word' | 'expression' | 'log')[],
  ) {
    for (let [i, p] of strings.entries()) {
      let cases = [
        ...(kinds.includes('value') ? valueCases(group, p, i) : []),
        // the operators a value most often meets, where every operator has
        // had its turn with strings of the same kind elsewhere
        ...(kinds.includes('main values')
          ? valueCases(group, p, i).filter((c) =>
              /\/(eq|in|eq on a list|contains|pattern|matches|typeahead)\/#/.test(
                c.seed,
              ),
            )
          : []),
        ...(kinds.includes('name') ? nameCases(group, p, i) : []),
        ...(kinds.includes('word') ? wordCases(group, p, i) : []),
        ...(kinds.includes('expression') ? expressionCases(group, p, i) : []),
      ];
      for (let c of cases) await survives(sweep, c);
      if (kinds.includes('log')) {
        for (let c of logCases(group, p, i)) await logSurvives(sweep, c);
      }
    }
    await conclude(assert, sweep);
  }

  // -- group 3: encoding messes ----------------------------------------------

  const ENCODING_MESSES: string[] = [
    '\uD800', // a lone high surrogate
    '\uDC00', // a lone low surrogate
    'a\uD83Db', // half a pair inside a word
    '\uDC00\uD800', // a pair the wrong way round
    '\uFEFF',
    '\uFEFFbom',
    '\u0000',
    'a\u0000b',
    'canary\u0000',
    '\u0001\u0002\u0003\u0007\u0008\u001B',
    'bell\u0007tab\tline\nend',
    '\uFFFD',
    'Cr\u00E8me',
    'Cre\u0300me',
    'creme',
    'CR\u00C8ME',
    `z${'\u0300\u0301\u0302\u0303\u0304\u0305'.repeat(1)}`,
    `z${'\u0300'.repeat(500)}`,
    'zero\u200Bwidth\u200Djoiner',
    'zerowidthjoiner',
    '\u200B',
    '\u202Eevil\u202C',
    '\u0440\u0430\u0443\u0440\u0430l',
    'paypal',
    '\uFF11\uFF12\uFF13\uFF21\uFF22\uFF23',
    '123ABC',
    '\u0130stanbul',
    'istanbul',
    'ISTANBUL',
    '\u0131stanbul',
    'stra\u00DFe',
    'STRASSE',
    'strasse',
    '\uFB01nal',
    'final',
    '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u{1F1EF}\u{1F1F5} \u{1F44D}\u{1F3FD}',
    '\u{1F44D}',
    '\u{1D11E}',
    '\u{1D11E}mid\u{1D11E}',
    'mid\u{1D11E}',
    '%27%20OR%201%3D1',
    "' OR 1=1",
    'JyBPUiAxPTE=',
    '&lt;script&gt;&#39;',
    '%2527',
    '%00',
    '\\u0000',
    `L${'o'.repeat(3000)}ng`,
    `L${'o'.repeat(3000)}`,
    'x'.repeat(70_000),
  ];

  test('group 3: encoding messes in values, text queries and patterns', async function (assert) {
    assert.timeout(600_000);
    await sweepStrings(
      assert,
      new Sweep('group 3, values', 4),
      'g3',
      ENCODING_MESSES,
      ['value'],
    );
  });

  test('group 3: encoding messes in names, words and log queries', async function (assert) {
    assert.timeout(600_000);
    await sweepStrings(
      assert,
      new Sweep('group 3, names', 4),
      'g3',
      ENCODING_MESSES,
      ['name', 'word', 'log'],
    );
  });

  test('group 3: words match across accents and normalization forms; values match as written', async function (assert) {
    assert.timeout(120_000);
    let sweep = new Sweep('group 3, normalization');
    let nfc = idsWhere((s) => s.label === 'Cr\u00E8me');
    let nfd = idsWhere((s) => s.label === 'Cre\u0300me');
    let cases: Case[] = [
      // "Accents fold everywhere words are matched": `creme` and `crème`
      // find "Crème", however the query spells its accent. Whether they
      // also find a card whose own text carries the accent as a combining
      // mark is not said (rule not yet decided), so that row may come back
      // or not.
      ...['creme', 'cr\u00E8me', 'cre\u0300me', 'CREME'].flatMap((word, i) => [
        {
          seed: `g3/fold/matches/${i}`,
          input: { type: T, filter: { matches: word } },
          expect: { ids: nfc, maybe: nfd },
        },
        {
          seed: `g3/fold/matches title/${i}`,
          input: { type: T, filter: { matches: word, scope: 'title' } },
          expect: { ids: nfc, maybe: nfd },
        },
        {
          seed: `g3/fold/matches fields/${i}`,
          input: { type: T, filter: { matches: word, fields: ['label'] } },
          expect: { ids: nfc, maybe: nfd },
        },
        {
          seed: `g3/fold/typeahead/${i}`,
          input: {
            type: T,
            filter: { prefix: true, scope: 'title', matches: word },
          },
          expect: { ids: nfc, maybe: nfd },
        },
      ]),
      // pins current behavior; rule not yet decided: `eq` compares code
      // points, so the two encodings of one word are two values
      {
        seed: 'g3/forms/eq nfc',
        input: { type: T, filter: { eq: { label: 'Cr\u00E8me' } } },
        expect: { ids: nfc },
      },
      {
        seed: 'g3/forms/eq nfd',
        input: { type: T, filter: { eq: { label: 'Cre\u0300me' } } },
        expect: { ids: nfd },
      },
      // a character outside the basic plane is one character to `contains`
      {
        seed: 'g3/astral/contains',
        input: { type: T, filter: { contains: { label: '\u{1D11E}' } } },
        expect: { ids: idsWhere((s) => s.label.includes('\u{1D11E}')) },
      },
      {
        seed: 'g3/astral/contains at the end',
        input: { type: T, filter: { contains: { label: 'mid\u{1D11E}' } } },
        expect: { ids: idsWhere((s) => s.label.includes('mid\u{1D11E}')) },
      },
      // half of one matches nothing
      {
        seed: 'g3/astral/half a character',
        input: { type: T, filter: { contains: { label: '\uD834' } } },
        expect: { ids: [], orRefused: true },
      },
      {
        seed: 'g3/astral/eq half a character',
        input: { type: T, filter: { eq: { label: '\uD834' } } },
        expect: { ids: [], orRefused: true },
      },
      // a look-alike is another string
      {
        seed: 'g3/homoglyph/eq',
        input: { type: T, filter: { eq: { label: 'paypal' } } },
        expect: { ids: idsWhere((s) => s.label === 'paypal') },
      },
      {
        seed: 'g3/homoglyph/contains',
        input: { type: T, filter: { contains: { label: 'paypal' } } },
        expect: { ids: idsWhere((s) => s.label.includes('paypal')) },
      },
      {
        seed: 'g3/full width/eq',
        input: { type: T, filter: { eq: { label: '123ABC' } } },
        expect: { ids: [] },
      },
      // a long value is found whole, and its prefix is not it
      {
        seed: 'g3/long/eq',
        input: { type: T, filter: { eq: { label: `L${'o'.repeat(3000)}ng` } } },
        expect: { ids: idsWhere((s) => s.label.startsWith('Looo')) },
      },
      {
        seed: 'g3/long/eq a prefix',
        input: { type: T, filter: { eq: { label: `L${'o'.repeat(3000)}` } } },
        expect: { ids: [] },
      },
      {
        seed: 'g3/long/contains its end',
        input: { type: T, filter: { contains: { label: 'ooong' } } },
        expect: { ids: idsWhere((s) => s.label.startsWith('Looo')) },
      },
    ];
    for (let c of cases) await survives(sweep, c);
    await conclude(assert, sweep);
  });

  test('group 3: text that only looks like a date is text to a date facet, a date bound and a date function', async function (assert) {
    assert.timeout(120_000);
    let sweep = new Sweep('group 3, date-like text');
    // One label reads "2024-13-45 not a date", and it is a tag of the next
    // row. Nothing here is refused for it, and the rows are every row.
    let cases: Case[] = [
      {
        seed: 'g3/date-like/facet by month',
        input: { type: T, facets: [{ by: 'label', interval: 'month' }] },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: 'g3/date-like/facet by year, a list',
        input: { type: T, facets: [{ by: 'tags', interval: 'year' }] },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: 'g3/date-like/sort by days since',
        input: { type: T, sort: [{ expression: 'DAYS(NOW(), label)' }] },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: 'g3/date-like/blend by days since',
        input: {
          type: T,
          sort: [
            {
              blend: [{ by: 'amount' }, { expression: 'DAYS(NOW(), label)' }],
            },
          ],
        },
        expect: { ids: ALL_SPECIMENS },
      },
      {
        seed: 'g3/date-like/the first rows re-ordered by days since',
        input: {
          filter: { type: T },
          sort: [{ expression: 'DAYS(NOW(), label)', top: 100 }],
        },
        wire: false,
        expect: { ids: ALL_SPECIMENS },
      },
      // "Any other string is a literal bound": compared as the text it is
      {
        seed: 'g3/date-like/a date bound',
        input: { type: T, filter: { range: { day: { gte: '2024-13-45' } } } },
        expect: {
          ids: idsWhere((s) => s.day != null && s.day >= '2024-13-45'),
        },
      },
    ];
    for (let c of cases) await survives(sweep, c);
    await conclude(assert, sweep);
  });

  // -- group 4: spreadsheet errors and formula injection ---------------------

  const SPREADSHEET_VALUES = HOSTILE_VALUES.slice(15, 30);
  const MALFORMED_FORMULAS: string[] = [
    '#DIV/0!',
    '#N/A',
    '#NAME?',
    '#NULL!',
    '#NUM!',
    '#REF!',
    '#VALUE!',
    '#SPILL!',
    '#CALC!',
    'IFERROR(#DIV/0!, 1)',
    'amount + #N/A',
    'ISERROR(#REF!)',
    '=amount',
    '=amount*2',
    '+amount',
    '-amount',
    '@amount',
    '@SUM(amount)',
    '\tamount',
    '\ramount',
    '(amount',
    'amount)',
    '((amount)',
    'IF(amount > 1, 1, 0',
    'IF(amount > 1; 1; 0)',
    'IF(amount > 1, 1; 0)',
    'IF()',
    'IF(amount)',
    'IF(amount > 1, 1, 0, 2, 3)',
    'ROUND()',
    'ROUND(amount, 1, 2, 3)',
    'ROUND(amount, 99)',
    'ROUND(amount, rating)',
    'MAX()',
    'LN()',
    'score + 1',
    '_expression + 1',
    '_window + 1',
    'A1:B2',
    'SUM(A1:B2)',
    'SUM(A:A)',
    'Sheet1!A1',
    "'My Sheet'!A1",
    '[Book1]Sheet1!A1',
    '$A$1',
    'R1C1',
    '{=SUM(amount)}',
    '{1,2,3}',
    '{1;2;3}',
    'SUM({1,2,3})',
    '1,5',
    'amount * 1,5',
    'ROUND(amount; 1,5)',
    '1.000,50',
    'amount +',
    'amount *',
    'amount /',
    '* amount',
    'amount + + + rating',
    'amount ** 2',
    'amount ^',
    'amount %',
    '1 / 0',
    'amount / 0',
    'LN(0)',
    'LN(-1)',
    'SQRT(-1)',
    'POWER(0, -1)',
    'EXP(1000)',
    'EXP(EXP(EXP(10)))',
    '10 ^ 400',
    '1e308 * 10',
    '1e999',
    '-1e999',
    '0.1 + 0.2',
    'DAYS(NOW(), label)',
    'DAYS(day, "x")',
    'DAYS(label, day)',
    'NOW()',
    'TODAY() + 1',
    'INDIRECT("A1")',
    'OFFSET(A1, 1, 1)',
    'HYPERLINK("http://example.invalid", "x")',
    'WEBSERVICE("http://example.invalid")',
    'CALL("kernel32", "x")',
    'EXEC("id")',
    'RTD("x", , "y")',
    'DDE("cmd", "/C calc", "x")',
    'REPT("x", 100000000)',
    'REPT(REPT("x", 10000), 10000)',
    'LEN(REPT("x", 1000000))',
    'CONCAT(label, label, label)',
    'label & label',
    '""',
    '"unterminated',
    "'single'",
    'amount ? 1 : 0',
    'amount == 1 ? 1 : 0',
    'amount; rating',
    'LAMBDA(x, x)(1)',
    'LET(x, 1, x)',
    'amount'.concat(' + amount'.repeat(9999)), // a 10,000-term sum
    `${'IF(amount > 1, '.repeat(1000)}1${', 0)'.repeat(1000)}`, // 1,000 nested IFs
    `${'('.repeat(5000)}amount${')'.repeat(5000)}`,
    `${'-'.repeat(5000)}amount`,
    `amount${' + 1'.repeat(400)}`,
    `MAX(${Array.from({ length: 300 }, () => 'amount').join(', ')})`,
    `IF(${'IF('.repeat(40)}amount${', 1, 0)'.repeat(40)}, 1, 0)`,
  ];

  test('group 4: spreadsheet errors and formulas as data are stored, found and returned as written', async function (assert) {
    assert.timeout(600_000);
    let sweep = new Sweep('group 4, values');
    for (let [i, p] of SPREADSHEET_VALUES.entries()) {
      for (let c of valueCases('g4', p, i)) await survives(sweep, c);
    }
    // In a table they come back as the text they are, not as what a
    // spreadsheet would make of them.
    for (let [i, p] of SPREADSHEET_VALUES.entries()) {
      let row = SPECIMENS.find((s) => s.label === p)!;
      await survives(sweep, {
        seed: `g4/table/#${i}`,
        input: { type: T, filter: { eq: { label: p } } },
        wireOnly: true,
        wire: {
          type: T,
          filter: { eq: { label: p } },
          select: ['label', 'tags'],
        },
        expect: { ids: [row.url], table: [[row.label, row.tags]] },
      });
    }
    await conclude(assert, sweep);
  });

  test('group 4: an expression malformed the way spreadsheets get malformed is refused or evaluated, never worse', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 4, expressions', 4),
      'g4',
      MALFORMED_FORMULAS,
      ['expression'],
    );
  });

  // -- group 5: jq ------------------------------------------------------------

  const JQ_PROGRAMS: string[] = [
    '.',
    '.amount',
    '.amount | . * 2',
    '.amount | tostring | length',
    '.[]',
    '.tags[]',
    '.tags | length',
    '[.tags[] | length] | add',
    '..',
    '[..] | length',
    'select(.amount > 3)',
    'select(.amount > 3) | .amount',
    '.amount as $x | $x * 2',
    '$__loc__',
    '$__loc__.line',
    '$__prog_args',
    'input',
    'inputs',
    '[inputs] | length',
    'input_filename',
    'input_line_number',
    'env',
    'env | length',
    'env.QUERY_FUZZ_SECRET | length',
    'env.QUERY_FUZZ_SECRET | tonumber',
    '$ENV',
    '$ENV | length',
    '$ENV.QUERY_FUZZ_SECRET | tonumber',
    '$ENV.PATH | length',
    '@sh "echo \\(.label)"',
    '@sh',
    '@base64d',
    '.label | @base64d',
    '.label | @base64 | length',
    '@json | length',
    '@uri',
    '@html',
    '@text "\\(env)"',
    '"\\(.amount)"',
    '"\\(env.QUERY_FUZZ_SECRET)" | tonumber',
    '"\\(1 + 1)" | tonumber',
    '"\\(',
    'limit(3; .[])',
    'limit(1000000000; repeat(1))',
    '[limit(1000000; repeat(1))] | length',
    'first(repeat(1))',
    'recurse',
    '[recurse] | length',
    'recurse(.; true)',
    '[recurse(. + 1; . < 100000000)] | length',
    'until(false; .)',
    'until(. > 1e12; . + 1)',
    '0 | until(. > 100000000; . + 1)',
    'while(true; .)',
    '[while(true; .)] | length',
    'repeat(.)',
    '[repeat(1)] | length',
    'range(1e12)',
    '[range(1e9)] | length',
    '[range(100000000)] | add',
    'error("stop")',
    'error',
    'error(null)',
    'error({ "code": "invalid-value" })',
    'try error("x") catch .',
    'try error("x") catch 1',
    'halt',
    'halt_error',
    'halt_error(1)',
    '"bye" | halt_error(1)',
    'debug',
    'debug("x")',
    '.amount | debug | . + 1',
    'stderr',
    'getpath(["amount"])',
    'getpath(["constructor", "constructor"])',
    'getpath(["__proto__", "polluted"])',
    'setpath(["__proto__", "polluted"]; "yes")',
    'setpath(["constructor", "prototype", "polluted"]; "yes")',
    'setpath(["amount"]; 1) | .amount',
    'delpaths([["amount"]]) | length',
    'del(.amount) | length',
    'to_entries | length',
    'with_entries(.value = 1) | length',
    '.amount |= . + 1',
    '.amount += 1',
    '.amount = 1',
    '.__proto__ = {"polluted": "yes"}',
    '.__proto__.polluted = "yes"',
    '.constructor.prototype.polluted = "yes"',
    '.["__proto__"]["polluted"] |= "yes"',
    '. + {"__proto__": {"polluted": "yes"}} | length',
    '{"__proto__": {"polluted": "yes"}} * . | length',
    'reduce range(10) as $i (0; . + $i)',
    'reduce range(1e9) as $i (0; . + $i)',
    'reduce .tags[] as $t (0; . + 1)',
    'foreach range(10) as $i (0; . + $i)',
    'foreach range(1e9) as $i (0; . + $i)',
    'def f: f; f',
    'def f: 1 + f; f',
    'def f(x): f(x); f(1)',
    'def f: [f, f]; f',
    'def f: .amount; f',
    'def fac: if . <= 1 then 1 else . * (. - 1 | fac) end; 10 | fac',
    'def fac: if . <= 1 then 1 else . * (. - 1 | fac) end; 100000 | fac',
    'label $out | 1, break $out',
    'label $f | range(1e9) | ., break $f',
    'path(..)',
    '[paths] | length',
    'tostream',
    'fromjson',
    '"{" | fromjson',
    '"[" * 100000 | fromjson',
    '"x" * 1000000000 | length',
    '[.label] | implode',
    'ltrimstr("x") | length',
    'test("(a+)+$")',
    '.label | test("(a+)+$")',
    `"${'a'.repeat(1900)}" | test("(a+)+$")`,
    '.label | capture("(?<x>.*)") | length',
    '[match("(a|aa)+$"; "g")] | length',
    'sub("(?<x>.*)"; "\\(.x)\\(.x)") | length',
    'gsub(""; "x") | length',
    'splits("") ',
    'ascii_downcase | explode | length',
    'now',
    'now | todate | length',
    'mktime',
    'strftime("%Y")',
    'strptime("%Y")',
    'localtime',
    'getpath(["a"]) as [$a] | $a',
    'input_line_number',
    'get_search_list',
    'import "fs" as fs; 1',
    'include "x"; 1',
    'modulemeta',
    'ltrimstr(1)',
    'splits',
    'tojson | fromjson | .amount',
    'infinite',
    'nan',
    '-infinite',
    'infinite | floor',
    'nan | tostring | length',
    '[1,2,3] | IN(2)',
    '.amount | IF(. > 1, 1, 0)',
    'IF(.amount > 1, 1, 0)',
    'SUM(.tags[] | length)',
    '.amount | LN',
    'amount | . * 2',
    'amount as $x | $x',
    '. as [$a, $b] | $a',
    '. as {amount: $a} | $a',
    '?//',
    '.amount?',
    '.[0]?',
    '.. | numbers',
    '[.. | strings] | length',
    '|',
    '| .amount',
    '.amount |',
    '.amount | | .',
    '.[',
    '.]',
    '.[}',
    '{',
    '{"a":}',
    '.a.b.c.d.e.f.g',
    `.${'a.'.repeat(900)}a`,
    `${'['.repeat(900)}1${']'.repeat(900)}`,
    `${'. | '.repeat(600)}.amount`,
    `${'(.amount + '.repeat(300)}1${')'.repeat(300)}`,
    'if . then 1 end',
    'if . then 1 else 2',
    'if',
    'try',
    'reduce',
    'def',
    'def f:',
    '.amount as',
    '$undefined_variable',
    '$__nope__',
    'not_a_function',
    'not_a_function(1)',
    '. as $x | $x | $y',
  ];

  test('group 5: jq where an expression is expected is refused or evaluated safely', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 5, jq as an expression', 4),
      'g5',
      JQ_PROGRAMS,
      ['expression'],
    );
  });

  test('group 5: no expression reads the environment', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('group 5, the environment');
    // Each of these gives the secret's length or its digits as a number if
    // the environment can be read, and a row scored with either gives it away.
    let readers = JQ_PROGRAMS.filter((p) => /env|ENV/.test(p)).concat([
      'LEN(ENV("QUERY_FUZZ_SECRET"))',
      'VALUE(ENV("QUERY_FUZZ_SECRET"))',
      'env.QUERY_FUZZ_SECRET',
      '$ENV.QUERY_FUZZ_SECRET',
    ]);
    let giveaways = [ENV_SECRET.length, Number(ENV_SECRET)];
    for (let [i, expression] of readers.entries()) {
      for (let input of [
        { filter: { type: T }, sort: [{ expression, top: 100 }] },
        { type: T, sort: [{ expression, top: 100 }] },
        { type: T, sort: [{ expression }] },
      ]) {
        let c: Case = { seed: `g5/env/#${i}`, input };
        running = c.seed;
        let checked = attempt(() => assertQuery(input));
        if ('hang' in checked || !checked.ok) continue;
        sweep.cases++;
        sweep.dbRuns++;
        let answer = await bounded((signal) =>
          engine.search(
            new URL(testRealm),
            applyServerSearchPageBound(input as unknown as Query),
            { signal },
            { kind: 'dataOnly' },
          ),
        );
        judge(sweep, c, 'engine', answer);
        if ('hang' in answer || !answer.ok) continue;
        let scores = (answer.value.results as any[]).flatMap((r) =>
          [r._window, r._expression].filter((v) => v != null).map(Number),
        );
        if (scores.some((s) => giveaways.includes(s))) {
          sweep.fail(
            'crash',
            'engine',
            c,
            `the expression read the environment: a row scored ${scores.find((s) => giveaways.includes(s))}`,
          );
        }
      }
    }
    await conclude(assert, sweep);
  });

  test('group 5: a query expression where jq is expected, and jq in the other places a string goes', async function (assert) {
    assert.timeout(600_000);
    // The reverse direction: jq text as a field name, a word, a value.
    await sweepStrings(
      assert,
      new Sweep('group 5, jq elsewhere', 2),
      'g5',
      [
        '.amount | . * 2',
        '.[]',
        '..',
        'select(.amount > 3)',
        'env',
        '$ENV.PATH',
        '@sh',
        '.amount |= 1',
        'def f: f; f',
        '"\\(.label)"',
        'reduce .[] as $x (0; . + $x)',
      ],
      ['main values', 'name', 'word'],
    );
  });

  // -- group 6: reserved words ------------------------------------------------

  const RESERVED_NAMES = [
    ...SAFE_KEYWORD_FIELDS,
    ...INHERITED_KEYWORD_FIELDS,
    '__proto__',
    'id',
    '$this',
    '$let',
    '_blend',
    '_expr',
    '_when',
    '_relevance',
    '_matchRelevance',
    '_title',
    '_cardType',
    'SELECT',
    'Select',
    'ORDER',
    'Null',
    'TRUE',
    'CONSTRUCTOR',
    'tostring',
    'ToString',
    'is_deleted',
    'pristine_doc',
    'ph',
    'ti',
    'lf',
    'lfs',
    'sub',
    'total',
    'count',
    'facet_value',
    '__page_total',
    '_sort_0',
    '__col0',
    'ord',
    'v',
    'value',
    'key',
    'fullkey',
    'text_value',
    'jsonb_value',
  ];

  test('group 6: a field named with a reserved word is queried like any field', async function (assert) {
    assert.timeout(600_000);
    let sweep = new Sweep('group 6, fields the type has');
    let rows = Array.from({ length: KEYWORD_ROWS }, (_, n) => n);
    for (let field of keywordFields) {
      let seed = (what: string) => `g6/has/${field}/${what}`;
      let want = keywordValue(field, 1);
      let holding = rows
        .filter((n) => keywordValue(field, n) === want)
        .map(keywordUrl);
      // by value, then by url, as every sort ends
      let sorted = [...rows]
        .sort(
          (a, b) =>
            keywordValue(field, a).localeCompare(
              keywordValue(field, b),
              'en',
            ) || a - b,
        )
        .map(keywordUrl);
      let cases: Case[] = [
        {
          seed: seed('eq'),
          input: { type: K, filter: { eq: { [field]: want } } },
          expect: { ids: holding },
        },
        {
          seed: seed('eq, older spelling'),
          input: { filter: { on: K, eq: { [field]: want } } },
          wire: searchEntryWireQueryFromQuery({
            filter: { on: K, eq: { [field]: want } },
          } as Query),
          expect: { ids: holding },
        },
        {
          seed: seed('in'),
          input: { type: K, filter: { in: { [field]: [want] } } },
          expect: { ids: holding },
        },
        {
          seed: seed('contains'),
          input: { type: K, filter: { contains: { [field]: want } } },
          expect: { ids: holding },
        },
        {
          seed: seed('not eq'),
          input: { type: K, filter: { not: { eq: { [field]: want } } } },
          expect: { ids: ALL_KEYWORDS.filter((u) => !holding.includes(u)) },
        },
        {
          seed: seed('range'),
          input: {
            type: K,
            filter: { range: { [field]: { gte: want, lte: want } } },
          },
          expect: { ids: holding },
        },
        {
          seed: seed('exists'),
          input: { type: K, filter: { exists: field } },
          expect: { ids: ALL_KEYWORDS },
        },
        {
          seed: seed('missing'),
          input: { type: K, filter: { missing: field } },
          expect: { ids: [] },
        },
        {
          seed: seed('sort'),
          input: { type: K, sort: [{ by: field }] },
          // pins current behavior; rule not yet decided: `lastModified` and
          // `cardURL` name the row's own time and url wherever a sort has no
          // `on`, so a field of that name is sorted by only in the older
          // spelling (the next case). Every row here has one time, so both
          // orders are the url's.
          expect: {
            ids: ['lastModified', 'cardURL'].includes(field)
              ? ALL_KEYWORDS
              : sorted,
            ordered: true,
          },
        },
        {
          seed: seed('sort, older spelling'),
          input: { filter: { type: K }, sort: [{ on: K, by: field }] },
          wire: false,
          expect: { ids: sorted, ordered: true },
        },
        {
          seed: seed('collapse'),
          input: { type: K, collapse: field, sort: [{ by: 'rank' }] },
          expect: { ids: [0, 1, 2].map(keywordUrl) },
        },
        {
          seed: seed('facet'),
          input: { type: K, facets: [{ by: field, stats: true }] },
          expect: { ids: ALL_KEYWORDS },
        },
        {
          seed: seed('matches fields'),
          input: { type: K, filter: { matches: 'keyword', fields: [field] } },
        },
        {
          seed: seed('binding select'),
          input: {
            type: K,
            let: {
              $hot: {
                from: { type: K, filter: { eq: { [field]: want } } },
                select: field,
              },
            },
            filter: { in: { [field]: '$hot' } },
          },
          expect: { ids: holding },
        },
        {
          seed: seed('binding name'),
          input: {
            type: K,
            let: {
              [`$k_${field.replace(/\W/g, '_')}`]: {
                from: { type: K, filter: { range: { rank: { lt: 3 } } } },
                select: 'rank',
              },
            },
            filter: { in: { rank: `$k_${field.replace(/\W/g, '_')}` } },
          },
          expect: { ids: [0, 1, 2].map(keywordUrl) },
        },
        {
          seed: seed('card binding name'),
          input: {
            type: K,
            let: {
              [`$k_${field.replace(/\W/g, '_')}`]: {
                from: { type: K, filter: { eq: { rank: 4 } } },
                one: true,
              },
            },
            filter: {
              eq: { rank: `$k_${field.replace(/\W/g, '_')}.rank` },
            },
          },
          expect: { ids: [keywordUrl(4)] },
        },
        {
          seed: seed('card binding path'),
          input: {
            type: K,
            let: {
              $it: {
                from: { type: K, filter: { eq: { rank: 1 } } },
                one: true,
              },
            },
            filter: { eq: { [field]: `$it.${field}` } },
          },
          expect: { ids: holding },
        },
        {
          seed: seed('as a value'),
          input: { type: K, filter: { eq: { [field]: field } } },
          expect: { ids: [] },
        },
        {
          seed: seed('select'),
          input: null,
          wireOnly: true,
          wire: { type: K, filter: { eq: { rank: 1 } }, select: [field] },
          expect: { ids: [keywordUrl(1)], table: [[keywordValue(field, 1)]] },
        },
        {
          seed: seed('select alias'),
          input: null,
          wireOnly: true,
          wire: {
            type: K,
            filter: { eq: { rank: 1 } },
            select: [{ [field]: 'rank' }],
          },
          expect: { ids: [keywordUrl(1)], table: [[1]] },
        },
        {
          seed: seed('expression with top'),
          input: {
            type: K,
            sort: [{ expression: `COUNT(${field}) + rank`, top: 100 }],
          },
        },
        {
          seed: seed('expression'),
          input: { type: K, sort: [{ expression: `${field} + rank` }] },
        },
      ];
      for (let c of cases) await survives(sweep, c);
    }
    // a facet's counts, by a name with a meaning of its own
    for (let field of keywordFields) {
      running = `g6/facet-counts/${field}`;
      let answer = await bounded((signal) =>
        engine.searchCards(
          new URL(testRealm),
          { filter: { type: K }, facets: [{ by: field }] } as Query,
          { signal },
        ),
      );
      let c: Case = {
        seed: `g6/facet-counts/${field}`,
        input: { filter: { type: K }, facets: [{ by: field }] },
      };
      judge(sweep, c, 'engine', answer);
      if ('hang' in answer || !answer.ok) continue;
      let facets = answer.value.meta.facets;
      let counts = Object.prototype.hasOwnProperty.call(facets ?? {}, field)
        ? (facets as any)[field]
        : undefined;
      let got = JSON.stringify(
        [...(Array.isArray(counts) ? counts : [])]
          .map((f: any) => [f.value, f.count])
          .sort(),
      );
      // pins current behavior; rule not yet decided: as in a sort,
      // `lastModified` names the row's own time (a built-in facet, docs/
      // search.md), so a field of that name is not what it counts. Every
      // row here has one time.
      let want = JSON.stringify(
        field === 'lastModified'
          ? [['1970-01-01', KEYWORD_ROWS]]
          : [0, 1, 2].map((n) => [keywordValue(field, n), 3]).sort(),
      );
      if (got !== want) {
        sweep.fail(
          'rows',
          'engine',
          c,
          `meta.facets["${field}"] should count ${want} but reads ${got}`,
        );
      }
    }
    await conclude(assert, sweep);
  });

  test('group 6: a reserved word the type does not have as a field is refused like any unknown field', async function (assert) {
    assert.timeout(600_000);
    // Against Specimen, which has none of them.
    await sweepStrings(
      assert,
      new Sweep('group 6, names the type lacks', 4),
      'g6',
      RESERVED_NAMES,
      ['name'],
    );
  });

  test('group 6: reserved words as values are data', async function (assert) {
    assert.timeout(300_000);
    await sweepStrings(
      assert,
      new Sweep('group 6, values', 2),
      'g6',
      [
        'null',
        'true',
        'false',
        'select',
        'undefined',
        'NaN',
        'default',
        'constructor',
        '__proto__',
        'toString',
        '$this',
        '$this.id',
        '$let',
        '$hot',
        '_blend',
        'item.label',
        '"Label"',
        // a relative date is a date range's bound; as a value it is text
        'now',
        'now-1d',
        'now/d',
        'now+1w/M',
      ],
      ['value'],
    );
  });

  // -- group 7: SQL injection -------------------------------------------------

  const SQL_PAYLOADS: string[] = [
    ...HOSTILE_VALUES.slice(0, 15),
    `'`,
    `''`,
    `"`,
    `\\`,
    `\\\\`,
    `';--`,
    `' OR 1=1--`,
    `') OR ('1'='1`,
    `'; DELETE FROM boxel_index WHERE '1'='1`,
    `'); UPDATE boxel_index SET search_doc = '{}'::jsonb;--`,
    `'; INSERT INTO boxel_index (url) VALUES ('x');--`,
    `'; TRUNCATE boxel_index;--`,
    `'||pg_sleep(30)||'`,
    `' AND (SELECT 1 FROM pg_sleep(30)) IS NOT NULL--`,
    `1 OR pg_sleep(30) IS NULL`,
    `pg_sleep(30)`,
    `(SELECT pg_sleep(30))`,
    `$$`,
    `$tag$x$tag$`,
    `$2::text`,
    `$99`,
    `E'\\\\x27'`,
    `\\'; SELECT 1;--`,
    `\u02BC OR 1=1--`,
    `\u2019; DROP TABLE boxel_index;--`,
    `%`,
    `_`,
    `%%`,
    `\\%`,
    `\\_`,
    `50%\\`,
    `" || (@ like_regex ".*"))`,
    `x" ? (@ == "y") || "z`,
    `$.label ? (@ == "canary")`,
    `strict $.label`,
    `.*`,
    `^(a+)+$`,
    `[`,
    `*`,
    `?`,
    `a & b`,
    `a | b`,
    `!a`,
    `a <-> b`,
    `a:*`,
    `& | ! <->`,
    `'a' & 'b'`,
    `:*`,
    `&`,
    `!`,
    `(`,
    `)`,
    `()`,
    `{a,b}`,
    `{"a"}`,
    `{`,
    `}`,
    `a,b`,
    `a"b`,
    `a'b`,
    `/* */`,
    `/*`,
    `-- `,
    `;`,
    `NULL`,
    `DEFAULT`,
    `current_user`,
    `0x10`,
    `1e999`,
    `-1`,
    `1.5`,
    `9223372036854775808`,
    `now-1d; DROP TABLE boxel_index`,
    `now-99999999999999999999d`,
    `now+9999999y`,
    `now/q`,
    `now-1d/d'`,
    `[1,0,0]'::vector; SELECT pg_sleep(30)--`,
    `[1,0,0]`,
    `label'::text`,
    `label; SELECT pg_sleep(30)`,
    `label"; SELECT pg_sleep(30); --`,
    `label') OR pg_sleep(30) IS NULL OR ('`,
    `label}'::text[]) OR pg_sleep(30) IS NULL --`,
    `label,x}'::text[]); SELECT pg_sleep(30) --`,
    `amount); SELECT pg_sleep(30); --`,
    `amount) OR pg_sleep(30) IS NULL --`,
    `1); DROP TABLE boxel_index; --`,
    `amount::text`,
    `amount /* x */ + 1`,
    `amount -- x`,
    `"amount"`,
    'amount + `rating`',
    `pg_read_file('/etc/passwd')`,
    `current_setting('server_version')`,
    `(SELECT count(*) FROM boxel_index)`,
    `lo_import('/etc/passwd')`,
    `version()`,
    `http://query-fuzz.invalid/' OR '1'='1`,
  ];

  test('group 7: SQL in a value is data, bound and never run', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 7, values', 6),
      'g7',
      SQL_PAYLOADS,
      ['value'],
    );
  });

  test('group 7: SQL in a field name, a path, a binding name or a type is refused or matches nothing', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 7, names', 6),
      'g7',
      SQL_PAYLOADS,
      ['name'],
    );
  });

  test('group 7: SQL where a keyword, a number, a vector, a date or a realm goes is refused or bound', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 7, words', 6),
      'g7',
      SQL_PAYLOADS,
      ['word'],
    );
  });

  test('group 7: SQL in an expression never reaches the statement', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 7, expressions', 3),
      'g7',
      SQL_PAYLOADS,
      ['expression'],
    );
  });

  test('group 7: SQL in a log query is refused or bound', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 7, log queries'),
      'g7',
      [
        ...SQL_PAYLOADS,
        '\u0000',
        'a\u0000b',
        '1e400',
        '-1',
        '1.5',
        'NaN',
        'Infinity',
      ],
      ['log'],
    );
  });

  test('group 7: numbers that are not page numbers do not reach LIMIT and OFFSET', async function (assert) {
    assert.timeout(300_000);
    let sweep = new Sweep('group 7, paging numbers', 3);
    let numbers: any[] = [
      0,
      1,
      -1,
      1.5,
      1e15,
      1e17,
      1e19,
      1e21,
      1e300,
      2 ** 31,
      2 ** 53,
      2 ** 63,
      2 ** 64,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      -0,
      '0',
      '1',
      '-1',
      ' 7 ',
      '7\n',
      '0x10',
      '0b11',
      '0o17',
      '1e3',
      '1e19',
      '+5',
      '5.0',
      '1_000',
      '',
      ' ',
      'NaN',
      'Infinity',
      '5; SELECT pg_sleep(30)',
      '5 OFFSET 0; SELECT pg_sleep(30)',
      'ALL',
      'NULL',
      '(SELECT 5)',
      '5--',
      true,
      false,
      null,
      [5],
      { valueOf: 5 },
    ];
    let n = 0;
    for (let v of numbers) {
      let label = (where: string) =>
        `${where}: ${typeof v} ${JSON.stringify(v)}`;
      let cases: Case[] = [
        {
          seed: `g7/page/${n++}`,
          label: label('page.size'),
          input: { type: T, page: { size: v } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('page.number'),
          input: { type: T, page: { size: 5, number: v } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('page.number, older spelling'),
          input: { filter: { type: T }, page: { size: 5, number: v } },
          wire: false,
        },
        {
          seed: `g7/page/${n++}`,
          label: label('page.size beside an expression with top'),
          input: {
            type: T,
            sort: [{ expression: 'amount', top: 100 }],
            page: { size: v },
          },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('page.number beside a collapse'),
          input: { type: T, collapse: 'rating', page: { size: 5, number: v } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('a binding page'),
          input: {
            type: T,
            let: {
              $hot: { from: { type: T, page: { size: v } }, select: 'code' },
            },
            filter: { in: { code: '$hot' } },
          },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('facet size'),
          input: {
            type: T,
            facets: [
              { by: 'rating', size: v },
              { by: 'day', interval: 'month', size: v },
            ],
          },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('collapse keep'),
          input: { type: T, collapse: { by: 'rating', keep: v } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('an expression sort entry top'),
          input: { type: T, sort: [{ expression: 'amount', top: v }] },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('compare k'),
          input: {
            type: T,
            sort: [
              { expression: 'amount', compare: { near: 'embedding', k: v } },
            ],
          },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('blend k and weight'),
          input: {
            type: T,
            sort: [{ blend: [{ by: 'amount', weight: v }], k: v }],
          },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('a range bound on a number'),
          input: { type: T, filter: { range: { amount: { gte: v } } } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('an eq on a number'),
          input: { type: T, filter: { eq: { amount: v } } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('an in on a number'),
          input: { type: T, filter: { in: { amount: [v] } } },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('a facet range on a number'),
          input: { type: T, facets: [{ by: 'amount', ranges: [{ from: v }] }] },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('minSimilarity'),
          input: {
            type: T,
            filter: {
              near: { embedding: { to: [1, 0, 0], minSimilarity: v } },
            },
          },
        },
        {
          seed: `g7/page/${n++}`,
          label: label('a vector component'),
          input: { type: T, sort: [{ by: 'embedding', near: [v, 0, 0] }] },
        },
      ];
      for (let c of cases) await survives(sweep, c);
    }
    await conclude(assert, sweep);
  });

  // -- group 8: JavaScript injection -----------------------------------------

  const JS_PAYLOADS: string[] = [
    '${7*7}',
    '`${globalThis.__queryFuzzCanary = "pwned"}`',
    '#{7*7}',
    '{{7*7}}',
    '<%= 7*7 %>',
    `</script><script>globalThis.__queryFuzzCanary="pwned"</script>`,
    `javascript:globalThis.__queryFuzzCanary="pwned"`,
    `process.exit()`,
    `process.exit(1)`,
    `process.kill(process.pid)`,
    `process.env.QUERY_FUZZ_SECRET`,
    `require('child_process').execSync('touch ${SENTINEL_FILE}')`,
    `require("fs").writeFileSync("${SENTINEL_FILE}", "x")`,
    `import("node:fs").then((fs) => fs.writeFileSync("${SENTINEL_FILE}", "x"))`,
    `globalThis.__queryFuzzCanary = "pwned"`,
    `globalThis`,
    `this`,
    `this.constructor.constructor("return process")()`,
    `Function('return this')()`,
    `Function("globalThis.__queryFuzzCanary = 'pwned'")()`,
    `constructor.constructor('return process')()`,
    `[].constructor.constructor("return process")().exit()`,
    `"".constructor.constructor("globalThis.__queryFuzzCanary = 'pwned'")()`,
    `(() => { globalThis.__queryFuzzCanary = "pwned" })()`,
    `eval("globalThis.__queryFuzzCanary = 'pwned'")`,
    `new Function("return process")()`,
    `while (true) {}`,
    `for (;;) {}`,
    `(function f() { f() })()`,
    `setTimeout(() => { globalThis.__queryFuzzCanary = "pwned" }, 0)`,
    `setInterval(() => {}, 1)`,
    `queueMicrotask(() => { throw new Error("late") })`,
    `Promise.reject(new Error("late"))`,
    `fetch("http://127.0.0.1:9/")`,
    `new Array(1e9).fill(0)`,
    `"x".repeat(2 ** 29)`,
    `Buffer.alloc(2 ** 30)`,
    `require('node:worker_threads').parentPort.postMessage({ id: 1, scores: { values: [], timedOut: false } })`,
    `require('node:worker_threads').parentPort.close()`,
    `Object.prototype.polluted = "yes"`,
    `({}).__proto__.polluted = "yes"`,
    `Object.assign(Object.prototype, { polluted: "yes" })`,
    `__proto__`,
    `constructor`,
    `prototype`,
    `constructor.prototype`,
    `__proto__.polluted`,
    `constructor.prototype.polluted`,
    `toString`,
    `valueOf`,
    `hasOwnProperty`,
    `then`,
    `__defineGetter__`,
    `__lookupGetter__`,
    `isPrototypeOf`,
    `$&`,
    `$1$2`,
    `$<name>`,
    '$`',
    `$'`,
    `\\u0000`,
    `\\x00`,
    `%s %d %j %o`,
    `[object Object]`,
    `undefined`,
    `null`,
    `NaN`,
    `Infinity`,
    `-0`,
    `0n`,
    `true`,
    `[]`,
    `{}`,
    `[1,0,0]`,
    `{"dims":3,"encoding":"int8","data":"AAAA"}`,
    `{"$let":"hot"}`,
    `{"toString":null}`,
    `data:text/html,<script>alert(1)</script>`,
    `<img src=x onerror=alert(1)>`,
    `'-alert(1)-'`,
    `\\'-alert(1)//`,
  ];

  test('group 8: a "__proto__", "constructor" or "prototype" key at any level pollutes nothing', async function (assert) {
    assert.timeout(600_000);
    let sweep = new Sweep('group 8, prototype pollution', 4);
    let planted = { polluted: 'yes' };
    let n = 0;
    // As JSON text, the way a request body carries it: JSON.parse makes
    // "__proto__" an own key.
    let keyed = (key: string, value: unknown = planted) =>
      JSON.parse(`{${JSON.stringify(key)}: ${JSON.stringify(value)}}`);
    let variants: [string, (base: any) => any][] = [];
    for (let key of [
      '__proto__',
      'constructor',
      'prototype',
      'toString',
      'hasOwnProperty',
      'then',
      'length',
    ]) {
      for (let value of [
        planted,
        { prototype: planted },
        'x',
        1,
        null,
        [planted],
      ]) {
        variants.push([
          `"${key}": ${JSON.stringify(value)}`,
          // spliced into the JSON text, so the key is the object's own
          (target: any) =>
            JSON.parse(
              JSON.stringify(target).replace(
                /\}$/,
                `,${JSON.stringify(key)}:${JSON.stringify(value)}}`,
              ),
            ),
        ]);
      }
    }
    // each place in a query that is an object
    let holders: [string, (o: (base: any) => any) => any][] = [
      ['the query', (o) => o({ type: T })],
      ['the type', (o) => ({ type: o(T) })],
      [
        'a filter',
        (o) => ({ type: T, filter: o({ eq: { label: 'canary' } }) }),
      ],
      ['an eq', (o) => ({ type: T, filter: { eq: o({ label: 'canary' }) } })],
      [
        'an eq, older spelling',
        (o) => ({ filter: { on: T, eq: o({ label: 'canary' }) } }),
      ],
      ['an in', (o) => ({ type: T, filter: { in: o({ label: ['canary'] }) } })],
      [
        'a range',
        (o) => ({ type: T, filter: { range: o({ amount: { gt: 1 } }) } }),
      ],
      [
        'range bounds',
        (o) => ({ type: T, filter: { range: { amount: o({ gt: 1 }) } } }),
      ],
      [
        'a contains',
        (o) => ({ type: T, filter: { contains: o({ label: 'can' }) } }),
      ],
      [
        'a near',
        (o) => ({
          type: T,
          filter: { near: { embedding: o({ to: [1, 0, 0] }) } },
        }),
      ],
      [
        'a linkedFrom',
        (o) => ({
          type: T,
          filter: { linkedFrom: o({ card: SPECIMENS[0].url, field: 'tags' }) },
        }),
      ],
      ['a sort entry', (o) => ({ type: T, sort: [o({ by: 'amount' })] })],
      [
        'a blend',
        (o) => ({ type: T, sort: [o({ blend: [{ by: 'amount' }] })] }),
      ],
      [
        'a blend signal',
        (o) => ({ type: T, sort: [{ blend: [o({ by: 'amount' })] }] }),
      ],
      [
        'relevance weights',
        (o) => ({
          type: T,
          filter: { matches: 'canary' },
          sort: [{ relevance: o({ text: 1 }) }],
        }),
      ],
      ['a page', (o) => ({ type: T, page: o({ size: 5 }) })],
      ['a facet', (o) => ({ type: T, facets: [o({ by: 'rating' })] })],
      [
        'a facet range',
        (o) => ({
          type: T,
          facets: [{ by: 'amount', ranges: [o({ from: 1 })] }],
        }),
      ],
      [
        'a facet measure',
        (o) => ({
          type: T,
          facets: [{ by: 'rating', measure: o({ avg: 'amount' }) }],
        }),
      ],
      ['a collapse', (o) => ({ type: T, collapse: o({ by: 'rating' }) })],
      [
        'let',
        (o) => ({
          type: T,
          let: o({ $hot: { from: { type: T }, select: 'code' } }),
          filter: { in: { code: '$hot' } },
        }),
      ],
      [
        'a binding',
        (o) => ({
          type: T,
          let: { $hot: o({ from: { type: T }, select: 'code' }) },
          filter: { in: { code: '$hot' } },
        }),
      ],
      [
        'a binding reference',
        (o) => ({
          type: T,
          let: { $hot: { from: { type: T }, select: 'code' } },
          filter: { in: { code: o('$hot') } },
        }),
      ],
      [
        'an expression sort entry with top',
        (o) => ({ type: T, sort: [o({ expression: 'amount', top: 10 })] }),
      ],
      [
        'a comparison',
        (o) => ({
          type: T,
          sort: [
            {
              expression: 'amount - stats.amount.max',
              compare: o({ by: 'rating' }),
            },
          ],
        }),
      ],
    ];
    for (let [where, hold] of holders) {
      for (let [what, add] of variants) {
        await survives(sweep, {
          seed: `g8/pollution/${n++}`,
          label: `${what} in ${where}`,
          input: hold(add),
        });
        if (({} as any).polluted !== undefined) {
          sweep.fail(
            'state',
            'state',
            {
              seed: `g8/pollution/${n}`,
              input: null,
              label: `${what} in ${where}`,
            },
            'Object.prototype was polluted',
          );
          delete (Object.prototype as any).polluted;
        }
      }
    }
    // names that resolve through a prototype where a binding, a facet or a
    // column is looked up by name
    let names = [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      'valueOf',
    ];
    for (let name of names) {
      let cases: Case[] = [
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            let: { $hot: { from: { type: T }, select: 'code' } },
            // a name no binding declares, even one every object inherits,
            // is text
            filter: { in: { code: [`$${name}`] } },
          },
          expect: { ids: [] },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            let: { $hot: { from: { type: T }, select: 'code' } },
            filter: { eq: { label: `$${name}.rating` } },
          },
          expect: { ids: [] },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: { type: T, filter: { eq: { [name]: 'x' } } },
        },
        { seed: `g8/lookup/${n++}`, input: { type: T, sort: [{ by: name }] } },
        {
          seed: `g8/lookup/${n++}`,
          input: { type: T, facets: [{ by: name }] },
        },
        { seed: `g8/lookup/${n++}`, input: { type: T, collapse: name } },
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            filter: { matches: 'canary' },
            sort: [{ relevance: keyed(name, 1) }],
          },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: { type: T, sort: [{ expression: `${name} + 1`, top: 10 }] },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            sort: [{ expression: `${name}.${name} + 1`, top: 10 }],
          },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            sort: [
              {
                expression: `stats.${name}.max + peers.${name}`,
                compare: { by: 'rating' },
              },
            ],
          },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: { type: T, sort: [{ expression: `${name}(1)` }] },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: null,
          wireOnly: true,
          wire: { type: T, select: [name, keyed(name, 'label')] },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: null,
          wireOnly: true,
          wire: { type: T, fields: keyed(name, ['item']) },
        },
        // A binding may be named with letters, digits and underscores, so
        // these are names like any other: the query answers, or says the
        // name is not allowed.
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            let: keyed(`$${name}`, {
              from: { type: T, filter: { range: { amount: { lt: 3 } } } },
              select: 'code',
            }),
            filter: { in: { code: `$${name}` } },
          },
          expect: { ids: idsWhere((s) => s.amount < 3), orRefused: true },
        },
        {
          seed: `g8/lookup/${n++}`,
          input: {
            type: T,
            let: keyed(`$${name}`, {
              from: { type: T, filter: { eq: { label: 'canary' } } },
              one: true,
            }),
            filter: { eq: { amount: `$${name}.amount` } },
          },
          expect: {
            ids: idsWhere((s) => s.label === 'canary'),
            orRefused: true,
          },
        },
      ];
      for (let c of cases) await survives(sweep, c);
    }
    assert.strictEqual(
      sweep.of('state').length,
      0,
      `no key polluted a prototype: ${sweep.report('state')}`,
    );
    await conclude(assert, sweep);
  });

  test('group 8: a log query names its paths and operators, never a property every object inherits', async function (assert) {
    assert.timeout(300_000);
    await sweepStrings(
      assert,
      new Sweep('group 8, inherited names in a log query'),
      'g8',
      [
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'valueOf',
        'hasOwnProperty',
        'then',
        'length',
      ],
      ['log'],
    );
  });

  test('group 8: code in a value, a name or a word is a string', async function (assert) {
    assert.timeout(900_000);
    await sweepStrings(
      assert,
      new Sweep('group 8, code as a string', 12),
      'g8',
      JS_PAYLOADS,
      ['main values', 'name', 'word'],
    );
  });

  test('group 8: code in an expression does not run, and an ordinary expression is scored afterward', async function (assert) {
    assert.timeout(900_000);
    let sweep = new Sweep('group 8, code as an expression', 3);
    let attacks = [
      ...JS_PAYLOADS,
      // spreadsheet and jq spellings of the same reach
      'REPT("x", 1000000000)',
      'LEN(REPT(REPT("x", 30000), 30000))',
      'SUM(SEQUENCE(100000000))',
      'SEQUENCE(100000, 100000)',
      'FACT(100000)',
      'COMBIN(1e9, 5e8)',
      '[range(1e9)] | length',
      '[limit(100000000; repeat("x"))] | length',
      '"x" * 1000000000 | length',
      'def f: f; f',
      'def f: [f, f]; f',
      'until(false; .)',
      'reduce range(1e12) as $i (0; . + $i)',
      'input',
      'env',
      'halt',
      'halt_error(1)',
    ];
    for (let [i, p] of attacks.entries()) {
      for (let c of expressionCases('g8', p, i)) {
        await survives(sweep, c);
      }
    }
    // An ordinary expression is still scored, in SQL, after the attacks.
    running = 'g8/scored afterward';
    let after = await bounded((signal) =>
      engine.search(
        new URL(testRealm),
        {
          filter: { type: T },
          sort: [{ expression: 'COUNT(code) * 0 + 1', top: 100 }],
        } as unknown as Query,
        { signal },
        { kind: 'dataOnly' },
      ),
    );
    let meta = !('hang' in after) && after.ok ? after.value.meta.window : after;
    let window = Math.min(SPECIMENS.length, 100);
    assert.deepEqual(
      meta,
      {
        rows: window,
        scored: window,
        ...(SPECIMENS.length > window ? { truncated: true } : {}),
      },
      'an ordinary expression with top is scored after the attacks',
    );
    await conclude(assert, sweep);
  });

  // -- group 9: regex and pattern abuse --------------------------------------

  const REGEX_ABUSE: string[] = [
    '(a+)+$',
    '^(a+)+$',
    '(a*)*$',
    '(a|aa)+$',
    '(a|a?)+$',
    '((a+)+)+$',
    '(.*a){20}$',
    '^(a?){40}a{40}$',
    '(a+)+b',
    '(x+x+)+y',
    '([a-z]+)*$',
    '(a|b|ab)*c',
    '.*.*.*.*.*.*.*.*.*.*x',
    'a{1,100000}',
    'a{99999999}',
    'a{2,1}',
    '(a{1000}){1000}',
    '((a{255}){255}){255}',
    '(a)\\1',
    '(.*)\\1$',
    '\\1',
    '\\9',
    '(?=a)a',
    '(?!a)a',
    '(?<=a)b',
    '(?<!a)b',
    '(?<name>a)',
    '\\p{L}+',
    '\\P{L}',
    '[[:alpha:]]+',
    '[[:nope:]]',
    '[[.a.]]',
    '[[=a=]]',
    '\\y',
    '\\m',
    '\\A',
    '\\Z',
    '\\q',
    '\\',
    'a\\',
    '\\x',
    '\\u00',
    '\\U0000FFFFF',
    '\\c',
    '\\0',
    '(',
    ')',
    '(()',
    '[',
    ']',
    '[]',
    '[^]',
    '[z-a]',
    '{',
    '}',
    '{1}',
    'a{',
    'a{1',
    'a{1,',
    '*',
    '+',
    '?',
    '**',
    'a**',
    'a+*?',
    '|',
    '||',
    'a||b',
    '^*',
    '$^',
    '^$',
    '.',
    '(?i)A',
    '(?n).',
    '(?z)',
    '(?x) a b',
    '(?#comment)a',
    '***=(a+)+$',
    '***:(a+)+$',
    '***',
    '(?b)a',
    '(?e)a+',
    '(?q)(a+)+$',
    '\u0000',
    'a\u0000',
    '\n',
    'a\nb',
    ' ',
    '\uD800',
    '\u{1D11E}+',
    '[\u{1D11E}-\u{1D120}]',
    'a'.repeat(100_000),
    '(a|b)'.repeat(20_000),
    '('.repeat(50_000),
    `${'('.repeat(5_000)}a${')'.repeat(5_000)}`,
    `${'a?'.repeat(2_000)}${'a'.repeat(2_000)}`,
    `${'(a+)+'.repeat(200)}$`,
    'a{1,1000}'.repeat(100),
    `[${'a-z'.repeat(30_000)}]`,
    '.{100000}',
    '(.{1,1000}){1,1000}',
  ];
  const GLOB_ABUSE: string[] = [
    '*',
    '**',
    '?',
    '*?*',
    '*'.repeat(1_000),
    '?'.repeat(4_001),
    '?'.repeat(100_000),
    '*a'.repeat(30) + '*b',
    '*a'.repeat(200) + '*!x',
    'a*'.repeat(2_000) + 'b',
    '%',
    '_',
    '\\',
    '\\*',
    '\\?',
    '[a-z]*',
    '{a,b}*',
    'a%b',
    'a_b',
    'a\\b',
    'a*b',
    'a?b',
    'A*B',
    '\u0000*',
    'x'.repeat(100_000),
    '*'.repeat(100_000),
  ];

  test('group 9: a regular expression is refused with a code or answered within the bound', async function (assert) {
    assert.timeout(900_000);
    let sweep = new Sweep('group 9, regular expressions', 3);
    let n = 0;
    for (let p of REGEX_ABUSE) {
      let label =
        p.length > 200
          ? `a regex of ${p.length} characters starting ${JSON.stringify(p.slice(0, 40))}`
          : undefined;
      let cases: Case[] = [
        {
          seed: `g9/regex/${n++}`,
          label,
          input: { type: T, filter: { regex: { code: p } } },
          db: true,
        },
        {
          seed: `g9/regex/${n++}`,
          label: label && `${label}, on a text field`,
          input: { type: T, filter: { regex: { label: p } } },
        },
        {
          seed: `g9/regex/${n++}`,
          label: label && `${label}, on a list`,
          input: { type: T, filter: { regex: { tags: p } } },
        },
        {
          seed: `g9/regex/${n++}`,
          label: label && `${label}, negated`,
          input: { type: T, filter: { not: { regex: { code: p } } } },
        },
        {
          seed: `g9/regex/${n++}`,
          label: label && `${label}, older spelling`,
          input: { filter: { on: T, regex: { code: p } } },
          wire: false,
        },
      ];
      // "Still held to the time budget": a slow pattern may run until the
      // budget stops it, which here is the hang bound.
      for (let c of cases) {
        await survives(sweep, { ...c, budgetIsEnough: true });
      }
    }
    await conclude(assert, sweep);
  });

  test('group 9: a glob is refused with a code or answered within the bound, and finds what it should', async function (assert) {
    assert.timeout(900_000);
    let sweep = new Sweep('group 9, globs');
    let n = 0;
    for (let p of GLOB_ABUSE) {
      let label =
        p.length > 200
          ? `a glob of ${p.length} characters starting ${JSON.stringify(p.slice(0, 40))}`
          : undefined;
      // the plain evaluation, where it is cheap enough to run here
      let checkable =
        isAscii(p) &&
        !p.includes('\u0000') &&
        p.length <= 4_001 &&
        (p.match(/\*/g) ?? []).length <= 40;
      let cases: Case[] = [
        {
          seed: `g9/glob/${n++}`,
          label,
          db: true,
          input: { type: T, filter: { pattern: { code: p } } },
          expect: checkable
            ? { ids: idsWhere((s) => globMatches(p, s.code)) }
            : {},
        },
        {
          seed: `g9/glob/${n++}`,
          label: label && `${label}, negated`,
          input: { type: T, filter: { not: { pattern: { code: p } } } },
          expect: checkable
            ? { ids: idsWhere((s) => !globMatches(p, s.code)) }
            : {},
        },
        {
          seed: `g9/glob/${n++}`,
          label: label && `${label}, as contains`,
          input: { type: T, filter: { contains: { code: p } } },
          expect: checkable
            ? { ids: idsWhere((s) => asciiFold(s.code).includes(asciiFold(p))) }
            : {},
        },
        {
          seed: `g9/glob/${n++}`,
          label: label && `${label}, as a facet prefix`,
          input: { type: T, facets: [{ by: 'code', prefix: p }] },
          db: true,
        },
        {
          seed: `g9/glob/${n++}`,
          label: label && `${label}, as typeahead`,
          input: {
            type: T,
            filter: { prefix: true, scope: 'title', matches: p },
          },
          db: true,
        },
        {
          seed: `g9/glob/${n++}`,
          label: label && `${label}, as a prefix match`,
          input: { type: T, filter: { matches: p, prefix: true } },
          db: true,
        },
      ];
      for (let c of cases) {
        await survives(sweep, { ...c, budgetIsEnough: true });
      }
    }
    await conclude(assert, sweep);
  });

  // -- group 10: resource exhaustion within limits ---------------------------

  test('group 10: the largest legal query in each dimension is answered correctly, and one step past is refused with limit-exceeded', async function (assert) {
    assert.timeout(900_000);
    let sweep = new Sweep('group 10, limits');
    let canary = idsWhere((s) => s.label === 'canary');
    let leaf = { eq: { label: 'canary' } };
    // `amount + 1 + 1 + … + 111`, exactly `length` characters long
    // an expression of exactly `length` characters within the score
    // profile's 200 parts: `amount + 0.000…01`
    let sumOfLength = (length: number) =>
      `amount + 0.${'0'.repeat(length - 12)}1`;
    let nested = (wrap: string, depth: number) => ({
      $nest: [wrap, depth, leaf],
    });
    let n = 0;
    let add = (
      label: string,
      input: any,
      expect: Case['expect'] = {},
      more: Partial<Case> = {},
    ) =>
      survives(sweep, {
        seed: `g10/${n++}`,
        label,
        input,
        // a query that only grows may be answered or refused as too large
        expect:
          growing && expect.ids
            ? { ...expect, orRefused: 'limit-exceeded' }
            : expect,
        ...more,
      });
    let growing = true;

    // nesting: an even number of `not`s is the filter itself
    for (let depth of [2, 10, 50, 100, 200, 500, 1000, 2000, 5000]) {
      await add(
        `not nested ${depth} deep`,
        { type: T, filter: nested('not', depth) },
        { ids: canary },
      );
      await add(
        `every nested ${depth} deep`,
        { type: T, filter: nested('every', depth) },
        { ids: canary },
      );
      await add(
        `any nested ${depth} deep`,
        { type: T, filter: nested('any', depth) },
        { ids: canary },
      );
    }
    // list lengths
    for (let size of [10, 100, 1000, 10_000, 70_000]) {
      await add(
        `in with ${size} values`,
        { type: T, filter: { in: { label: { $seq: [size, 'no-such-'] } } } },
        { ids: [] },
      );
      await add(
        `in with ${size} values and the one that matches`,
        {
          type: T,
          filter: {
            any: [{ in: { label: { $seq: [size, 'no-such-'] } } }, leaf],
          },
        },
        { ids: canary },
      );
      await add(
        `in on a list with ${size} values`,
        { type: T, filter: { in: { tags: { $seq: [size, 'no-such-'] } } } },
        { ids: [] },
      );
      await add(
        `in on a number with ${size} values`,
        {
          type: T,
          filter: {
            in: { amount: Array.from({ length: size }, (_, i) => 1000 + i) },
          },
        },
        { ids: [] },
        { label: `in on a number with ${size} values` },
      );
    }
    for (let size of [10, 100, 1000, 5000]) {
      await add(
        `every with ${size} members`,
        {
          type: T,
          filter: { every: Array.from({ length: size }, () => leaf) },
        },
        { ids: canary },
      );
      await add(
        `any with ${size} members`,
        {
          type: T,
          filter: {
            any: Array.from({ length: size }, (_, i) => ({
              eq: { label: i === 0 ? 'canary' : `no-such-${i}` },
            })),
          },
        },
        { ids: canary },
      );
      await add(`an eq with ${size} fields`, {
        type: T,
        filter: {
          eq: Object.fromEntries(
            Array.from({ length: size }, (_, i) => [`no_such_${i}`, 1]),
          ),
        },
      });
      await add(
        `${size} sort entries`,
        {
          type: T,
          sort: Array.from({ length: size }, () => ({ by: 'amount' })),
        },
        {},
      );
    }
    // long values
    for (let size of [1_000, 100_000, 1_000_000]) {
      await add(
        `an eq value of ${size} characters`,
        { type: T, filter: { eq: { label: { $text: ['v', size] } } } },
        { ids: [] },
      );
      await add(
        `a contains value of ${size} characters`,
        { type: T, filter: { contains: { label: { $text: ['v', size] } } } },
        { ids: [] },
      );
      await add(`a matches text of ${size} characters`, {
        type: T,
        filter: { matches: { $text: ['word ', size / 5] } },
      });
      await add(`a typeahead text of ${size} characters`, {
        type: T,
        filter: {
          prefix: true,
          scope: 'title',
          matches: { $text: ['wo ', size / 3] },
        },
      });
      await add(
        `a field name of ${size} characters`,
        {
          type: T,
          filter: { eq: { [`f${'x'.repeat(Math.min(size, 100_000))}`]: 1 } },
        },
        {},
        { label: `a field name of ${Math.min(size, 100_000)} characters` },
      );
      await add(`an expression of ${size} characters`, {
        type: T,
        sort: [{ expression: { $text: ['a', size] } }],
      });
      await add(`an expression with top of ${size} characters`, {
        type: T,
        sort: [{ expression: { $text: ['a', size] }, top: 100 }],
      });
      await add(
        `a type module of ${size} characters`,
        { type: { module: { $text: ['m', size] }, name: 'X' } },
        // decided: a module that is neither a URL nor an @scope/… identifier
        // names no module, and is refused (it crashed the engine before)
        { refused: 'invalid-type' },
      );
    }
    // each documented limit, at it and one past it
    growing = false;
    let facet = (i: number) => ({
      by: [
        'rating',
        'tags',
        'amount',
        'day',
        'note',
        'code',
        'label',
        'secret',
        'embedding',
      ][i],
      size: 1000,
    });
    await add(
      '8 facets of 1000 values',
      { type: T, facets: Array.from({ length: 8 }, (_, i) => facet(i)) },
      { ids: ALL_SPECIMENS },
    );
    await add(
      '9 facets',
      { type: T, facets: Array.from({ length: 9 }, (_, i) => facet(i)) },
      { refused: 'limit-exceeded' },
    );
    await add(
      'a facet of 1001 values',
      { type: T, facets: [{ by: 'rating', size: 1001 }] },
      { refused: 'invalid-value' },
    );
    await add(
      '50 facet ranges',
      {
        type: T,
        facets: [
          {
            by: 'amount',
            ranges: Array.from({ length: 50 }, (_, i) => ({
              from: i,
              to: i + 1,
            })),
          },
        ],
      },
      { ids: ALL_SPECIMENS },
    );
    await add(
      '51 facet ranges',
      {
        type: T,
        facets: [
          {
            by: 'amount',
            ranges: Array.from({ length: 51 }, (_, i) => ({
              from: i,
              to: i + 1,
            })),
          },
        ],
      },
      { refused: 'limit-exceeded' },
    );
    let signal = (i: number) =>
      [
        { by: 'amount' },
        { by: 'rating', weight: 0.5 },
        { expression: 'amount * 2' },
        { boost: { eq: { tags: 'red' } }, weight: 2 },
        { by: 'lastModified' },
        { by: 'day', weight: -1 },
        { by: 'code' },
        { boost: { exists: 'rating' }, weight: 1 },
        { by: 'note' },
      ][i];
    await add(
      'a blend of 8 signals',
      {
        type: T,
        sort: [{ blend: Array.from({ length: 8 }, (_, i) => signal(i)) }],
      },
      { ids: ALL_SPECIMENS },
    );
    await add(
      'a blend of 9 signals',
      {
        type: T,
        sort: [{ blend: Array.from({ length: 9 }, (_, i) => signal(i)) }],
      },
      { refused: 'limit-exceeded' },
    );
    let binding = (i: number) => [
      `$b${i}`,
      {
        from: {
          type: T,
          filter: { range: { amount: { gte: i } } },
          page: { size: 1000 },
        },
        select: 'code',
      },
    ];
    let holds = (count: number) => ({
      every: Array.from({ length: count }, (_, i) => ({
        in: { code: `$b${i}` },
      })),
    });
    await add(
      '4 bindings of 1000 rows',
      {
        type: T,
        let: Object.fromEntries(
          Array.from({ length: 4 }, (_, i) => binding(i)),
        ),
        filter: holds(4),
      },
      { ids: idsWhere((s) => s.amount >= 3) },
    );
    await add(
      '5 bindings',
      {
        type: T,
        let: Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => binding(i)),
        ),
        filter: holds(5),
      },
      { refused: 'limit-exceeded' },
    );
    await add(
      'a binding page of 10001',
      {
        type: T,
        let: {
          $b0: { from: { type: T, page: { size: 10001 } }, select: 'code' },
        },
        filter: holds(1),
      },
      { refused: 'invalid-value' },
    );
    await add(
      'a page of 2000',
      { type: T, page: { size: 2000 } },
      { ids: ALL_SPECIMENS },
    );
    // clamped above 2,000, not refused
    await add(
      'a page of 2001',
      { type: T, page: { size: 2001 } },
      { ids: ALL_SPECIMENS },
    );
    await add(
      'a page of a billion',
      { type: T, page: { size: 1_000_000_000 } },
      { ids: ALL_SPECIMENS },
    );
    await add(
      'page number a billion',
      { type: T, page: { size: 2000, number: 1_000_000_000 } },
      { ids: [] },
    );
    await add(
      'page number 2^53',
      { type: T, page: { size: 2000, number: 2 ** 53 } },
      // decided: page.number is at most 1,000,000,000; past it the offset
      // overflowed the database before, so it is refused
      { refused: 'invalid-page' },
    );
    await add('collapse keep 10', {
      type: T,
      collapse: { by: 'rating', keep: 10 },
    });
    await add(
      'collapse keep 11',
      { type: T, collapse: { by: 'rating', keep: 11 } },
      { refused: 'invalid-value' },
    );
    await add(
      'an expression sort entry with top 500',
      {
        type: T,
        sort: [{ expression: 'COUNT(label) + amount', top: 500 }],
      },
      { ids: ALL_SPECIMENS },
    );
    await add(
      'an expression sort entry with top 501',
      {
        type: T,
        sort: [{ expression: 'COUNT(label) + amount', top: 501 }],
      },
      { refused: 'invalid-value' },
    );
    for (let top of [undefined, 100]) {
      let where = top ? ' with top' : '';
      await add(
        `an expression${where} of 2000 characters`,
        {
          type: T,
          sort: [{ expression: sumOfLength(2000), ...(top ? { top } : {}) }],
        },
        { ids: ALL_SPECIMENS },
      );
      await add(
        `an expression${where} of 2001 characters`,
        {
          type: T,
          sort: [{ expression: sumOfLength(2001), ...(top ? { top } : {}) }],
        },
        { refused: 'invalid-value' },
      );
    }
    await add(
      'matches over 8 fields',
      {
        type: T,
        filter: {
          matches: 'keeper',
          fields: [
            'label',
            'note',
            'code',
            'tags',
            'secret',
            'label',
            'note',
            'code',
          ],
        },
      },
      { ids: idsWhere((s) => /keeper/.test(s.note)) },
    );
    await add(
      'matches over 9 fields',
      {
        type: T,
        filter: {
          matches: 'keeper',
          fields: [
            'label',
            'note',
            'code',
            'tags',
            'secret',
            'label',
            'note',
            'code',
            'tags',
          ],
        },
      },
      { refused: 'limit-exceeded' },
    );
    await add(
      'a vector of 2000 components',
      {
        type: T,
        filter: {
          near: { embedding: { to: Array.from({ length: 2000 }, () => 0.5) } },
        },
      },
      { ids: [] },
    );
    await add(
      'a vector of 2001 components',
      {
        type: T,
        filter: {
          near: { embedding: { to: Array.from({ length: 2001 }, () => 0.5) } },
        },
      },
      { refused: 'limit-exceeded' },
    );
    await add(
      '64 columns',
      { type: T },
      { ids: ALL_SPECIMENS },
      {
        wireOnly: true,
        wire: {
          type: T,
          select: Array.from({ length: 64 }, (_, i) => ({
            [`c${i}`]: 'label',
          })),
        },
      },
    );
    await add(
      '65 columns',
      { type: T },
      {},
      {
        wireOnly: true,
        wire: {
          type: T,
          select: Array.from({ length: 65 }, (_, i) => ({
            [`c${i}`]: 'label',
          })),
        },
        db: false,
      },
    );
    // every dimension at its limit at once
    await add(
      'every limit at once',
      {
        type: T,
        let: Object.fromEntries(
          Array.from({ length: 4 }, (_, i) => binding(i)),
        ),
        filter: {
          every: [
            holds(4),
            {
              $nest: [
                'not',
                100,
                {
                  any: Array.from({ length: 100 }, () => ({ exists: 'label' })),
                },
              ],
            },
            { in: { amount: Array.from({ length: 1000 }, (_, i) => i) } },
          ],
        },
        sort: [
          { expression: 'COUNT(label) + amount', top: 500 },
          { blend: Array.from({ length: 8 }, (_, i) => signal(i)), k: 60 },
          { by: 'amount' },
        ],
        facets: Array.from({ length: 8 }, (_, i) => facet(i)),
        collapse: { by: 'code', keep: 10 },
        explain: true,
        page: { size: 2000, total: 'exact' },
      },
      { ids: idsWhere((s) => s.amount >= 3) },
    );
    let refusedColumns = attempt(() =>
      parseSearchEntryQueryFromPayload({
        type: T,
        select: Array.from({ length: 65 }, (_, i) => ({ [`c${i}`]: 'label' })),
      }),
    );
    assert.strictEqual(
      !('hang' in refusedColumns) && !refusedColumns.ok
        ? refusedColumns.thrown.code
        : 'accepted',
      'limit-exceeded',
      '65 columns are refused with limit-exceeded',
    );
    await conclude(assert, sweep);
  });
});
