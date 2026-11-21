// The value store (boxel_index_values and its dictionaries) and its unplaced-text index.
//
// One migration for this structure: the steps below are the migrations it
// was built from, in their order, each kept whole with its own
// notes. Each step's up runs in order and its down in reverse. A step that
// builds an index CONCURRENTLY calls noTransaction(), so the migration runs
// outside one transaction, as those steps did on their own.

exports.shorthands = undefined;

// ---- 1794462915437_add-boxel-index-values.js ----
const step1 = (() => {
  const exports = {};
  // The value store: every small value of every card, one row per value, with
  // ordered indexes, so a search can count, bucket, range and sort a card's
  // values from narrow rows instead of reading each matching row's projection
  // (`search_keys`). It is filled the same way for every card of every type and
  // names no app's field.
  //
  // What gets a row is what `search_keys` keeps, with one walk over it
  // (`boxel_index_value_rows`):
  //
  // - each scalar leaf, at its path (the object keys joined by `.`, a list's
  //   positions dropped, so a list's elements share the path, and a list of
  //   links holds `path.id`), once per distinct value: `kind` is 's' for a
  //   string, 'n' for a number, 'b' for a boolean. A null is no row.
  // - each `{"$doc": true}` marker, at the marked path (`kind` 'm', no value):
  //   the values at and under it are only in the search doc, so a read of such
  //   a card falls back to the doc. A projection that is the marker itself has
  //   one at the empty path.
  // - one row per card at the empty path (`kind` 'c', `txt` ''), so a count over
  //   a type reads one index entry per card.
  //
  // `txt` is a string's or a boolean's text ('true' / 'false'); `num` a number;
  // `ts` the instant of a string that is an ISO 8601 date (`YYYY-MM-DD`, read as
  // UTC midnight) or date-time (`YYYY-MM-DDTHH:MM[:SS[.fff]]`, with `Z` or an
  // offset; with no zone, UTC) that Postgres accepts (`boxel_value_instant`).
  //
  // The realm, the card, the path and the card's own type (`types ->> 0`) are
  // small integers through four dictionaries, so a row is about 77 bytes and an
  // index entry about 40. A card's id is never reused, and is not in url order.
  // The realm, card and type dictionaries carry the realm's URL, as every side
  // table of the index does, so a test harness's clone rewrites them and its
  // reset clears them; a type's id is its realm's (a type key names a module
  // URL). Paths name no realm and are shared.
  //
  // The index writer replaces a card's rows when it promotes a pass, from the
  // promoted row, in the swap transaction (`value-store.ts`). Only a live card
  // has rows: an instance that is not deleted, has no error, and whose
  // prerendered html carries no error from its generation or later (the
  // engine's liveness test), so a count from the store needs no recheck. A
  // deleted realm's rows go with it (realm-destruction-utils).
  //
  // The store is UNLOGGED, as `boxel_index` is: a crash empties both, and the
  // rebuild that follows refills both. A logged store would survive the crash
  // its source does not, and answer counts and facets for cards the empty
  // index no longer has, and, after the rebuild, for cards deleted meanwhile,
  // which no tombstone ever reaches. The four dictionaries go with it: only
  // the store's rows hold their ids, so none can outlive the ids it names.
  // Like `boxel_index`, the store does not reach a physical standby. A
  // database that holds the tables logged (one that ran an earlier version
  // of this structure) is set UNLOGGED here, which rewrites each table under
  // an exclusive lock (the bench's 639 MB of values: about 5 s).
  //
  // This migration fills the store from the rows already indexed (the bridge
  // step for a database that holds cards): on the bench, 117,550 live cards and
  // 3.4 million rows. Postgres only (excluded from the SQLite schema): the
  // browser index reads the search doc.
  //
  // The bridge fills only the cards that have no rows yet, so running it on a
  // database that already holds the store (one that ran this structure under
  // another migration's name, or ran this one before) leaves the store as it
  // is: every live card with rows has its `c` row.

  exports.up = (pgm) => {
    pgm.sql(`
    CREATE OR REPLACE FUNCTION boxel_value_instant(t TEXT) RETURNS TIMESTAMPTZ
    IMMUTABLE PARALLEL SAFE LANGUAGE sql AS $$
      SELECT CASE
        WHEN t ~ '^\\d{4}-\\d{2}-\\d{2}$' AND pg_input_is_valid(t, 'date')
          THEN (t::timestamp AT TIME ZONE 'UTC')
        WHEN t ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?(Z|[+-]\\d{2}(:?\\d{2})?)$'
             AND pg_input_is_valid(t, 'timestamptz')
          THEN t::timestamptz
        WHEN t ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?$'
             AND pg_input_is_valid(t, 'timestamp')
          THEN (t::timestamp AT TIME ZONE 'UTC')
      END
    $$
  `);
    pgm.sql(`
    CREATE OR REPLACE FUNCTION boxel_value_rows(keys JSONB)
    RETURNS TABLE (path TEXT, kind "char", txt TEXT, num NUMERIC, ts TIMESTAMPTZ)
    IMMUTABLE PARALLEL SAFE LANGUAGE sql AS $$
      WITH RECURSIVE w (path, v) AS (
        SELECT k, e FROM jsonb_each(CASE WHEN jsonb_typeof(keys) = 'object'
                                          AND NOT keys ? '$doc' THEN keys END) AS j (k, e)
        UNION ALL
        SELECT CASE WHEN c.k IS NULL THEN w.path ELSE w.path || '.' || c.k END, c.e
        FROM w CROSS JOIN LATERAL (
          SELECT x.k, x.e FROM jsonb_each(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v END) AS x (k, e)
          UNION ALL
          SELECT NULL, y.e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v) = 'array' THEN w.v END) AS y (e)
        ) AS c
        WHERE jsonb_typeof(w.v) IN ('object', 'array')
          AND NOT (jsonb_typeof(w.v) = 'object' AND w.v ? '$doc')
      )
      SELECT DISTINCT w.path,
        CASE jsonb_typeof(w.v) WHEN 'string' THEN 's' WHEN 'number' THEN 'n' ELSE 'b' END::"char",
        CASE WHEN jsonb_typeof(w.v) <> 'number' THEN w.v #>> '{}' END,
        CASE WHEN jsonb_typeof(w.v) = 'number' THEN (w.v #>> '{}')::numeric END,
        CASE WHEN jsonb_typeof(w.v) = 'string' THEN boxel_value_instant(w.v #>> '{}') END
      FROM w WHERE jsonb_typeof(w.v) IN ('string', 'number', 'boolean')
      UNION ALL
      SELECT DISTINCT w.path, 'm'::"char", NULL::text, NULL::numeric, NULL::timestamptz
      FROM w WHERE jsonb_typeof(w.v) = 'object' AND w.v ? '$doc'
      UNION ALL
      SELECT '', 'm'::"char", NULL::text, NULL::numeric, NULL::timestamptz
      WHERE jsonb_typeof(keys) IS DISTINCT FROM 'object' OR keys ? '$doc'
      UNION ALL
      SELECT '', 'c'::"char", '', NULL::numeric, NULL::timestamptz
    $$
  `);
    pgm.sql(`
    CREATE UNLOGGED TABLE IF NOT EXISTS boxel_index_value_realms (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      realm_url TEXT COLLATE "C" NOT NULL UNIQUE
    );
    CREATE UNLOGGED TABLE IF NOT EXISTS boxel_index_value_cards (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      realm_url TEXT COLLATE "C" NOT NULL,
      url TEXT COLLATE "C" NOT NULL,
      -- What the card's rows derive from while it has them (value-store.ts):
      -- a pass rewrites only the cards whose fingerprint changed.
      keys_fp TEXT,
      CONSTRAINT boxel_index_value_cards_realm_url_url_key UNIQUE (realm_url, url)
    );
    ALTER TABLE boxel_index_value_cards ADD COLUMN IF NOT EXISTS keys_fp TEXT;
    CREATE UNLOGGED TABLE IF NOT EXISTS boxel_index_value_paths (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      path TEXT COLLATE "C" NOT NULL UNIQUE
    );
    CREATE UNLOGGED TABLE IF NOT EXISTS boxel_index_value_types (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      realm_url TEXT COLLATE "C" NOT NULL,
      type TEXT COLLATE "C" NOT NULL,
      types JSONB NOT NULL,
      CONSTRAINT boxel_index_value_types_realm_url_type_key UNIQUE (realm_url, type)
    );
    CREATE UNLOGGED TABLE IF NOT EXISTS boxel_index_values (
      realm_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      path_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      kind "char" NOT NULL,
      txt TEXT COLLATE "C",
      num NUMERIC,
      ts TIMESTAMPTZ
    );
    ALTER TABLE boxel_index_value_realms SET UNLOGGED;
    ALTER TABLE boxel_index_value_cards SET UNLOGGED;
    ALTER TABLE boxel_index_value_paths SET UNLOGGED;
    ALTER TABLE boxel_index_value_types SET UNLOGGED;
    ALTER TABLE boxel_index_values SET UNLOGGED;
  `);
    // The bridge: the store of every live card already indexed that has no
    // rows yet. Filled before its indexes are built, in key order, so the build
    // is one sort per index.
    pgm.sql(`
    CREATE TEMP TABLE boxel_value_bridge ON COMMIT DROP AS
      SELECT i.realm_url, i.url, i.types, i.search_keys
      FROM boxel_index AS i
      WHERE i.type = 'instance'
        AND (i.is_deleted = FALSE OR i.is_deleted IS NULL)
        AND NOT COALESCE(i.has_error, FALSE)
        AND jsonb_typeof(i.types) = 'array'
        AND NOT EXISTS (
          SELECT 1 FROM prerendered_html AS phe
          WHERE phe.url = i.url AND phe.realm_url = i.realm_url
            AND phe.type = i.type AND phe.error_doc IS NOT NULL
            AND phe.generation >= i.generation)
        AND NOT EXISTS (
          SELECT 1 FROM boxel_index_value_cards AS vc
          JOIN boxel_index_values AS v ON v.card_id = vc.id
          WHERE vc.realm_url = i.realm_url AND vc.url = i.url);
    INSERT INTO boxel_index_value_realms (realm_url)
      SELECT DISTINCT realm_url FROM boxel_value_bridge ORDER BY 1
      ON CONFLICT DO NOTHING;
    INSERT INTO boxel_index_value_types (realm_url, type, types)
      SELECT DISTINCT ON (realm_url, COALESCE(types ->> 0, '')) realm_url, COALESCE(types ->> 0, ''), types
      FROM boxel_value_bridge ORDER BY realm_url, COALESCE(types ->> 0, '')
      ON CONFLICT DO NOTHING;
    INSERT INTO boxel_index_value_cards (realm_url, url)
      SELECT realm_url, url FROM boxel_value_bridge ORDER BY 1, 2
      ON CONFLICT DO NOTHING;
    CREATE TEMP TABLE boxel_value_bridge_rows ON COMMIT DROP AS
      SELECT r.id AS realm_id, t.id AS type_id, v.path, c.id AS card_id, v.kind, v.txt, v.num, v.ts
      FROM boxel_value_bridge AS b
      JOIN boxel_index_value_realms AS r ON r.realm_url = b.realm_url
      JOIN boxel_index_value_cards AS c ON c.realm_url = b.realm_url AND c.url = b.url
      JOIN boxel_index_value_types AS t ON t.realm_url = b.realm_url AND t.type = COALESCE(b.types ->> 0, '')
      CROSS JOIN LATERAL boxel_value_rows(b.search_keys) AS v;
    INSERT INTO boxel_index_value_paths (path)
      SELECT DISTINCT path FROM boxel_value_bridge_rows ORDER BY 1
      ON CONFLICT DO NOTHING;
    INSERT INTO boxel_index_values (realm_id, type_id, path_id, card_id, kind, txt, num, ts)
      SELECT b.realm_id, b.type_id, p.id, b.card_id, b.kind, b.txt, b.num, b.ts
      FROM boxel_value_bridge_rows AS b JOIN boxel_index_value_paths AS p ON p.path = b.path
      ORDER BY 1, 2, 3, 4;
  `);
    pgm.sql(`
    CREATE INDEX IF NOT EXISTS boxel_index_values_txt_idx
      ON boxel_index_values (realm_id, type_id, path_id, txt, card_id) WHERE txt IS NOT NULL;
    CREATE INDEX IF NOT EXISTS boxel_index_values_num_idx
      ON boxel_index_values (realm_id, type_id, path_id, num, card_id) WHERE num IS NOT NULL;
    CREATE INDEX IF NOT EXISTS boxel_index_values_ts_idx
      ON boxel_index_values (realm_id, type_id, path_id, ts, card_id) WHERE ts IS NOT NULL;
    CREATE INDEX IF NOT EXISTS boxel_index_values_marker_idx
      ON boxel_index_values (realm_id, type_id, path_id, card_id) WHERE kind = 'm';
    CREATE INDEX IF NOT EXISTS boxel_index_values_card_idx
      ON boxel_index_values (card_id, path_id);
    ANALYZE boxel_index_values;
    ANALYZE boxel_index_value_cards;
    ANALYZE boxel_index_value_paths;
    ANALYZE boxel_index_value_types;
    ANALYZE boxel_index_value_realms;
  `);
  };

  exports.down = (pgm) => {
    pgm.sql(`
    DROP TABLE IF EXISTS boxel_index_values;
    DROP TABLE IF EXISTS boxel_index_value_cards;
    DROP TABLE IF EXISTS boxel_index_value_paths;
    DROP TABLE IF EXISTS boxel_index_value_types;
    DROP TABLE IF EXISTS boxel_index_value_realms;
    DROP FUNCTION IF EXISTS boxel_value_rows(JSONB);
    DROP FUNCTION IF EXISTS boxel_value_instant(TEXT);
  `);
  };
  return exports;
})();

// ---- 1794480000000_add-boxel-index-values-unplaced-txt-idx.js ----
const step2 = (() => {
  const exports = {};
  // A partial index over the value store's text that the instant index cannot
  // place: text with no instant, or with one but in neither fixed-width form
  // (`YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM` with no zone), such as an offset,
  // seconds or a fraction. The ordered read walks a date or date-time field off
  // the instant index in its one fixed form, and every card the index holds
  // here is a candidate for the page (value-store-order.ts). Keyed by the
  // field, so the candidates of one field are one index range, a few entries
  // for a field whose values are dates, instead of every text value at the
  // path. The query repeats the predicate word for word (`unplacedText`).
  // Postgres only.

  exports.up = (pgm) => {
    pgm.sql(`
    CREATE INDEX IF NOT EXISTS boxel_index_values_unplaced_txt_idx
      ON boxel_index_values (realm_id, type_id, path_id, card_id)
      WHERE txt IS NOT NULL
        AND (ts IS NULL OR txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?$');
    ANALYZE boxel_index_values;
  `);
  };

  exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS boxel_index_values_unplaced_txt_idx`);
  };
  return exports;
})();

const steps = [step1, step2];

exports.up = async (pgm) => {
  for (let step of steps) await step.up(pgm);
};

exports.down = async (pgm) => {
  for (let step of [...steps].reverse()) await step.down(pgm);
};
