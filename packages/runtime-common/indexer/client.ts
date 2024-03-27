import flatten from 'lodash/flatten';
import { type LooseCardResource } from '../index';
import {
  type PgPrimitive,
  type Expression,
  isParam,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
} from './expression';
import { type SerializedError } from '../error';
import { type DBAdapter, type ExecuteOptions } from '../db';
import { type SearchEntryWithErrors } from '../search-index';

export interface IndexedCardsTable {
  card_url: string;
  realm_version: number;
  realm_url: string;
  // TODO in followup PR update this to be a document not a resource
  pristine_doc: LooseCardResource | null;
  error_doc: SerializedError | null;
  search_doc: Record<string, PgPrimitive> | null;
  // `deps` is a list of URLs that the card depends on, either card URL's or
  // module URL's
  deps: string[] | null;
  // `types` is the adoption chain for card where each code ref is serialized
  // using `internalKeyFor()`
  types: string[] | null;
  embedded_html: string | null;
  isolated_html: string | null;
  indexed_at: number | null;
  is_deleted: boolean | null;
}

export interface RealmVersionsTable {
  realm_url: string;
  current_version: number;
}

interface GetEntryOptions {
  useWorkInProgressIndex?: boolean;
}

export class IndexerDBClient {
  #ready: Promise<void>;

  constructor(private dbAdapter: DBAdapter) {
    this.#ready = this.dbAdapter.startClient();
  }

  async ready() {
    return this.#ready;
  }

  async teardown() {
    await this.dbAdapter.close();
  }

  async query(query: Expression, opts?: Omit<ExecuteOptions, 'bind'>) {
    let sql = await this.expressionToSql(query);
    // set chrome console to "Verbose" to see these queries in the console
    console.debug(`sql: ${sql.text} bindings: ${sql.values}`);
    return await this.dbAdapter.execute(sql.text, {
      ...opts,
      bind: sql.values,
    });
  }

  async getIndexEntry(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedCardsTable | undefined> {
    let result = (await this.query(
      [
        `SELECT i.* 
         FROM indexed_cards as i
         JOIN realm_versions r ON i.realm_url = r.realm_url
         WHERE i.card_url =`,
        {
          kind: 'param',
          param: `${
            !url.href.endsWith('.json') ? url.href + '.json' : url.href
          }`,
        },
        ...(!opts?.useWorkInProgressIndex
          ? // if we are not using the work in progress index then we limit the max
            // version permitted to the current version for the realm
            ['AND i.realm_version <= r.current_version']
          : // otherwise we choose the highest version in the system
            []),
        'ORDER BY i.realm_version DESC',
        'LIMIT 1',
      ],
      {
        coerceTypes: {
          deps: 'JSON',
          types: 'JSON',
          pristine_doc: 'JSON',
          error_doc: 'JSON',
          search_doc: 'JSON',
          is_deleted: 'BOOLEAN',
        },
      },
    )) as unknown as IndexedCardsTable[];
    let maybeResult: IndexedCardsTable | undefined = result[0];
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }

    return maybeResult;
  }

  async createBatch(realmURL: URL) {
    let batch = new Batch(this, realmURL);
    await batch.ready;
    return batch;
  }

  async cardsThatReference(cardId: string): Promise<string[]> {
    // TODO we really need a cursor based solution to iterate through
    // this--pervious implementations ran into a bug that necessitated a cursor
    // for large invalidations. But beware, cursor support for SQLite in worker
    // mode is very limited. This will likely require some custom work...

    let rows = (await this.query([
      `SELECT indexed_cards.card_url
         FROM
           indexed_cards,
           json_each(indexed_cards.deps) as deps_each
         WHERE 
           deps_each.value =`,
      // WARNING!!! SQLite doesn't support arrays, and the json_each() and
      // json_tree() functions that it does support are table-valued functions
      // meaning that we can only use them like tables. unsure if there is a
      // postgres equivalent. Need to research this.
      { kind: 'param', param: cardId },
    ])) as Pick<IndexedCardsTable, 'card_url'>[];
    return rows.map((r) => r.card_url);
  }

  private expressionToSql(query: Expression) {
    let values: PgPrimitive[] = [];
    let text = query
      .map((element) => {
        if (isParam(element)) {
          values.push(element.param);
          return `$${values.length}`;
        } else if (typeof element === 'string') {
          return element;
        } else {
          throw new Error(`should never happen ${element}`);
        }
      })
      .join(' ');
    return {
      text,
      values,
    };
  }
}

export class Batch {
  readonly ready: Promise<void>;
  private touched = new Set<string>();
  private isNewGeneration = false;
  private declare realmVersion: number;

  constructor(
    private client: IndexerDBClient,
    private realmURL: URL, // this assumes that we only index cards in our own realm...
  ) {
    this.ready = this.setNextRealmVersion();
  }

  async updateEntry(url: URL, entry: SearchEntryWithErrors): Promise<void> {
    this.touched.add(url.href);
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        card_url: url.href,
        realm_version: this.realmVersion,
        realm_url: this.realmURL.href,
        is_deleted: false,
        indexed_at: Date.now(),
        ...(entry.type === 'entry'
          ? {
              // TODO in followup PR we need to alter the SearchEntry type to use
              // a document instead of a resource
              pristine_doc: entry.entry.resource,
              search_doc: entry.entry.searchData,
              isolated_html: entry.entry.html,
              deps: [...entry.entry.deps],
              types: entry.entry.types,
            }
          : {
              error_doc: entry.error,
              deps: entry.error.deps,
            }),
      } as IndexedCardsTable,
      {
        jsonFields: [
          'pristine_doc',
          'search_doc',
          'deps',
          'types',
          'error_doc',
        ],
      },
    );

    await this.client.query([
      `INSERT OR REPLACE INTO indexed_cards`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ]);
  }

  async deleteEntry(url: URL): Promise<void> {
    this.touched.add(url.href);
    let { nameExpressions, valueExpressions } = asExpressions({
      card_url: url.href,
      realm_version: this.realmVersion,
      realm_url: this.realmURL.href,
      is_deleted: true,
      indexed_at: Date.now(),
    } as IndexedCardsTable);

    await this.client.query([
      `INSERT OR REPLACE INTO indexed_cards`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ]);
  }

  async makeNewGeneration() {
    this.isNewGeneration = true;
    let cols = ['card_url', 'realm_url', 'realm_version', 'is_deleted'].map(
      (c) => [c],
    );
    await this.detectUniqueConstraintError(
      () =>
        // create tombstones for all card URLs
        this.client.query([
          `INSERT INTO indexed_cards`,
          ...addExplicitParens(separatedByCommas(cols)),
          `SELECT card_url, realm_url, 2 as realm_version, true as is_deleted`,
          'FROM indexed_cards WHERE realm_url =',
          { kind: 'param', param: this.realmURL.href },
          'GROUP BY card_url',
        ]),
      { isMakingNewGeneration: true },
    );
  }

  async done(): Promise<void> {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: this.realmURL.href,
      current_version: this.realmVersion,
    } as RealmVersionsTable);
    // Make the batch updates live
    await this.client.query([
      `INSERT OR REPLACE INTO realm_versions`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ]);

    // prune obsolete index entries
    if (this.isNewGeneration) {
      await this.client.query([
        `DELETE FROM indexed_cards`,
        'WHERE realm_version <',
        { kind: 'param', param: this.realmVersion },
      ]);
    } else {
      await this.client.query([
        `DELETE FROM indexed_cards`,
        `WHERE card_url IN`,
        ...addExplicitParens(
          separatedByCommas(
            [...this.touched].map((i) => [{ kind: 'param', param: i }]),
          ),
        ),
        'AND realm_version <',
        { kind: 'param', param: this.realmVersion },
      ]);
    }
  }

  private async setNextRealmVersion() {
    let [row] = (await this.client.query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      { kind: 'param', param: this.realmURL.href },
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      this.realmVersion = 1;
    } else {
      this.realmVersion = row.current_version + 1;
    }
  }

  async invalidate(
    url: URL /* this can be a card or module URL. This must include .json extension for cards */,
  ): Promise<string[]> {
    await this.ready;

    let invalidations = await this.calculateInvalidations(url.href);

    if (url.href.endsWith('.json')) {
      // insert tombstone into next version of the realm index
      let columns = [
        'card_url',
        'realm_version',
        'realm_url',
        'is_deleted',
      ].map((c) => [c]);
      let rows = invalidations
        // don't add module URLs to indexed_cards table--we use
        // '.json' extension as heuristic to identify card instances
        .filter((i) => i.endsWith('.json'))
        .map((id) =>
          [id, this.realmVersion, this.realmURL.href, true].map((v) => [
            { kind: 'param' as const, param: v },
          ]),
        );

      await this.detectUniqueConstraintError(
        () =>
          this.client.query([
            `INSERT INTO indexed_cards`,
            ...addExplicitParens(separatedByCommas(columns)),
            'VALUES',
            ...separatedByCommas(
              rows.map((value) => addExplicitParens(separatedByCommas(value))),
            ),
          ]),
        { url, invalidations },
      );
    }

    // FYI: these invalidations may include modules...
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
      // TODO need to also catch the pg form of this error
      // which would be great to bake into the adapter layer
      if (e.result?.message?.includes('UNIQUE constraint failed')) {
        let message = `Invalidation conflict error in realm ${this.realmURL.href} version ${this.realmVersion}`;
        if (opts?.url && opts?.invalidations) {
          message = `${message}: the invalidation ${
            opts.url.href
          } resulted in invalidation graph: ${JSON.stringify(
            opts.invalidations,
          )} that collides with unfinished indexing`;
        } else if (opts?.isMakingNewGeneration) {
          message = `${message}. created a new generation while there was still unfinished indexing`;
        }
        throw new Error(message);
      }
      throw e;
    }
  }

  private async calculateInvalidations(id: string): Promise<string[]> {
    let invalidations = [id];
    let childInvalidations = await this.client.cardsThatReference(id);
    invalidations = [
      ...invalidations,
      ...flatten(
        await Promise.all(
          childInvalidations.map((id) => this.calculateInvalidations(id)),
        ),
      ),
    ];
    return [...new Set(invalidations)];
  }
}
