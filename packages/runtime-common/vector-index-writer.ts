import {
  addExplicitParens,
  every,
  param,
  separatedByCommas,
  type Expression,
  type PgPrimitive,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { collectSearchDocVectors } from './vector-index.ts';
import {
  parseVectorSidecar,
  sidecarHash,
  type SidecarLineError,
} from './vector-sidecar.ts';
import { vectorStoreFor, type VectorRow } from './vector-store.ts';

// Loading a card's vectors into the vector store when its index pass
// commits.
//
// Practice: embeddings stored beside their source with the model that made
// them and a hash of what they were made from, and re-embedded only when the
// source or the model changes (LlamaIndex's document store and ingestion
// cache, LangChain's indexing API with its record manager); chunks keyed by
// stable ids, as RAG chunk stores key passages, so reordering moves nothing.
// Boxel's mapping: a card's vectors live in a `.vectors.jsonl` sidecar
// (vector-sidecar.ts), one line per vector with its `field`, list `item` id,
// `space` and `sourceHash`; the indexer loads them into the store under the
// card's row, by (field path, item id), and records the sidecar's hash so an
// unchanged sidecar is not read in again. A card without a sidecar takes the
// inline values its search doc carries.
// Where Boxel diverges: the sidecar, not the store, is the record of truth,
// because a realm moves as files (copy, publish, git): the store is an index
// rebuilt from files, never the only copy of a vector.

// The vector fields a search doc declares (`_vectorFields`, written when the
// card is rendered): each one's space, and whether it sits inside a list.
function vectorFieldsOfDoc(
  searchDoc: unknown,
): Record<string, { space: string; list: boolean; computed: boolean }> {
  let fields = (searchDoc as { _vectorFields?: unknown } | null)?._vectorFields;
  return fields && typeof fields === 'object'
    ? (fields as Record<
        string,
        { space: string; list: boolean; computed: boolean }
      >)
    : {};
}

export type VectorSidecarReader = (
  cardURL: string,
) => Promise<{ content: string; lastModified: number } | undefined>;

// What the index writer lends the vector load: its querier (inside the swap
// transaction), the URLs the pass staged, and how to read them.
export interface VectorIndexWriterHost {
  dbAdapter: DBAdapter;
  realmURL: string;
  // the pass's staging id, whose rows in `boxel_index_pending` are the
  // cards being indexed
  stagingId: string;
  query(expression: Expression): Promise<Record<string, PgPrimitive>[]>;
  stagedSearchDocs(
    chunk: string[],
    filter: string,
  ): Promise<{ url: string; type: string; search_doc: unknown }[]>;
  // the condition selecting the staged rows of `chunk`
  stagedInChunk(chunk: string[]): Expression;
  readVectorSidecar: VectorSidecarReader | undefined;
}

// The modified time of the sidecar each card's vectors were loaded from,
// by card URL. Empty where there is no vector table.
export async function vectorSidecarMtimes(
  dbAdapter: DBAdapter,
  query: (expression: Expression) => Promise<Record<string, PgPrimitive>[]>,
  realmURL: string,
): Promise<Map<string, number>> {
  let found = new Map<string, number>();
  if (!(await vectorStoreFor(dbAdapter).available())) {
    return found;
  }
  try {
    let rows = (await query([
      'SELECT url, sidecar_mtime FROM boxel_index_vector_sidecars WHERE realm_url =',
      param(realmURL),
    ] as Expression)) as {
      url: string;
      sidecar_mtime: number | string | null;
    }[];
    for (let row of rows) {
      if (row.sidecar_mtime != null) {
        found.set(row.url, Number(row.sidecar_mtime));
      }
    }
  } catch {
    // the sidecar table arrives with a later migration
  }
  return found;
}

// The spaces the staged cards of `chunk` declare their vector fields in.
async function stagedVectorSpaces(
  host: VectorIndexWriterHost,
  chunk: string[],
): Promise<string[]> {
  let rows = await host.query([
    `SELECT DISTINCT f.value ->> 'space' AS space
       FROM boxel_index_pending AS p
       CROSS JOIN LATERAL jsonb_each(
         CASE WHEN jsonb_typeof(p.search_doc -> '_vectorFields') = 'object'
              THEN p.search_doc -> '_vectorFields' ELSE '{}'::jsonb END
       ) AS f
      WHERE`,
    ...every([
      ['p.realm_url =', param(host.realmURL)],
      ['p.staging_id =', param(host.stagingId)],
      [
        'p.url IN',
        ...addExplicitParens(
          separatedByCommas(chunk.map((url) => [param(url)])),
        ),
      ],
    ]),
  ] as Expression);
  return rows
    .map((row) => row.space)
    .filter((space): space is string => typeof space === 'string');
}

// Re-derives the stored vectors for every URL a pass staged. A card
// with a sidecar (`<card>.vectors.jsonl`) takes its vectors from the
// sidecar alone; a card without one takes the inline values its search doc
// carries (see `collectSearchDocVectors`). Every row records the space of
// its vector, from the field's declared space (`_vectorFields` in the
// search doc). A sidecar line whose field, space or item doesn't fit the
// card is left out and recorded as an error on that vector. A card whose
// sidecar hash is the one its rows were loaded from keeps its rows
// untouched. A tombstoned URL keeps none. Runs inside the swap
// transaction, so a `near` sort never sees a card's new row with its old
// vectors. A no-op where the database has no vector table (SQLite, or a
// Postgres without pgvector).
export async function syncVectorIndex(
  host: VectorIndexWriterHost,
  urls: string[],
) {
  let store = vectorStoreFor(host.dbAdapter);
  if (!(await store.available())) {
    return;
  }
  let realm = host.realmURL;
  const CHUNK = 500;
  // Every space the pass's cards declare a vector field in has its home in
  // the store before any vector is written (see `ensureSpaces`).
  let spaces = new Set<string>();
  for (let start = 0; start < urls.length; start += CHUNK) {
    for (let space of await stagedVectorSpaces(
      host,
      urls.slice(start, start + CHUNK),
    )) {
      spaces.add(space);
    }
  }
  await store.ensureSpaces([...spaces]);
  for (let start = 0; start < urls.length; start += CHUNK) {
    let chunk = urls.slice(start, start + CHUNK);
    let rows = await host.stagedSearchDocs(
      chunk,
      `(search_doc::text LIKE '%"vec:[%' OR jsonb_exists(search_doc, '_vectorFields'))`,
    );
    let loaded = new Map<string, string>();
    if (host.readVectorSidecar) {
      let known = (await host.query([
        'SELECT url, type, sidecar_hash FROM boxel_index_vector_sidecars WHERE',
        ...every([
          ['realm_url =', param(realm)],
          [
            'url IN',
            ...addExplicitParens(
              separatedByCommas(chunk.map((url) => [param(url)])),
            ),
          ],
        ]),
      ] as Expression)) as {
        url: string;
        type: string;
        sidecar_hash: string;
      }[];
      for (let row of known) {
        loaded.set(`${row.url}\u0000${row.type}`, row.sidecar_hash);
      }
    }

    // Which cards keep their rows, and which sidecars to load.
    let keep = new Set<string>();
    let sidecars = new Map<
      string,
      { content: string; lastModified: number; hash: string }
    >();
    let plain: typeof rows = [];
    for (let row of rows) {
      let sidecar =
        host.readVectorSidecar && row.type === 'instance'
          ? await host.readVectorSidecar(row.url)
          : undefined;
      if (!sidecar) {
        plain.push(row);
        continue;
      }
      let hash = await sidecarHash(sidecar.content);
      if (loaded.get(`${row.url}\u0000${row.type}`) === hash) {
        keep.add(row.url);
      } else {
        sidecars.set(row.url, { ...sidecar, hash });
      }
    }

    let clear = chunk.filter((url) => !keep.has(url));
    if (clear.length > 0) {
      await host.query(
        store.deleteVectors(
          every([
            ['realm_url =', param(realm)],
            host.stagedInChunk(clear),
          ]) as Expression,
        ),
      );
      // A sidecar's record goes with the vectors loaded from it, whether or
      // not this pass can read sidecars: a batch with no reader (an error
      // batch) that kept the record would leave the next pass reading the
      // unchanged hash as "already loaded", and the vectors gone for good.
      await host.query([
        'DELETE FROM boxel_index_vector_sidecars WHERE',
        ...every([['realm_url =', param(realm)], host.stagedInChunk(clear)]),
      ] as Expression);
    }

    let values: VectorRow[] = [];
    let push = (
      row: { url: string; type: string },
      v: Omit<VectorRow, 'realmURL' | 'url' | 'type'>,
    ) => values.push({ realmURL: realm, url: row.url, type: row.type, ...v });

    for (let row of plain) {
      let fields = vectorFieldsOfDoc(row.search_doc);
      for (let vector of collectSearchDocVectors(row.search_doc)) {
        let info = fields[vector.fieldPath];
        push(row, {
          fieldPath: vector.fieldPath,
          itemId: info?.list || vector.ordinal > 0 ? `#${vector.ordinal}` : '',
          ordinal: vector.ordinal,
          space: info?.space ?? `vector ${vector.components.length}`,
          sourceHash: undefined,
          components: vector.components,
        });
      }
    }

    let records: Expression[] = [];
    for (let row of rows) {
      let sidecar = sidecars.get(row.url);
      if (!sidecar) {
        continue;
      }
      let fields = vectorFieldsOfDoc(row.search_doc);
      let { vectors, errors } = parseVectorSidecar(sidecar.content);
      let ordinals = new Map<string, number>();
      for (let v of vectors) {
        let info = fields[v.field];
        let refuse = (code: string, message: string) =>
          errors.push({
            line: 0,
            field: v.field,
            item: v.item,
            code,
            message,
          });
        if (!info) {
          refuse(
            'unknown-vector-field',
            `${v.field} is not a vector field of this card`,
          );
          continue;
        }
        if (info.computed) {
          refuse(
            'vector-is-computed',
            `${v.field} is computed; the indexer writes it`,
          );
          continue;
        }
        if (v.space !== info.space) {
          refuse(
            'vector-space-mismatch',
            `${v.field} is in the space "${info.space}", not "${v.space}"`,
          );
          continue;
        }
        if (info.list && !v.item) {
          refuse(
            'needs-item-id',
            `${v.field} is inside a list; its line names the item`,
          );
          continue;
        }
        if (!info.list && v.item) {
          refuse(
            'unexpected-item-id',
            `${v.field} is a single field; its line names no item`,
          );
          continue;
        }
        let ordinal = ordinals.get(v.field) ?? 0;
        ordinals.set(v.field, ordinal + 1);
        push(row, {
          fieldPath: v.field,
          itemId: v.item,
          ordinal,
          space: v.space,
          sourceHash: v.sourceHash,
          components: v.components,
        });
      }
      records.push([
        '(',
        param(realm),
        ',',
        param(row.url),
        ',',
        param(row.type),
        ',',
        param(sidecar.hash),
        ',',
        param(sidecar.lastModified),
        ', CAST(',
        param(JSON.stringify(errors satisfies SidecarLineError[])),
        'AS jsonb))',
      ]);
    }

    for (let i = 0; i < values.length; i += CHUNK) {
      await host.query(store.insertVectors(values.slice(i, i + CHUNK)));
    }
    for (let i = 0; i < records.length; i += CHUNK) {
      await host.query([
        'INSERT INTO boxel_index_vector_sidecars (realm_url, url, type, sidecar_hash, sidecar_mtime, errors) VALUES',
        ...separatedByCommas(records.slice(i, i + CHUNK)),
        'ON CONFLICT (realm_url, url, type) DO UPDATE SET sidecar_hash = EXCLUDED.sidecar_hash, sidecar_mtime = EXCLUDED.sidecar_mtime, errors = EXCLUDED.errors',
      ] as Expression);
    }
  }
}
