import flatten from 'lodash/flatten';
import {
  type CardResource,
  hasExecutableExtension,
  trimExecutableExtension,
  RealmPaths,
} from './index';
import { transpileJS } from './transpile';
import {
  type Expression,
  param,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
  every,
  query,
  upsert,
} from './expression';
import { type SerializedError } from './error';
import { type DBAdapter } from './db';
import {
  coerceTypes,
  type BoxelIndexTable,
  type RealmVersionsTable,
} from './index-structure';

export class IndexWriter {
  constructor(private dbAdapter: DBAdapter) {}

  async createBatch(realmURL: URL) {
    let batch = new Batch(this.dbAdapter, realmURL);
    await batch.ready;
    return batch;
  }
}

export type IndexEntry = InstanceEntry | ModuleEntry | CSSEntry | ErrorEntry;

export interface InstanceEntry {
  type: 'instance';
  source: string;
  lastModified: number;
  resource: CardResource;
  searchData: Record<string, any>;
  isolatedHtml?: string;
  embeddedHtml?: Record<string, string>;
  atomHtml?: string;
  types: string[];
  deps: Set<string>;
}

export interface ErrorEntry {
  type: 'error';
  error: SerializedError;
}

interface ModuleEntry {
  type: 'module';
  source: string;
  lastModified: number;
  deps: Set<string>;
}

interface CSSEntry {
  type: 'css';
  source: string;
  lastModified: number;
  deps: Set<string>;
}

export class Batch {
  readonly ready: Promise<void>;
  private touched = new Set<string>();
  private isNewGeneration = false;
  private declare realmVersion: number;

  constructor(
    private dbAdapter: DBAdapter,
    private realmURL: URL, // this assumes that we only index cards in our own realm...
  ) {
    this.ready = this.setNextRealmVersion();
  }

  private query(expression: Expression) {
    return query(this.dbAdapter, expression, coerceTypes);
  }

  async updateEntry(url: URL, entry: IndexEntry): Promise<void> {
    if (!new RealmPaths(this.realmURL).inRealm(url)) {
      // TODO this is a workaround for CS-6886. after we have solved that issue we can
      // drop this band-aid
      return;
    }
    let href = url.href;
    this.touched.add(href);
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        url: href,
        file_alias: trimExecutableExtension(url).href.replace(/\.json$/, ''),
        realm_version: this.realmVersion,
        realm_url: this.realmURL.href,
        is_deleted: false,
        indexed_at: Date.now(),
        ...(entry.type === 'instance'
          ? {
              // TODO in followup PR we need to alter the SearchEntry type to use
              // a document instead of a resource
              type: 'instance',
              pristine_doc: entry.resource,
              search_doc: entry.searchData,
              isolated_html: entry.isolatedHtml,
              embedded_html: entry.embeddedHtml,
              atom_html: entry.atomHtml,
              deps: [...entry.deps],
              types: entry.types,
              source: entry.source,
              last_modified: entry.lastModified,
            }
          : entry.type === 'module'
          ? {
              type: 'module',
              deps: [...entry.deps],
              source: entry.source,
              last_modified: entry.lastModified,
              transpiled_code: transpileJS(
                entry.source,
                new RealmPaths(this.realmURL).local(url),
              ),
            }
          : entry.type === 'css'
          ? {
              type: 'css',
              deps: [...entry.deps],
              source: entry.source,
              last_modified: entry.lastModified,
            }
          : {
              type: 'error',
              error_doc: entry.error,
              deps: entry.error.deps,
            }),
      } as Omit<BoxelIndexTable, 'last_modified' | 'indexed_at'> & {
        // we do this because pg automatically casts big ints into strings, so
        // we unwind that to accurately type the structure that we want to pass
        // _in_ to the DB
        last_modified: number;
        indexed_at: number;
      },
      {
        jsonFields: [...Object.entries(coerceTypes)]
          .filter(([_, type]) => type === 'JSON')
          .map(([column]) => column),
      },
    );

    await this.query([
      ...upsert(
        'boxel_index',
        'boxel_index_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  async makeNewGeneration() {
    await this.setNextGenerationRealmVersion();
    this.isNewGeneration = true;
    let cols = [
      'url',
      'file_alias',
      'type',
      'realm_url',
      'realm_version',
      'is_deleted',
    ].map((c) => [c]);
    await this.detectUniqueConstraintError(
      () =>
        // create tombstones for all card URLs
        this.query([
          `INSERT INTO boxel_index`,
          ...addExplicitParens(separatedByCommas(cols)),
          `SELECT i.url, i.file_alias, i.type, i.realm_url, ${this.realmVersion} as realm_version, true as is_deleted`,
          'FROM boxel_index as i',
          'INNER JOIN realm_versions r ON i.realm_url = r.realm_url',
          'WHERE i.realm_url =',
          param(this.realmURL.href),
          'AND',
          ...realmVersionExpression({ useWorkInProgressIndex: false }),
        ] as Expression),
      { isMakingNewGeneration: true },
    );
  }

  async done(): Promise<void> {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: this.realmURL.href,
      current_version: this.realmVersion,
    } as RealmVersionsTable);
    // Make the batch updates live
    await this.query([
      ...upsert(
        'realm_versions',
        'realm_versions_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);

    // prune obsolete generation index entries
    if (this.isNewGeneration) {
      await this.query([
        `DELETE FROM boxel_index`,
        'WHERE',
        ...every([
          ['realm_version <', param(this.realmVersion)],
          ['realm_url =', param(this.realmURL.href)],
        ]),
      ] as Expression);
    }
  }

  private async setNextRealmVersion() {
    let [row] = (await this.query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      let { nameExpressions, valueExpressions } = asExpressions({
        realm_url: this.realmURL.href,
        current_version: 0,
      } as RealmVersionsTable);
      // Make the batch updates live
      await this.query([
        ...upsert(
          'realm_versions',
          'realm_versions_pkey',
          nameExpressions,
          valueExpressions,
        ),
      ]);
      this.realmVersion = 1;
    } else {
      this.realmVersion = row.current_version + 1;
    }
  }

  // this will use a version higher than any in-progress indexing in case there
  // are artifacts left over from a failed index
  private async setNextGenerationRealmVersion() {
    let [maxVersionRow] = (await this.query([
      'SELECT MAX(realm_version) as max_version FROM boxel_index WHERE realm_url =',
      param(this.realmURL.href),
    ])) as { max_version: number }[];
    let maxVersion = (maxVersionRow?.max_version ?? 0) + 1;
    let nextVersion = Math.max(this.realmVersion, maxVersion);
    this.realmVersion = nextVersion;
  }

  async invalidate(url: URL): Promise<string[]> {
    await this.ready;
    let alias = trimExecutableExtension(url).href;
    let invalidations = [
      ...new Set([
        url.href,
        ...(alias ? await this.calculateInvalidations(alias) : []),
      ]),
    ];

    // insert tombstone into next version of the realm index
    let columns = [
      'url',
      'file_alias',
      'type',
      'realm_version',
      'realm_url',
      'is_deleted',
    ].map((c) => [c]);
    let rows = invalidations.map((id) =>
      [
        id,
        trimExecutableExtension(new URL(id)).href,
        hasExecutableExtension(id) ? 'module' : 'instance',
        this.realmVersion,
        this.realmURL.href,
        true,
      ].map((v) => [param(v)]),
    );

    await this.detectUniqueConstraintError(
      () =>
        this.query([
          `INSERT INTO boxel_index`,
          ...addExplicitParens(separatedByCommas(columns)),
          'VALUES',
          ...separatedByCommas(
            rows.map((value) => addExplicitParens(separatedByCommas(value))),
          ),
        ] as Expression),
      { url, invalidations },
    );

    this.touched = new Set([...this.touched, ...invalidations]);
    return invalidations;
  }

  // invalidate will throw if 2 batches try to insert intersecting invalidation
  // graph. If this happens we should cancel the job that threw because of
  // primary key constraint violation and re-add it to the job queue with the
  // original notifier to try again
  private async detectUniqueConstraintError(
    fn: () => Promise<unknown>,
    opts?: {
      url?: URL;
      invalidations?: string[];
      isMakingNewGeneration?: boolean;
    },
  ) {
    try {
      return await fn();
    } catch (e: any) {
      if (
        e.message?.includes('violates unique constraint') || // postgres
        e.result?.message?.includes('UNIQUE constraint failed') // sqlite
      ) {
        let message = `Invalidation conflict error in realm ${this.realmURL.href} version ${this.realmVersion}`;
        if (opts?.url && opts?.invalidations) {
          message =
            `${message}: the invalidation ${
              opts.url.href
            } resulted in invalidation graph: ${JSON.stringify(
              opts.invalidations,
            )} that collides with unfinished indexing. The most likely reason this happens is that there ` +
            `was an error encountered during incremental indexing that prevented the indexing from completing ` +
            `(and realm version increasing), then there was another incremental update to the same document ` +
            `that collided with the WIP artifacts from the indexing that never completed. Removing the WIP ` +
            `indexing artifacts (the rows(s) that triggered the unique constraint will solve the immediate ` +
            `problem, but likely the issue that triggered the unfinished indexing will need to be fixed to ` +
            `prevent this from happening in the future.`;
        } else if (opts?.isMakingNewGeneration) {
          message =
            `${message}. created a new generation while there was still unfinished indexing. ` +
            `The most likely reason this happens is that there was an error encountered during incremental ` +
            `indexing that prevented the indexing from completing (and realm version increasing), ` +
            `then the realm was restarted and the left over WIP indexing artifact(s) collided with the ` +
            `from-scratch indexing. To resolve this issue delete the WIP indexing artifacts (the row(s) ` +
            `that triggered the unique constraint) and restart the realm.`;
        }
        throw new Error(message);
      }
      throw e;
    }
  }

  private async itemsThatReference(
    alias: string,
    realmVersion: number,
  ): Promise<
    { url: string; alias: string; type: 'instance' | 'module' | 'error' }[]
  > {
    const pageSize = 1000;
    let results: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
      type: 'instance' | 'module' | 'error';
    })[] = [];
    let rows: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
      type: 'instance' | 'module' | 'error';
    })[] = [];
    let pageNumber = 0;
    do {
      // SQLite does not support cursors when used in the worker thread since
      // the API for using cursors cannot be serialized over the postMessage
      // boundary. so we use a handcrafted paging approach that leverages
      // realm_version to keep the result set stable across pages
      rows = (await this.query([
        'SELECT i.url, i.file_alias, i.type',
        'FROM boxel_index as i',
        'CROSS JOIN LATERAL jsonb_array_elements_text(i.deps) as deps_array_element',
        'INNER JOIN realm_versions r ON i.realm_url = r.realm_url',
        'WHERE',
        ...every([
          [`deps_array_element =`, param(alias)],
          realmVersionExpression({ withMaxVersion: realmVersion }),
          // css is a subset of modules, so there won't by any references that
          // are css entries that aren't already represented by a module entry
          [`i.type != 'css'`],
        ]),
        'ORDER BY i.url COLLATE "POSIX"',
        `LIMIT ${pageSize} OFFSET ${pageNumber * pageSize}`,
      ] as Expression)) as (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
        type: 'instance' | 'module' | 'error';
      })[];
      results = [...results, ...rows];
      pageNumber++;
    } while (rows.length === pageSize);
    return results.map(({ url, file_alias, type }) => ({
      url,
      alias: file_alias,
      type,
    }));
  }

  private async calculateInvalidations(
    alias: string,
    visited: string[] = [],
  ): Promise<string[]> {
    if (visited.includes(alias)) {
      return [];
    }
    let childInvalidations = await this.itemsThatReference(
      alias,
      this.realmVersion,
    );
    let invalidations = childInvalidations.map(({ url }) => url);
    let aliases = childInvalidations.map(({ alias: moduleAlias, type, url }) =>
      // for instances we expect that the deps for an entry always includes .json extension
      type === 'instance' ? url : moduleAlias,
    );
    let results = [
      ...invalidations,
      ...flatten(
        await Promise.all(
          aliases.map((a) =>
            this.calculateInvalidations(a, [...visited, alias]),
          ),
        ),
      ),
    ];
    return [...new Set(results)];
  }
}

function realmVersionExpression(opts?: {
  useWorkInProgressIndex?: boolean;
  withMaxVersion?: number;
}) {
  return [
    'realm_version =',
    ...addExplicitParens([
      'SELECT MAX(i2.realm_version)',
      'FROM boxel_index i2',
      'WHERE i2.url = i.url',
      ...(opts?.withMaxVersion
        ? ['AND i2.realm_version <=', param(opts?.withMaxVersion)]
        : !opts?.useWorkInProgressIndex
        ? // if we are not using the work in progress index then we limit the max
          // version permitted to the current version for the realm
          ['AND i2.realm_version <= r.current_version']
        : // otherwise we choose the highest version in the system
          []),
    ]),
  ] as Expression;
}
