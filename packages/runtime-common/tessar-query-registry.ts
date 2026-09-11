import type { DBAdapter } from './db.ts';
import type { IndexQueryEngine } from './index-query-engine.ts';
import type { Query } from './query.ts';
import {
  any,
  every,
  param,
  query,
  type Expression,
  type Querier,
} from './expression.ts';

export interface TessarWatch {
  fieldPath: string;
  query: Query;
}

export interface TessarPreparedWatch extends TessarWatch {
  terms: Array<{ path: string; value: string }>;
}

export type TessarDocument = Parameters<
  IndexQueryEngine['tessarMatchesDocument']
>[1];

// All mutations take the caller's pinned transaction. Index publication and
// watch replacement must commit together. A notification is never the queue:
// dirty_generation survives disconnects and worker restarts.
export class TessarQueryRegistry {
  private db: DBAdapter;
  private engine: IndexQueryEngine;
  constructor(db: DBAdapter, engine: IndexQueryEngine) {
    this.db = db;
    this.engine = engine;
  }

  async prepare(watches: TessarWatch[]): Promise<TessarPreparedWatch[]> {
    let paths = new Set<string>();
    let prepared: TessarPreparedWatch[] = [];
    for (let watch of watches) {
      if (!watch.fieldPath || paths.has(watch.fieldPath)) {
        throw new Error('Tessar watch paths must be nonempty and unique');
      }
      paths.add(watch.fieldPath);
      // Page and sort affect the output, but never narrow invalidation. Even a
      // non-returned match can change an aggregate or displace a page member.
      let terms = await this.engine.tessarRoutingTerms(watch.query.filter);
      prepared.push({
        ...watch,
        terms: terms?.length ? terms : [{ path: '', value: '' }],
      });
    }
    return prepared;
  }

  async publish(
    tx: Querier,
    owner: {
      realmURL: string;
      ownerURL: string;
      generation: number;
      inputGeneration: number;
      definitionRevision: string;
      watches: TessarPreparedWatch[];
      retired?: boolean;
    },
  ): Promise<boolean> {
    let { realmURL, ownerURL, generation, inputGeneration } = owner;
    if (
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      !Number.isSafeInteger(inputGeneration) ||
      inputGeneration < 0 ||
      inputGeneration > generation
    ) {
      throw new Error(
        'Tessar publication needs valid input and owner generations',
      );
    }
    for (let watch of owner.watches) {
      let realms =
        watch.query.realms ??
        (watch.query.realm ? [watch.query.realm] : [realmURL]);
      if (realms.length !== 1 || realms[0] !== realmURL) {
        throw new Error('Tessar watches currently require the owner realm');
      }
    }
    let [previous] = await tx([
      'SELECT published_generation, dirty_generation FROM tessar_owners WHERE',
      ...this.ownerCondition(realmURL, ownerURL),
    ]);
    if (
      (previous && Number(previous.published_generation) > generation) ||
      (previous?.dirty_generation != null &&
        Number(previous.dirty_generation) > inputGeneration)
    ) {
      return false;
    }
    await tx([
      `INSERT INTO tessar_owners
       (realm_url, owner_url, published_generation, input_generation,
        dirty_generation, definition_revision, retired) VALUES (`,
      param(realmURL),
      ',',
      param(ownerURL),
      ',',
      param(generation),
      ',',
      param(inputGeneration),
      ', NULL,',
      param(owner.definitionRevision),
      ',',
      param(owner.retired ?? false),
      `) ON CONFLICT (realm_url, owner_url) DO UPDATE SET
       published_generation = EXCLUDED.published_generation,
       input_generation = EXCLUDED.input_generation, dirty_generation = NULL,
       definition_revision = EXCLUDED.definition_revision,
       retired = EXCLUDED.retired`,
    ]);
    for (let table of ['tessar_query_terms', 'tessar_query_watches']) {
      await tx([
        `DELETE FROM ${table} WHERE`,
        ...this.ownerCondition(realmURL, ownerURL),
      ]);
    }
    if (owner.retired) return true;
    for (let watch of owner.watches) {
      await tx([
        `INSERT INTO tessar_query_watches
         (realm_url, owner_url, field_path, query) VALUES (`,
        param(realmURL),
        ',',
        param(ownerURL),
        ',',
        param(watch.fieldPath),
        ',',
        param(JSON.stringify(watch.query)),
        ')',
      ]);
      let seen = new Set<string>();
      for (let term of watch.terms) {
        let key = JSON.stringify([term.path, term.value]);
        if (seen.has(key)) continue;
        seen.add(key);
        await tx([
          `INSERT INTO tessar_query_terms
           (realm_url, owner_url, field_path, path, value) VALUES (`,
          param(realmURL),
          ',',
          param(ownerURL),
          ',',
          param(watch.fieldPath),
          ',',
          param(term.path),
          ',',
          param(term.value),
          ')',
        ]);
      }
    }
    return true;
  }

  async candidates(realmURL: string, document: TessarDocument) {
    let routes = [
      every([
        ['t.path =', param('')],
        ['t.value =', param('')],
      ]),
    ];
    for (let [path, value] of Object.entries(document.search_doc ?? {})) {
      if (typeof value !== 'string') continue;
      routes.push(
        every([
          ['t.path =', param(path)],
          ['t.value =', param(value)],
        ]),
      );
    }
    let rows = await query(
      this.db,
      [
        `SELECT DISTINCT w.owner_url, w.field_path, w.query
       FROM tessar_query_terms t JOIN tessar_query_watches w
         ON w.realm_url = t.realm_url AND w.owner_url = t.owner_url
        AND w.field_path = t.field_path
       WHERE`,
        ...(every([
          ['t.realm_url =', param(realmURL)],
          any(routes),
        ]) as Expression),
      ],
      { query: 'JSON' },
    );
    return rows.map((row) => ({
      ownerURL: row.owner_url as string,
      fieldPath: row.field_path as string,
      query: row.query as unknown as Query,
    }));
  }

  async affected(
    realmURL: string,
    oldDocument: TessarDocument | undefined,
    newDocument: TessarDocument | undefined,
  ): Promise<string[]> {
    let owners = new Set<string>();
    for (let document of [oldDocument, newDocument]) {
      if (!document) continue;
      for (let watch of await this.candidates(realmURL, document)) {
        if (owners.has(watch.ownerURL)) continue;
        if (
          await this.engine.tessarMatchesDocument(watch.query.filter, document)
        ) {
          owners.add(watch.ownerURL);
        }
      }
    }
    return [...owners].sort();
  }

  async markDirty(
    tx: Querier,
    realmURL: string,
    owners: string[],
    generation: number,
  ) {
    for (let ownerURL of new Set(owners)) {
      await tx([
        `UPDATE tessar_owners SET dirty_generation = CASE
         WHEN dirty_generation IS NULL OR dirty_generation <`,
        param(generation),
        'THEN',
        param(generation),
        'ELSE dirty_generation END WHERE',
        ...(every([
          this.ownerCondition(realmURL, ownerURL),
          ['retired = FALSE'],
          ['input_generation <', param(generation)],
        ]) as Expression),
      ]);
    }
  }

  async pending(
    realmURL: string,
  ): Promise<Array<{ ownerURL: string; generation: number }>> {
    let rows = await query(this.db, [
      `SELECT owner_url, dirty_generation FROM tessar_owners
       WHERE realm_url =`,
      param(realmURL),
      'AND retired = FALSE AND dirty_generation IS NOT NULL ORDER BY owner_url',
    ]);
    return rows.map((row) => ({
      ownerURL: row.owner_url as string,
      generation: Number(row.dirty_generation),
    }));
  }

  private ownerCondition(realmURL: string, ownerURL: string) {
    return every([
      ['realm_url =', param(realmURL)],
      ['owner_url =', param(ownerURL)],
    ]) as Expression;
  }
}
