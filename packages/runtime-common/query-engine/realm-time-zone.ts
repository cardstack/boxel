// A realm's default time zone: the `timeZone` its RealmConfig card
// (`realm.json`) declares, read from the index. One implementation for card
// searches (engine-core.ts, cached per index generation) and log searches
// (log-query.ts, through `realmTimeZoneFromIndex`).
//
// Owns: the statement that reads the RealmConfig card's document, the reading
// of its `timeZone`, and the per-generation cache.
// Must not: decide precedence (query > caller > realm default > UTC is the
// callers'), or check the zone against Postgres (`assertPostgresKnowsTimeZone`
// runs where the zone is used).
// Guarantees: docs/search.md, "Time zones". A name that is no IANA zone is
// ignored (the realm reckons in UTC) rather than failing every search.

import {
  type Expression,
  any,
  every,
  param,
  query as runQuery,
} from '../expression.ts';
import type { DBAdapter } from '../db.ts';
import { canonicalTimeZone } from '../time-zone.ts';

// A realm default zone already warned about, so a typo warns once.
const warnedRealmZones = new Set<string>();

// The RealmConfig card's pristine document, as a scalar subquery over `table`.
export function realmConfigDoc(realmURL: URL | string, table: string) {
  let file = new URL('realm.json', realmURL).href;
  let card = file.replace(/\.json$/, '');
  return [
    `(SELECT i.pristine_doc FROM ${table} AS i WHERE`,
    ...every([
      any([
        ['i.url =', param(file)],
        ['i.url =', param(card)],
        ['i.file_alias =', param(card)],
      ]),
      ['i.type =', param('instance')],
      any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
    ]),
    'LIMIT 1)',
  ] as Expression;
}

// The zone a RealmConfig document declares, canonical, or undefined when it
// declares none or names no zone (with a console warning, once, when
// `warn`).
export function zoneOfRealmConfig(
  realmURL: string,
  configDoc: unknown,
  warn: boolean,
): string | undefined {
  let doc = configDoc;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return undefined;
    }
  }
  let declared = (doc as { attributes?: { timeZone?: unknown } } | undefined)
    ?.attributes?.timeZone;
  if (declared == null || declared === '') return undefined;
  let zone = canonicalTimeZone(declared);
  if (warn && !zone && !warnedRealmZones.has(`${realmURL} ${declared}`)) {
    warnedRealmZones.add(`${realmURL} ${declared}`);
    console.warn(
      `ignoring the realm ${realmURL}'s timeZone ${JSON.stringify(declared)}, which is not an IANA time zone; its searches reckon in UTC`,
    );
  }
  return zone;
}

// The card engine's read, kept per realm with the realm's index generation
// it was read at: a search reads the generation (one row of
// `realm_generations`), and the RealmConfig card only when the generation
// has moved since, which every index commit does. A read that is not
// `cacheable` (a staged read, or an index without generations), or a realm
// with no generation row, reads the card every time.
export class RealmZoneCache {
  #zones = new Map<string, { generation: number; zone: string | undefined }>();

  async read(
    realmURL: URL,
    {
      table,
      cacheable,
      run,
    }: {
      table: string;
      cacheable: boolean;
      run: (expression: Expression) => Promise<Record<string, unknown>[]>;
    },
  ): Promise<string | undefined> {
    let cached = cacheable ? this.#zones.get(realmURL.href) : undefined;
    let configDoc = realmConfigDoc(realmURL, table);
    let rows = (await run(
      cacheable
        ? ([
            'SELECT rg.current_generation AS generation,',
            ...(cached
              ? [
                  'CASE WHEN rg.current_generation =',
                  param(cached.generation),
                  'THEN NULL ELSE',
                  ...configDoc,
                  'END',
                ]
              : configDoc),
            'AS pristine_doc FROM (SELECT 1) AS one LEFT JOIN realm_generations AS rg ON rg.realm_url =',
            param(realmURL.href),
          ] as Expression)
        : (['SELECT', ...configDoc, 'AS pristine_doc'] as Expression),
    )) as { pristine_doc?: unknown; generation?: unknown }[];
    let generation =
      rows[0]?.generation == null ? undefined : Number(rows[0].generation);
    if (cached && generation === cached.generation) {
      return cached.zone;
    }
    let zone = zoneOfRealmConfig(realmURL.href, rows[0]?.pristine_doc, true);
    if (cacheable) {
      if (generation === undefined) {
        this.#zones.delete(realmURL.href);
      } else {
        this.#zones.set(realmURL.href, { generation, zone });
      }
    }
    return zone;
  }
}

// The log engine's read: the published index, uncached, no warning (a log
// search reads the zone the same way, and the card search warns).
export async function realmTimeZoneFromIndex(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<string | undefined> {
  let rows = (await runQuery(dbAdapter, [
    'SELECT',
    ...realmConfigDoc(realmURL, 'boxel_index'),
    'AS pristine_doc',
  ])) as { pristine_doc?: unknown }[];
  return zoneOfRealmConfig(realmURL, rows[0]?.pristine_doc, false);
}
