// Runs the vectors through the index query engine (`IndexQueryEngine`) over
// any database adapter: the model's cards are seeded straight into
// `boxel_index`, with a definition lookup standing in for the realm's
// modules, and every case is searched in both spellings and under `not`.
// The Postgres test (realm-server) and the SQLite check share it.
import {
  IndexQueryEngine,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type CodeRef,
  type DBAdapter,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';

import {
  isPrimitive,
  report,
  SERIALIZED,
  truthOf,
  withTypeRefs,
  type Disagreement,
  type VectorField,
  type Vectors,
} from './conformance.ts';
import { knownFor, type Evaluator } from './known.ts';

export const realm = 'http://query-verification-test/';
const stringRef = ref('@cardstack/base/string', 'default');
export const refOf = (name: string) =>
  ref(`${realm}${name.toLowerCase()}`, name);

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

function definitionOf(
  name: string,
  kind: 'card' | 'field',
  fields: Record<string, VectorField>,
): Definition {
  let names = Object.keys(fields);
  return {
    type: kind === 'card' ? 'card-def' : 'field-def',
    codeRef: refOf(name),
    displayName: name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => {
        let field = fields[n];
        let serialized = (SERIALIZED as readonly string[]).includes(field.of);
        return [
          `f${i}`,
          {
            type: field.type,
            isPrimitive: isPrimitive(field),
            isComputed: false,
            fieldOrCard: isPrimitive(field)
              ? serialized
                ? ref(`@cardstack/base/${field.of}`, 'default')
                : stringRef
              : refOf(field.of),
            ...(serialized ? { serializerName: field.of } : {}),
            ...(field.type.startsWith('links') ? { searchable: true } : {}),
          },
        ];
      }),
    ),
  } as Definition;
}

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(vectors: Vectors): DefinitionLookup {
  let definitions = [
    ...Object.keys(vectors.types).map((t) =>
      definitionOf(t, 'card', vectors.defs[t]?.fields ?? vectors.fields),
    ),
    ...Object.entries(vectors.defs)
      .filter(([t]) => !(t in vectors.types))
      .map(([t, d]) => definitionOf(t, d.kind, d.fields)),
  ];
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = definitions.find((d) => refsEqual(d.codeRef, codeRef));
      if (!found) {
        throw new Error(
          `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
        );
      }
      return found;
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these checks');
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
  };
  return lookup;
}

async function seed(dbAdapter: DBAdapter, vn: VirtualNetwork, v: Vectors) {
  let json = (value: unknown) =>
    dbAdapter.kind === 'pg'
      ? [param(JSON.stringify(value)), '::jsonb']
      : [param(JSON.stringify(value))];
  let ancestry = (name: string): string[] => [
    name,
    ...v.types[name].flatMap(ancestry),
  ];
  for (let card of v.cards) {
    let url = `${realm}${card.id}`;
    let types = ancestry(card.type).map((t) =>
      internalKeyFor(refOf(t), undefined, vn),
    );
    await query(dbAdapter, [
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
      param(url),
      `,`,
      param(url),
      `,`,
      param(realm),
      `,`,
      param(1),
      `,`,
      param('instance'),
      `,`,
      ...json({ id: url, type: 'card' }),
      `,`,
      ...json(card.doc),
      `,`,
      ...json([]),
      `,`,
      ...json(types),
      `,`,
      param(false),
      `,`,
      param(false),
      `,`,
      param(Date.now()),
      `,`,
      param(1000),
      `)`,
    ] as any);
  }
}

export async function seededEngine(
  dbAdapter: DBAdapter,
  vectors: Vectors,
): Promise<IndexQueryEngine> {
  let vn = new VirtualNetwork();
  let engine = new IndexQueryEngine(
    dbAdapter,
    makeDefinitionLookup(vectors),
    vn,
  );
  await seed(dbAdapter, vn, vectors);
  return engine;
}

export interface EngineResult {
  failures: string[];
  disagreements: Disagreement[];
  answered: string[];
  known: string[];
  stale: boolean;
  checked: number;
}

export async function runVectors(
  engine: IndexQueryEngine,
  evaluator: Evaluator,
  file: string,
  vectors: Vectors,
): Promise<EngineResult> {
  let known = knownFor(evaluator, file);
  let page = { size: vectors.cards.length + 1 };
  let queryNow = vectors.now ? new Date(vectors.now) : undefined;
  let timeZone: string | undefined;
  let urls = async (filter: Record<string, any>) => {
    let { cards } = await engine.searchCards(
      new URL(realm),
      { filter, page } as Query,
      {
        ...(queryNow ? { queryNow } : {}),
        ...(timeZone ? { timeZone } : {}),
      },
    );
    return new Set(cards.map((c) => String(c.id)));
  };
  let result: EngineResult = {
    failures: [],
    disagreements: [],
    answered: [],
    known: [],
    stale: false,
    checked: 0,
  };
  let compare = async (
    caseName: string,
    form: string,
    filter: Record<string, any>,
    expect: string,
  ) => {
    let yes: Set<string>, no: Set<string>;
    try {
      yes = await urls(filter);
      no = await urls({ not: filter });
    } catch (e) {
      if (!known.fails(caseName)) {
        result.failures.push(
          `${caseName} [${form}]: ${(e as Error).message} (${JSON.stringify(filter)})`,
        );
      }
      return;
    }
    result.checked += vectors.cards.length;
    vectors.cards.forEach((card, i) => {
      let url = `${realm}${card.id}`;
      let actual = truthOf(yes.has(url), no.has(url));
      if (actual !== expect[i]) {
        let d: Disagreement = {
          case: caseName,
          form,
          card,
          expected: expect[i] as any,
          actual,
        };
        if (!known.answers(d)) result.disagreements.push(d);
      }
    });
  };
  let refuses = async (caseName: string, filter: Record<string, any>) => {
    for (let f of [filter, { not: filter }]) {
      try {
        await urls(f);
        result.answered.push(`${caseName}: ${JSON.stringify(f)}`);
      } catch (e) {
        if ((e as Error).name !== 'InvalidQueryError') throw e;
      }
    }
  };

  for (let c of vectors.cases) {
    timeZone = c.timeZone;
    let lowered = lowerQuery(withTypeRefs(c.newer, refOf)).query.filter!;
    let older = c.older ? withTypeRefs(c.older, refOf) : undefined;
    if (!c.expect) {
      await refuses(c.name, lowered);
      if (older) await refuses(c.name, older);
      continue;
    }
    await compare(c.name, 'newer, lowered by lowerQuery', lowered, c.expect);
    if (older) await compare(c.name, 'older', older, c.expect);
  }
  let { lines, stale } = known.summary();
  result.known = lines;
  result.stale = stale;
  return result;
}

export function describe(file: string, r: EngineResult): string {
  return [
    `== ${file}: ${r.checked} answers checked`,
    ...r.known,
    ...(r.failures.length ? ['fails on a valid query:', ...r.failures] : []),
    ...(r.disagreements.length
      ? ['disagrees with the model:', report(r.disagreements, 4)]
      : []),
    ...(r.answered.length
      ? ['answers what it must refuse:', ...r.answered]
      : []),
  ].join('\n');
}
