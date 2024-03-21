import * as JSON from 'json-typescript';
import flatten from 'lodash/flatten';
import { logger, LooseSingleCardDocument } from '../index';
import {
  PgPrimitive,
  Expression,
  isParam,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
} from './expression';
import { type SerializedError } from '../error';
import { type SearchEntryWithErrors } from '../search-index';

interface IndexedCardsTable {
  card_url: string;
  realm_version: number;
  realm_url: string;
  pristine_doc: LooseSingleCardDocument | null;
  error_doc: SerializedError | null;
  search_doc: Record<string, PgPrimitive> | null;
  deps: JSON.Arr | null; // ideally this should be an array, but SQLite doesn't support that, rather we can use JSONB arrays
  embedded_html: string | null;
  isolated_html: string | null;
  indexed_at: number | null;
  is_deleted: boolean | null;
}

interface RealmVersionsTable {
  realm_url: string;
  current_version: number;
}

interface DBAdapter {
  // DB implementations perform DB connection and migration in this method.
  // DBAdapter implementations can take in DB specific config in their
  // constructors (username, password, etc)
  createClient: () => Promise<void>;
  execute: (
    sql: string,
    bind?: PgPrimitive[],
  ) => Promise<Record<string, PgPrimitive>[]>;
}

let log = logger('indexer-client');

export class IndexerClient {
  #ready: Promise<void>;

  constructor(private dbAdapter: DBAdapter) {
    this.#ready = this.dbAdapter.createClient();
  }

  async ready() {
    return this.#ready;
  }

  async query(query: Expression) {
    let sql = await this.expressionToSql(query);
    log.trace('search: %s trace: %j', sql.text, sql.values);
    return await this.dbAdapter.execute(sql.text, sql.values);
  }

  async cardsThatReference(cardId: string): Promise<string[]> {
    // TODO we really need a cursor based solution to iterate through
    // this--pervious implementations ran into a bug that necessitated a cursor
    // for large invalidations. But beware, cursor support for SQLite in worker
    // mode is very limited. This will likely require some custom work...

    // TODO convert this into an expression that uses this.query
    // TODO need to double-check that postgres supports these json functions
    let rows = (await this.dbAdapter.execute(
      `SELECT json_type(deps) as deps_type, 
              json_each(deps) as deps_each, 
         FROM indexed_cards 
         WHERE 
           pristine_doc IS NOT NULL AND 
           deps_type='array' AND
           deps_each.type='text' AND
           deps_each.value=$1
           `, // SQLite doesn't support arrays!!
      [cardId],
    )) as unknown as Pick<IndexedCardsTable, 'deps'>[];
    return flatten(rows.map((r) => (r.deps || []) as string[]));
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
  private _invalidations = new Set<string>();
  private declare realmVersion: number;

  constructor(
    private client: IndexerClient,
    private realmURL: URL, // this assumes that we only index cards in our own realm...
  ) {
    this.ready = this.setNextRealmVersion();
  }

  async updateEntry(url: URL, entry: SearchEntryWithErrors): Promise<void> {
    let { nameExpressions, valueExpressions } = asExpressions({
      card_url: url.href,
      realm_version: this.realmVersion,
      realm_url: this.realmURL.href,
      is_deleted: false,
      indexed_at: Date.now(),
      ...(entry.type === 'entry'
        ? {
            pristine_doc: entry.entry.resource,
            search_doc: entry.entry.searchData,
            isolated_html: entry.entry.html,
            deps: entry.entry.deps,
          }
        : {
            error_doc: entry.error,
            deps: entry.error.deps,
          }),
    } as IndexedCardsTable);

    await this.client.query([
      `INSERT OR REPLACE INTO indexed_cards`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ]);
  }

  async deleteEntry(url: URL): Promise<void> {
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
    await this.client.query([
      `DELETE FROM indexed_cards`,
      `WHERE card_url in `,
      ...addExplicitParens(
        separatedByCommas(
          this.invalidations.map((i) => [{ kind: 'param', param: i }]),
        ),
      ),
      'AND realm_version <',
      { kind: 'param', param: this.realmVersion },
    ]);
  }

  // these invalidations may include modules...
  get invalidations() {
    return [...this._invalidations];
  }

  private async setNextRealmVersion() {
    let [row] = (await this.client.query([
      'select current_version from realm_versions where realm_url =',
      { kind: 'param', param: this.realmURL.href },
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      this.realmVersion = 1;
    } else {
      this.realmVersion = row.current_version + 1;
    }
  }

  // invalidate will throw if 2 batches try to insert intersecting invalidation
  // graph. If this happens we should cancel the job that threw because of
  // primary key constraint violation and re-add it to the job queue with the
  // original notifier to try again
  async invalidate(
    url: URL /* this can be a card or module URL*/,
  ): Promise<void> {
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

      // TODO catch the primary key constraint violation exception and rethrow
      // it with a clearer error around what went wrong: concurrent batch
      // invalidation graph intersection
      await this.client.query([
        `INSERT INTO indexed_cards`,
        ...addExplicitParens(separatedByCommas(columns)),
        'VALUES',
        ...separatedByCommas(
          rows.map((value) => addExplicitParens(separatedByCommas(value))),
        ),
      ]);
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
