import type {
  IndexQueryEngine,
  LegacyIndexQueryEngine,
  Query,
} from '@cardstack/runtime-common';
import {
  withTypeRefs,
  type VectorField,
  type Vectors,
} from '@cardstack/query-verification/conformance';
import { realm, refOf } from '@cardstack/query-verification/engine-fixture';

export interface Tally {
  compared: number;
  identical: number;
  intentional: Record<string, number>;
  skipped: Record<string, number>;
  // main failing (not refusing) on a query the new engine answers
  mainErrors: Record<string, number>;
  // a relative date: main's engine reads the wall clock, the vectors fix the
  // query's instant, so the two can't be compared
  relativeDates: number;
  failures: string[];
}

// Every case of one vector file with an older spelling, as written and under
// `not`, through both engines, counted into `total`.
export async function compareEngines(
  file: string,
  vectors: Vectors,
  legacy: LegacyIndexQueryEngine,
  next: IndexQueryEngine,
  total: Tally,
) {
  let page = { size: vectors.cards.length + 1 };
  let opts = vectors.now ? { queryNow: new Date(vectors.now) } : {};
  let ids = async (
    engine: IndexQueryEngine | LegacyIndexQueryEngine,
    filter: Record<string, unknown>,
  ): Promise<string[]> => {
    let { cards } = await engine.searchCards(
      new URL(realm),
      { filter, page } as unknown as Query,
      opts as any,
    );
    return cards.map((c) => String(c.id).slice(realm.length));
  };
  let skip = (reason: string) =>
    (total.skipped[reason] = (total.skipped[reason] ?? 0) + 1);

  for (let c of vectors.cases) {
    if (!c.older) {
      skip('no older spelling');
      continue;
    }
    if (c.timeZone) {
      skip('a time zone other than UTC (main reckons in UTC)');
      continue;
    }
    let older = withTypeRefs(c.older, refOf) as Record<string, unknown>;
    // The vectors fix the query's instant; main's engine has none and reads
    // the wall clock, so a relative date can't be compared.
    if (/"now[-+/"]/.test(JSON.stringify(older))) {
      total.relativeDates++;
      continue;
    }
    for (let [form, filter] of [
      ['as written', older],
      ['under not', { not: older }],
    ] as const) {
      let before: string[];
      try {
        before = await ids(legacy, filter);
      } catch (e) {
        // A refusal is main reading the query as invalid; anything else
        // is main failing on a query it should answer.
        if ((e as Error).name === 'InvalidQueryError') {
          skip(
            `main refuses it (${(e as { code?: string }).code ?? 'no code'})`,
          );
        } else {
          let reason = (e as Error).message.replace(/\s+/g, ' ').slice(0, 60);
          total.mainErrors[reason] = (total.mainErrors[reason] ?? 0) + 1;
        }
        continue;
      }
      let after: string[];
      try {
        after = await ids(next, filter);
      } catch (e) {
        if (!c.expect) {
          skip('refused by the new engine as the model requires');
          continue;
        }
        total.failures.push(
          `${file} ${c.name} [${form}]: the new engine refuses what main answers: ${(e as Error).message}`,
        );
        continue;
      }
      total.compared++;
      if (JSON.stringify(before) === JSON.stringify(after)) {
        total.identical++;
        continue;
      }
      let answer: Answer = {
        vectors,
        filter,
        negated: form === 'under not',
        before,
        after,
        expect: c.expect,
      };
      let shape = intentionalChange(answer);
      if (shape.kind === 'intentional') {
        total.intentional[shape.shape] =
          (total.intentional[shape.shape] ?? 0) + 1;
      } else {
        total.failures.push(
          `${file} ${c.name} [${form}]: main ${JSON.stringify(before)}, new ${JSON.stringify(after)}${shape.why ? ` (${shape.why})` : ''}`,
        );
      }
    }
  }
}

// A request main's entry grammar and Query V2's read differently, by design:
// a member only the newer grammar has. Main refuses it as an unknown member;
// Query V2 reads it, or refuses it for what it says, with the grammar's code.
// The federated route reads Query V2's grammar from row 24a, so these are its
// request-level changes, beside the engine's answers above.
export const GRAMMAR_CASES: {
  name: string;
  payload: Record<string, unknown>;
  // why the two differ (docs/search.md); the case fails if they agree
  shape: string;
}[] = [
  {
    name: 'let that is not a map of bindings',
    payload: { filter: { 'item.on': refOf('Thing') }, let: 'nope' },
    shape: 'a member only the newer grammar has',
  },
  {
    name: 'let binding a log',
    payload: {
      filter: { 'item.on': refOf('Thing'), in: { 'item.id': '$liked' } },
      let: { $liked: { from: { log: 'likes.jsonl' }, select: 'what.post' } },
    },
    shape: 'a member only the newer grammar has',
  },
  {
    name: 'facets',
    payload: {
      filter: { 'item.on': refOf('Thing') },
      page: { size: 0 },
      facets: [{ by: 'tags' }],
    },
    shape: 'a member only the newer grammar has',
  },
];

type GrammarOutcome = { refused: string } | { read: true };

function grammarOutcome(
  parse: (payload: unknown) => unknown,
  payload: unknown,
) {
  try {
    parse(payload);
    return { read: true } as GrammarOutcome;
  } catch (e) {
    return { refused: (e as Error).message } as GrammarOutcome;
  }
}

// Each grammar case through both parsers, counted into `total`: a case whose
// grammars agree, or whose main does not refuse the member as unknown, is a
// failure (its listed change is not the one that happened).
export function compareGrammars(
  legacyParse: (payload: unknown) => unknown,
  nextParse: (payload: unknown) => unknown,
  total: Tally,
) {
  for (let c of GRAMMAR_CASES) {
    let before = grammarOutcome(legacyParse, c.payload);
    let after = grammarOutcome(nextParse, c.payload);
    total.compared++;
    let mainRefusesUnknown =
      'refused' in before && /unknown member "/.test(before.refused);
    if (
      JSON.stringify(before) !== JSON.stringify(after) &&
      mainRefusesUnknown
    ) {
      total.intentional[c.shape] = (total.intentional[c.shape] ?? 0) + 1;
    } else {
      total.failures.push(
        `grammar ${c.name}: main ${JSON.stringify(before)}, new ${JSON.stringify(after)}`,
      );
    }
  }
}

// The line each switch row's description carries.
export function countLine(total: Tally): string {
  let sum = (r: Record<string, number>) =>
    Object.values(r).reduce((a, b) => a + b, 0);
  let list = (r: Record<string, number>, sep: string) =>
    Object.entries(r)
      .map(([k, v]) => `${k}${sep}${v}`)
      .join('; ') || 'none';
  return (
    `differential: ${total.compared} compared, ${total.identical} identical, ` +
    `${sum(total.intentional)} intentional (${list(total.intentional, ' ')}), ` +
    `${sum(total.skipped)} skipped (${list(total.skipped, ': ')}), ` +
    `${total.relativeDates} relative dates not compared (main reads the wall clock), ` +
    `${sum(total.mainErrors)} main errors (${list(total.mainErrors, ': ')}), ` +
    `${total.failures.length} failures`
  );
}

// What the differential compares for one case and form: the two engines'
// ids, in order, and the model's truth values (`expect`, one per card).
export interface Answer {
  vectors: Vectors;
  filter: Record<string, unknown>;
  negated: boolean;
  before: string[];
  after: string[];
  expect?: string;
}

export type Verdict =
  | { kind: 'intentional'; shape: string }
  | { kind: 'difference'; why?: string };

// The shapes whose answers changed on purpose (docs/search.md, "answers that
// changed"), as found in a filter, each with the paths it was found at.
export function shapesOf(
  vectors: Vectors,
  filter: unknown,
): Map<string, Set<string>> {
  let found = new Map<string, Set<string>>();
  let add = (shape: string, path: string) =>
    (found.get(shape) ?? found.set(shape, new Set()).get(shape)!).add(path);
  let walk = (node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    let n = node as Record<string, any>;
    if (Array.isArray(n.every)) {
      n.every.forEach(walk);
      let paths = n.every
        .filter((m: any) => m && (m.eq || m.contains || m.in))
        .flatMap((m: any) => Object.keys(m.eq ?? m.contains ?? m.in))
        .filter((p: string) => isListPath(vectors, p));
      for (let p of paths) {
        if (
          paths.filter(
            (q: string) => listRoot(vectors, q) === listRoot(vectors, p),
          ).length > 1
        ) {
          add('same-path every', p);
        }
      }
    }
    if (Array.isArray(n.any)) n.any.forEach(walk);
    if (n.not) {
      for (let p of listPathsTested(vectors, n.not)) add('not over a list', p);
      walk(n.not);
    }
    for (let op of ['eq', 'in', 'range', 'contains'] as const) {
      if (!n[op] || typeof n[op] !== 'object') continue;
      for (let [path, value] of Object.entries(n[op] as object)) {
        let list = isListPath(vectors, path);
        let values = op === 'in' && Array.isArray(value) ? value : [value];
        if (op !== 'range' && values.includes(null) && list) {
          add(
            path.includes('.') ? 'null through a list' : 'null on a list',
            path,
          );
        }
        if (op === 'range' && list) add('range over a list', path);
        let leaf = leafOf(vectors, path);
        if (
          op !== 'contains' &&
          leaf &&
          (leaf.of === 'date' ||
            leaf.of === 'datetime' ||
            (leaf.of === 'number' &&
              values.some((x) => typeof x === 'string')) ||
            (op === 'range' &&
              Object.values(value as object).some(
                (x) => typeof x === 'string' && leaf!.of === 'number',
              )))
        ) {
          add('a value compared as its text', path);
        }
        if (op === 'contains' && /[%_]/.test(String(value))) {
          add('contains a wildcard character', path);
        }
        if (list) add('an escaped character in a list', path);
      }
    }
  };
  walk(filter);
  return found;
}

function listPathsTested(vectors: Vectors, node: unknown): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  let n = node as Record<string, any>;
  let out: string[] = [];
  for (let op of ['eq', 'in', 'range', 'contains']) {
    if (n[op])
      out.push(...Object.keys(n[op]).filter((p) => isListPath(vectors, p)));
  }
  for (let k of ['every', 'any']) {
    if (Array.isArray(n[k]))
      out.push(...n[k].flatMap((m: unknown) => listPathsTested(vectors, m)));
  }
  if (n.not) out.push(...listPathsTested(vectors, n.not));
  return out;
}

// Whether a dotted path crosses a list (containsMany or linksToMany).
export function isListPath(vectors: Vectors, path: string): boolean {
  return listRoot(vectors, path) !== undefined;
}

// The path up to and including the first list it crosses.
function listRoot(vectors: Vectors, path: string): string | undefined {
  let fields: Record<string, VectorField> | undefined = vectors.fields;
  let walked: string[] = [];
  for (let segment of path.split('.')) {
    let field: VectorField | undefined = fields?.[segment.replace(/\[\]$/, '')];
    if (!field) return undefined;
    walked.push(segment);
    if (field.type === 'containsMany' || field.type === 'linksToMany') {
      return walked.join('.');
    }
    fields = vectors.defs[field.of]?.fields;
  }
  return undefined;
}

// The field a dotted path ends on.
function leafOf(vectors: Vectors, path: string): VectorField | undefined {
  let fields: Record<string, VectorField> | undefined = vectors.fields;
  let field: VectorField | undefined;
  for (let segment of path.split('.')) {
    field = fields?.[segment.replace(/\[\]$/, '')];
    if (!field) return undefined;
    fields = vectors.defs[field.of]?.fields;
  }
  return field;
}

// Every value a card's doc holds at a path, lists read through.
function valuesAt(doc: unknown, path: string): unknown[] {
  let at: unknown[] = [doc];
  for (let segment of path.split('.')) {
    at = at
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .map((v) =>
        v && typeof v === 'object'
          ? (v as Record<string, unknown>)[segment]
          : undefined,
      );
  }
  return at.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

// The cards a shape's change can reach, by what each card holds at the
// shape's path: where main's old reading and the new one could tell the
// card apart. A difference is intentional only when every card the two
// engines disagree on is one of these.
const AFFECTED: Record<
  string,
  (vectors: Vectors, doc: Record<string, unknown>, path: string) => boolean
> = {
  // main's `not` returned the cards the inner filter matched too
  'not over a list': (v, doc, path) => {
    let root = listRoot(v, path)!;
    return valuesAt(doc, root).some((x) => x !== undefined);
  },
  // an empty list now holds no value, and a null element is a missing one:
  // main matched neither
  'null on a list': (_v, doc, path) => {
    let list = doc[path];
    return !Array.isArray(list) || list.length === 0 || list.includes(null);
  },
  // `name: null` through a list: one element's null against no element's value
  'null through a list': (v, doc, path) => {
    let root = listRoot(v, path)!;
    let elements = valuesAt(doc, root).filter((x) => x !== undefined);
    let leaf = path.slice(root.length + 1);
    return (
      elements.length === 0 ||
      elements.some(
        (e) =>
          !e ||
          typeof e !== 'object' ||
          valuesAt(e, leaf).some((x) => x == null),
      )
    );
  },
  // a list's elements compared as text (a null element as the text "null")
  'range over a list': (_v, doc, path) =>
    valuesAt(doc, path).some((x) => x !== undefined),
  // two tests on one list needed one element to pass both
  'same-path every': (v, doc, path) =>
    valuesAt(doc, listRoot(v, path)!).filter((x) => x !== undefined).length > 1,
  // a date, a date-time, or a number given as text, compared as the stored
  // text rather than as the date, instant or number it is
  'a value compared as its text': (_v, doc, path) =>
    valuesAt(doc, path).some((x) => x !== undefined),
  // `%` and `_` read as wildcards
  'contains a wildcard character': (_v, doc, path) =>
    valuesAt(doc, path).some((x) => typeof x === 'string'),
  // a list's strings read with their JSON escapes
  'an escaped character in a list': (_v, doc, path) =>
    valuesAt(doc, path).some((x) => typeof x === 'string' && /["\\\n]/.test(x)),
};

// A difference is intentional only when the filter has a changed shape, the
// direction the docs give holds, and every card the engines disagree on is
// one that shape's change reaches.
export function intentionalChange(answer: Answer): Verdict {
  let shapes = shapesOf(answer.vectors, answer.filter);
  if (shapes.size === 0) return { kind: 'difference', why: 'no changed shape' };
  let before = new Set(answer.before);
  let after = new Set(answer.after);
  let disagree = [
    ...answer.before.filter((id) => !after.has(id)),
    ...answer.after.filter((id) => !before.has(id)),
  ];
  let docs = new Map(answer.vectors.cards.map((c) => [c.id, c.doc]));
  let reached = (id: string) =>
    [...shapes].some(([shape, paths]) =>
      [...paths].some((path) =>
        AFFECTED[shape](answer.vectors, docs.get(id) ?? {}, path),
      ),
    );
  let unexplained = disagree.filter((id) => !reached(id));
  // the docs' direction for `not` over a list: main returned more
  let onlyNotOverList = shapes.size === 1 && shapes.has('not over a list');
  if (
    onlyNotOverList &&
    !answer.negated &&
    answer.after.some((id) => !before.has(id))
  ) {
    return {
      kind: 'difference',
      why: 'not over a list: the new engine returns a card main did not',
    };
  }
  if (unexplained.length) {
    return {
      kind: 'difference',
      why: `shapes ${[...shapes.keys()].join(', ')}, but ${unexplained.length} cards none reaches (${unexplained.slice(0, 3).join(', ')})`,
    };
  }
  let used = [...shapes]
    .filter(([shape, paths]) =>
      disagree.some((id) =>
        [...paths].some((path) =>
          AFFECTED[shape](answer.vectors, docs.get(id) ?? {}, path),
        ),
      ),
    )
    .map(([shape]) => shape)
    .sort();
  return { kind: 'intentional', shape: used.join(' + ') };
}
