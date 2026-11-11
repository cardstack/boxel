import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  isPrimitive,
  readVectors,
  report,
  truthOf,
  VECTOR_FILES,
  withTypeRefs,
  type Disagreement,
  type VectorField,
  type Vectors,
} from '@cardstack/query-verification/conformance';

import { setupDB } from './helpers/index.ts';

// Holds the Postgres engine to the Lean model of the filter language
// (packages/query-verification). The model's cards are seeded straight into
// boxel_index, and every case the model generated is searched in both
// spellings: the older one as written, the newer one through `lowerQuery`.
// The model's answer for a card is one of three truth values; the engine's is
// read from whether the card is returned by the filter and by its `not`.

const realm = 'http://query-verification-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const refOf = (name: string) => ref(`${realm}${name.toLowerCase()}`, name);

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
        let number = field.of === 'number';
        return [
          `f${i}`,
          {
            type: field.type,
            isPrimitive: isPrimitive(field),
            isComputed: false,
            fieldOrCard: isPrimitive(field)
              ? number
                ? numberRef
                : stringRef
              : refOf(field.of),
            ...(number ? { serializerName: 'number' } : {}),
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
      definitionOf(t, 'card', vectors.fields),
    ),
    ...Object.entries(vectors.defs).map(([t, d]) =>
      definitionOf(t, d.kind, d.fields),
    ),
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
  };
  return lookup;
}

async function seed(dbAdapter: PgAdapter, vn: VirtualNetwork, v: Vectors) {
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
      param(JSON.stringify({ id: url, type: 'card' })),
      `::jsonb,`,
      param(JSON.stringify(card.doc)),
      `::jsonb,`,
      `'[]'::jsonb,`,
      param(JSON.stringify(types)),
      `::jsonb,`,
      param(false),
      `,`,
      param(false),
      `,`,
      param(Date.now()),
      `,`,
      param(1000),
      `)`,
    ]);
  }
}

module(basename(import.meta.filename), function () {
  for (let file of VECTOR_FILES) {
    module(
      `query verification conformance: ${file} (Postgres)`,
      function (hooks) {
        let vectors = readVectors(file);
        let engine: IndexQueryEngine;

        setupDB(hooks, {
          before: async (dbAdapter) => {
            let vn = new VirtualNetwork();
            engine = new IndexQueryEngine(
              dbAdapter,
              makeDefinitionLookup(vectors),
              vn,
            );
            await seed(dbAdapter, vn, vectors);
          },
        });

        const page = { size: vectors.cards.length + 1 };
        async function urls(filter: Record<string, any>): Promise<Set<string>> {
          let { cards } = await engine.searchCards(new URL(realm), {
            filter,
            page,
          } as Query);
          return new Set(cards.map((c) => String(c.id)));
        }

        test('the engine answers every case as the model does, in both spellings', async function (assert) {
          let disagreements: Disagreement[] = [];
          let failures: string[] = [];
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
              failures.push(
                `${caseName} [${form}]: ${(e as Error).message} (${JSON.stringify(filter)})`,
              );
              return;
            }
            vectors.cards.forEach((card, i) => {
              let url = `${realm}${card.id}`;
              let actual = truthOf(yes.has(url), no.has(url));
              if (actual !== expect[i]) {
                disagreements.push({
                  case: caseName,
                  form,
                  card,
                  expected: expect[i] as any,
                  actual,
                });
              }
            });
          };

          let answered: string[] = [];
          let refuses = async (
            caseName: string,
            filter: Record<string, any>,
          ) => {
            for (let f of [filter, { not: filter }]) {
              try {
                await urls(f);
                answered.push(`${caseName}: ${JSON.stringify(f)}`);
              } catch (e) {
                if ((e as Error).name !== 'InvalidQueryError') throw e;
              }
            }
          };

          for (let c of vectors.cases) {
            let lowered = lowerQuery(withTypeRefs(c.newer, refOf)).query
              .filter!;
            let older = c.older ? withTypeRefs(c.older, refOf) : undefined;
            if (!c.expect) {
              await refuses(c.name, lowered);
              if (older) await refuses(c.name, older);
              continue;
            }
            await compare(
              c.name,
              'newer, lowered by lowerQuery',
              lowered,
              c.expect,
            );
            if (older) await compare(c.name, 'older', older, c.expect);
          }
          assert.deepEqual(failures, [], 'the engine fails on a valid query');
          assert.strictEqual(
            disagreements.length,
            0,
            `the engine disagrees with the model:\n${report(disagreements)}`,
          );
          assert.deepEqual(
            answered,
            [],
            'the engine answers what it must refuse',
          );
        });
      },
    );
  }
});
