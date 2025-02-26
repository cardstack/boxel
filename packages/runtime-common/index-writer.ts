import { Memoize } from 'typescript-memoize';
import flatten from 'lodash/flatten';
import flattenDeep from 'lodash/flattenDeep';
import {
  type CardResource,
  type RealmInfo,
  hasExecutableExtension,
  trimExecutableExtension,
  RealmPaths,
  unixTime,
  logger,
} from './index';
import { transpileJS } from './transpile';
import {
  type Expression,
  param,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
  every,
  any,
  query,
  upsert,
  dbExpression,
  upsertMultipleRows,
} from './expression';
import { type SerializedError } from './error';
import { type DBAdapter } from './db';
import {
  coerceTypes,
  RealmMetaTable,
  type BoxelIndexTable,
  type RealmVersionsTable,
} from './index-structure';

export class IndexWriter {
  #dbAdapter: DBAdapter;
  constructor(dbAdapter: DBAdapter) {
    this.#dbAdapter = dbAdapter;
  }

  async createBatch(realmURL: URL) {
    let batch = new Batch(this.#dbAdapter, realmURL);
    await batch.ready;
    return batch;
  }

  #query(expression: Expression) {
    return query(this.#dbAdapter, expression, coerceTypes);
  }

  async isNewIndex(realm: URL): Promise<boolean> {
    let [row] = (await this.#query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(realm.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    return !row;
  }
}

export type IndexEntry = InstanceEntry | ModuleEntry | ErrorEntry;
export type LastModifiedTimes = Map<
  string,
  { type: string; lastModified: number | null }
>;

export interface InstanceEntry {
  type: 'instance';
  source: string;
  lastModified: number;
  resourceCreatedAt: number;
  resource: CardResource;
  searchData: Record<string, any>;
  isolatedHtml?: string;
  embeddedHtml?: Record<string, string>;
  fittedHtml?: Record<string, string>;
  atomHtml?: string;
  iconHTML?: string;
  types: string[];
  displayNames: string[];
  deps: Set<string>;
}

export interface ErrorEntry {
  type: 'error';
  error: SerializedError;
  types?: string[];
  searchData?: Record<string, any>;
}

interface ModuleEntry {
  type: 'module';
  source: string;
  lastModified: number;
  resourceCreatedAt: number;
  deps: Set<string>;
}

export class Batch {
  readonly ready: Promise<void>;
  #invalidations = new Set<string>();
  #dbAdapter: DBAdapter;
  #perfLog = logger('index-perf');
  #log = logger('index-writer');
  declare private realmVersion: number;

  constructor(
    dbAdapter: DBAdapter,
    private realmURL: URL, // this assumes that we only index cards in our own realm...
  ) {
    this.#dbAdapter = dbAdapter;
    this.ready = this.setNextRealmVersion();
  }

  get invalidations() {
    return [...this.#invalidations];
  }

  @Memoize()
  private get nodeResolvedInvalidations() {
    return [...this.#invalidations].map(
      (href) => trimExecutableExtension(new URL(href)).href,
    );
  }

  async getModifiedTimes(): Promise<LastModifiedTimes> {
    let results = (await this.#query([
      `SELECT i.url, i.type, i.last_modified
       FROM boxel_index as i
          WHERE i.realm_url =`,
      param(this.realmURL.href),
    ] as Expression)) as Pick<
      BoxelIndexTable,
      'url' | 'type' | 'last_modified'
    >[];
    let result: LastModifiedTimes = new Map();
    for (let { url, type, last_modified: lastModified } of results) {
      result.set(url, {
        type,
        // lastModified is unix time, so it should be safe to cast to number
        lastModified: lastModified == null ? null : parseInt(lastModified),
      });
    }
    return result;
  }

  async copyFrom(sourceRealmURL: URL, destRealmInfo: RealmInfo): Promise<void> {
    let columns: string[][] | undefined;
    let sources = (await this.#query([
      `SELECT * FROM boxel_index WHERE`,
      // intentionally copying over error docs--perhaps these can be resolved in
      // the new realm?
      ...every([
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
        [`realm_url =`, param(sourceRealmURL.href)],
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    let now = String(Date.now());
    let values = sources.map((entry) => {
      let destURL = this.copiedRealmURL(
        sourceRealmURL,
        new URL(entry.url),
      ).href;
      this.#invalidations.add(destURL);
      if (entry.type === 'instance' && entry.source) {
        let json: { data: CardResource<string> } | undefined;
        try {
          json = JSON.parse(entry.source);
        } catch (e: any) {
          this.#log.info(
            `Cannot parse instance source for ${entry.url}: ${e.message}`,
          );
        }
        if (json) {
          json.data.id = destURL.replace(/\.json$/, '');
          entry.source = JSON.stringify(json);
        }
      }

      entry.url = destURL;
      entry.realm_url = this.realmURL.href;
      entry.realm_version = this.realmVersion;
      entry.file_alias = this.copiedRealmURL(
        sourceRealmURL,
        new URL(entry.file_alias),
      ).href;
      entry.types = entry.types
        ? entry.types.map(
            (type) => this.copiedRealmURL(sourceRealmURL, new URL(type)).href,
          )
        : entry.types;
      entry.deps = entry.deps
        ? entry.deps.map(
            (dep) => this.copiedRealmURL(sourceRealmURL, new URL(dep)).href,
          )
        : entry.deps;
      entry.pristine_doc = entry.pristine_doc
        ? {
            ...entry.pristine_doc,
            id: this.copiedRealmURL(
              sourceRealmURL,
              new URL(entry.pristine_doc.id),
            ).href,
          }
        : entry.pristine_doc;
      if (entry.type === 'instance' && entry.pristine_doc) {
        entry.pristine_doc.meta = {
          ...entry.pristine_doc.meta,
          realmURL: this.realmURL.href,
          realmInfo: destRealmInfo,
        };
      }
      entry.fitted_html = entry.fitted_html
        ? this.objectWithCopiedRealmKeys(sourceRealmURL, entry.fitted_html)
        : entry.fitted_html;
      entry.embedded_html = entry.embedded_html
        ? this.objectWithCopiedRealmKeys(sourceRealmURL, entry.embedded_html)
        : entry.embedded_html;
      entry.indexed_at = now;

      let { valueExpressions, nameExpressions } = asExpressions(entry);
      columns = nameExpressions;
      return valueExpressions;
    });
    if (!columns) {
      throw new Error(
        `nothing to copy from ${sourceRealmURL.href} - this realm is not present on the realm server`,
      );
    }

    await this.#query([
      ...upsertMultipleRows(
        'boxel_index_working',
        'boxel_index_working_pkey',
        columns,
        values,
      ),
    ]);
  }

  async updateEntry(url: URL, entry: IndexEntry): Promise<void> {
    if (!new RealmPaths(this.realmURL).inRealm(url)) {
      // TODO this is a workaround for CS-6886. after we have solved that issue we can
      // drop this band-aid
      return;
    }
    let href = url.href;
    this.#invalidations.add(url.href);
    let preparedEntry = {
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
            fitted_html: entry.fittedHtml,
            atom_html: entry.atomHtml,
            icon_html: entry.iconHTML,
            deps: [...entry.deps],
            types: entry.types,
            display_names: entry.displayNames,
            source: entry.source,
            last_modified: entry.lastModified,
            resource_created_at: entry.resourceCreatedAt,
            error_doc: null,
          }
        : entry.type === 'module'
          ? {
              type: 'module',
              deps: [...entry.deps],
              source: entry.source,
              last_modified: entry.lastModified,
              resource_created_at: entry.resourceCreatedAt,
              transpiled_code: transpileJS(
                entry.source,
                new RealmPaths(this.realmURL).local(url),
              ),
              error_doc: null,
            }
          : {
              types: entry.types,
              search_doc: entry.searchData,
              // favor the last known good types over the types derived from the error state
              ...((await this.getProductionVersion(url)) ?? {}),
              type: 'error',
              error_doc: entry.error,
            }),
    } as Omit<BoxelIndexTable, 'last_modified' | 'indexed_at'> & {
      // we do this because pg automatically casts big ints into strings, so
      // we unwind that to accurately type the structure that we want to pass
      // _in_ to the DB
      last_modified: number;
      indexed_at: number;
    };

    if (entry.type === 'error') {
      // merge the last known good deps with the error deps so we can invalidate
      // when upstream issue is repaired
      preparedEntry.deps = [
        ...new Set([
          ...(preparedEntry.deps ?? []),
          ...(entry.error.deps ?? []),
        ]),
      ];
    }

    let { nameExpressions, valueExpressions } = asExpressions(preparedEntry, {
      jsonFields: [...Object.entries(coerceTypes)]
        .filter(([_, type]) => type === 'JSON')
        .map(([column]) => column),
    });

    await this.#query([
      ...upsert(
        'boxel_index_working',
        'boxel_index_working_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  async done(): Promise<{ totalIndexEntries: number }> {
    await this.#query(['BEGIN']);
    await this.updateRealmMeta();
    await this.applyBatchUpdates();
    await this.pruneObsoleteEntries();
    await this.#query(['COMMIT']);

    let totalIndexEntries = await this.numberOfIndexEntries();
    return { totalIndexEntries };
  }

  #query(expression: Expression) {
    return query(this.#dbAdapter, expression, coerceTypes);
  }

  private async getProductionVersion(url: URL) {
    let [entry] = (await this.#query([
      `SELECT i.*`,
      `FROM boxel_index as i
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    if (!entry) {
      return undefined;
    }

    let {
      indexed_at: _remove1,
      last_modified: _remove2,
      resource_created_at: _remove3,
      realm_version: _remove4,
      ...productionVersion
    } = entry;
    return {
      ...productionVersion,
      last_modified: entry.last_modified ? parseInt(entry.last_modified) : null,
      resource_created_at: entry.resource_created_at
        ? parseInt(entry.resource_created_at)
        : null,
    };
  }

  private async numberOfIndexEntries() {
    let [{ total }] = (await this.#query([
      `SELECT count(i.url) as total
       FROM boxel_index as i
          WHERE`,
      ...every([
        ['i.realm_url =', param(this.realmURL.href)],
        ['i.type != ', param('error')],
        ['i.is_deleted != true'],
      ]),
    ] as Expression)) as { total: string }[];
    return parseInt(total);
  }

  private async updateRealmMeta() {
    let results = await this.#query([
      `SELECT CAST(count(i.url) AS INTEGER) as total, i.display_names->>0 as display_name, i.types->>0 as code_ref, MAX(i.icon_html) as icon_html
       FROM boxel_index_working as i
          WHERE`,
      ...every([
        ['i.realm_url =', param(this.realmURL.href)],
        ['i.type = ', param('instance')],
        ['i.types IS NOT NULL'],
        any([['i.is_deleted = false'], ['i.is_deleted IS NULL']]),
      ]),
      `GROUP BY i.display_names->>0, i.types->>0`,
      `ORDER BY i.display_names->>0 ASC`,
    ] as Expression);

    let { nameExpressions, valueExpressions } = asExpressions(
      {
        realm_url: this.realmURL.href,
        realm_version: this.realmVersion,
        value: results,
        indexed_at: unixTime(new Date().getTime()),
      } as Omit<RealmMetaTable, 'indexed_at'> & {
        indexed_at: number;
      },
      {
        jsonFields: ['value'],
      },
    );

    await this.#query([
      ...upsert(
        'realm_meta',
        'realm_meta_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  private async applyBatchUpdates() {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: this.realmURL.href,
      current_version: this.realmVersion,
    } as RealmVersionsTable);
    await this.#query([
      ...upsert(
        'realm_versions',
        'realm_versions_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);

    if (this.#invalidations.size > 0) {
      let columns = (await this.#dbAdapter.getColumnNames('boxel_index')).map(
        (c) => [c],
      );
      let names = flattenDeep(columns);
      await this.#query([
        'INSERT INTO boxel_index',
        ...addExplicitParens(separatedByCommas(columns)),
        'SELECT',
        ...separatedByCommas(columns),
        'FROM boxel_index_working',
        'WHERE',
        ...every([
          ['realm_url =', param(this.realmURL.href)],
          [
            'url in',
            ...addExplicitParens(
              separatedByCommas(
                [...this.#invalidations].map((i) => [param(i)]),
              ),
            ),
          ],
        ]),
        'ON CONFLICT ON CONSTRAINT boxel_index_pkey DO UPDATE SET',
        ...separatedByCommas(names.map((name) => [`${name}=EXCLUDED.${name}`])),
      ] as Expression);
    }
  }

  private async pruneObsoleteEntries() {
    await this.#query([
      `DELETE FROM realm_meta`,
      'WHERE',
      ...every([
        ['realm_version <', param(this.realmVersion)],
        ['realm_url =', param(this.realmURL.href)],
      ]),
    ] as Expression);
  }

  private async setNextRealmVersion() {
    let [row] = (await this.#query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      let { nameExpressions, valueExpressions } = asExpressions({
        realm_url: this.realmURL.href,
        current_version: 0,
      } as RealmVersionsTable);
      // Make the batch updates live
      await this.#query([
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

  async invalidate(url: URL): Promise<string[]> {
    await this.ready;
    let start = Date.now();
    this.#perfLog.debug(`starting invalidation of ${url.href}`);
    let alias = trimExecutableExtension(url).href;
    let visited = new Set<string>();

    await this.#query(['BEGIN']);
    let invalidations: string[] = [];
    try {
      invalidations = [
        ...new Set([
          ...(!this.nodeResolvedInvalidations.includes(alias)
            ? [url.href]
            : []),
          ...(alias ? await this.calculateInvalidations(alias, visited) : []),
        ]),
      ];

      if (invalidations.length === 0) {
        await this.#query(['COMMIT']);
        return [];
      }

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

      let insertStart = Date.now();
      await this.#query([
        ...upsertMultipleRows(
          'boxel_index_working',
          'boxel_index_working_pkey',
          columns,
          rows,
        ),
      ]);
      await this.#query(['COMMIT']);

      this.#perfLog.debug(
        `inserted invalidated rows for  ${url.href} in ${
          Date.now() - insertStart
        } ms`,
      );
    } catch (e) {
      await this.#query(['ROLLBACK']);
      throw e;
    }

    this.#perfLog.debug(
      `completed invalidation of ${url.href} in ${Date.now() - start} ms`,
    );

    this.#invalidations = new Set([...this.#invalidations, ...invalidations]);
    return invalidations;
  }

  private async itemsThatReference(
    resolvedPath: string,
  ): Promise<
    { url: string; alias: string; type: 'instance' | 'module' | 'error' }[]
  > {
    let start = Date.now();
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
      // boundary. so we use a handcrafted paging approach
      rows = (await this.#query([
        'SELECT i.url, i.file_alias, i.type',
        'FROM boxel_index_working as i',
        dbExpression({
          sqlite:
            'CROSS JOIN LATERAL jsonb_array_elements_text(i.deps) as deps_array_element',
        }),
        'WHERE',
        ...every([
          [
            dbExpression({
              sqlite: `deps_array_element =`,
              pg: `i.deps @>`,
            }),
            param({ sqlite: resolvedPath, pg: `["${resolvedPath}"]` }),
          ],
          // css is a subset of modules, so there won't by any references that
          // are css entries that aren't already represented by a module entry
          [`i.type != 'css'`],
          // probably need to reevaluate this condition when we get to cross
          // realm invalidation
          [`i.realm_url =`, param(this.realmURL.href)],
        ]),
        `LIMIT ${pageSize} OFFSET ${pageNumber * pageSize}`,
      ] as Expression)) as (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
        type: 'instance' | 'module' | 'error';
      })[];
      results = [...results, ...rows];
      pageNumber++;
    } while (rows.length === pageSize);
    this.#perfLog.debug(
      `time to determine items that reference ${resolvedPath} ${
        Date.now() - start
      } ms (page count=${pageNumber})`,
    );
    return results.map(({ url, file_alias, type }) => ({
      url,
      alias: file_alias,
      type,
    }));
  }

  private async calculateInvalidations(
    resolvedPath: string,
    visited: Set<string>,
  ): Promise<string[]> {
    if (
      visited.has(resolvedPath) ||
      this.nodeResolvedInvalidations.includes(resolvedPath)
    ) {
      return [];
    }
    visited.add(resolvedPath);
    let items = await this.itemsThatReference(resolvedPath);
    let invalidations = items.map(({ url }) => url);
    let aliases = items.map(({ alias: moduleAlias, type, url }) =>
      // for instances we expect that the deps for an entry always includes .json extension
      type === 'instance' ? url : moduleAlias,
    );
    let results = [
      ...invalidations,
      ...flatten(
        await Promise.all(
          aliases.map((a) => this.calculateInvalidations(a, visited)),
        ),
      ),
    ];
    return [...new Set(results)];
  }

  private copiedRealmURL(fromRealm: URL, file: URL): URL {
    let source = new RealmPaths(fromRealm);
    let dest = new RealmPaths(this.realmURL);
    if (!source.inRealm(file)) {
      return file;
    }
    let local = source.local(file);
    return dest.fileURL(local);
  }

  private objectWithCopiedRealmKeys(
    fromRealm: URL,
    obj: Record<string, any>,
  ): Record<string, any> {
    let result: Record<string, any> = {};
    for (let [key, value] of Object.entries(obj)) {
      result[this.copiedRealmURL(fromRealm, new URL(key)).href] = value;
    }
    return result;
  }
}
