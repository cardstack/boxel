// The search_keys column (an ordinary column, filled from the search doc
// when a row is staged) and its index.
//
// One migration for this structure: the steps below are the migrations it
// was built from, in their order, each kept whole with its own
// notes. Each step's up runs in order and its down in reverse. A step that
// builds an index CONCURRENTLY calls noTransaction(), so the migration runs
// outside one transaction, as those steps did on their own.

exports.shorthands = undefined;

// ---- 1794379520000_add-boxel-index-search-keys.js ----
// A database whose boxel_index holds the generated search_keys keeps its
// values and its table: DROP EXPRESSION changes the catalog only. Exported
// so a test runs exactly what the migration runs.
const SEARCH_KEYS_TO_ORDINARY_COLUMN = `
    DO $$
    BEGIN
      IF (SELECT attgenerated FROM pg_attribute
            WHERE attrelid = 'boxel_index'::regclass AND attname = 'search_keys') = 's' THEN
        ALTER TABLE boxel_index ALTER COLUMN search_keys DROP EXPRESSION;
      END IF;
    END
    $$;
`;
exports.SEARCH_KEYS_TO_ORDINARY_COLUMN = SEARCH_KEYS_TO_ORDINARY_COLUMN;

const step1 = (() => {
  const exports = {};
  // A narrow copy of each row's search doc that a sort, a filter or a list test
  // reads instead of the doc. A card's search doc is large (a video app's card
  // averages 23 KB and is stored out of line, compressed), and a read of one of
  // its fields (`search_doc -> … ->> 'f'`, or `jsonb_tree(search_doc, …)` for a
  // list) detoasts the whole doc for every row the query matched, once for each
  // time the statement names it. A sort by a number field over 6,300 cards read and
  // decompressed every one of their docs three times to keep a page of 72.
  //
  // `search_keys` is the doc projected (`search_keys_project`): objects are
  // kept, their members projected the same way; every number, boolean and null
  // is kept, and so is a string of at most 256 bytes and a list whose JSON is at
  // most 512 bytes (as it is, elements and all). Every other value, a longer
  // string or a longer list, is the marker object `{"$doc": true}`. Then a
  // budget (`search_keys_of`), a hard one: while the projection's JSON is over
  // 3,000 bytes, the largest kept string or list is marked (largest first, ties
  // by path in byte order), except the framework's own top-level fields every
  // card has (`id`, `cardTitle`, `_title`, `_cardType`, `_isCardInstanceFile`),
  // which are read most (ids in policy filters, `in` lists and links); then, if
  // it is still over, the largest object; and if even that leaves it over, the
  // whole projection is the marker. 3,000 bytes keeps 94-96% of the bench's
  // scalar reads hot (1,800 kept 85-93%; 3,600 no more than 3,000 but on
  // a 12,000-product shop's largest docs).
  //
  // Its storage is PLAIN: never compressed and never moved out of line, so a
  // read of it is a read of the row. Under MAIN it was compressed in the row
  // when the row was wide, and every reference to it decompressed it again: on
  // a 12,000-product shop the hot reads cost more than the doc reads they
  // replaced. Every other column of `boxel_index` that can be large is
  // TOASTable, so a row holds this column (at most 3.3 KB as stored on the
  // bench), the fixed-size columns and an 18-byte pointer for each of the
  // others: under 4 KB, inside a page. It makes `boxel_index` itself about a
  // third larger (458 MB to 627 MB on the bench), outside the TOAST tables. Both functions are IMMUTABLE; a trigger fills the column from
  // the search doc whenever a statement writes the doc without it, so it never
  // disagrees with it (see the trigger below).
  //
  // The engine reads a path from it and falls back to the search doc wherever
  // the projection holds the marker at the path or above it, or an object at
  // the path (an object the doc holds, whose members may have been marked).
  // Anything else there is the doc's own value at that path, so the read is the
  // doc's (dialect.ts, `hotDoc`).
  //
  // The same rewrite keeps the small columns searches read on every row in the
  // row (STORAGE MAIN, set first, so the rewrite places every row by it): the
  // type keys, the row's key columns, the title columns, the pattern text and
  // the ranking vector. On a wide row Postgres's toaster otherwise moved every
  // movable column out of line to reach its 2 KB target, down to the smallest:
  // one row's `types` (about 160 bytes) read 35 buffers instead of 5, and every
  // type filter rechecks it per match. With these MAIN, the EXTENDED columns
  // move out first and these stay. None of them names an app's field.
  //
  // Adding the column changes the catalog only; filling it (the UPDATE below)
  // writes every row of `boxel_index` once. Nothing released has this column
  // yet, so only a database that already ran this stack pays it.

  const HOT_COLUMNS = [
    'types',
    'url',
    'file_alias',
    'realm_url',
    'type',
    'title_sort',
    'search_title',
    'pattern_text',
    'rank_tsv',
  ];

  exports.up = (pgm) => {
    pgm.sql(`
    CREATE OR REPLACE FUNCTION search_keys_project(doc JSONB) RETURNS JSONB
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT CASE WHEN jsonb_typeof(doc) = 'object' THEN COALESCE((
        SELECT jsonb_object_agg(e.key, CASE jsonb_typeof(e.value)
          WHEN 'object' THEN search_keys_project(e.value)
          WHEN 'array' THEN CASE
            WHEN octet_length(e.value::text) > 512 THEN '{"$doc": true}'::jsonb
            ELSE e.value END
          WHEN 'string' THEN CASE
            WHEN octet_length(e.value #>> '{}') > 256 THEN '{"$doc": true}'::jsonb
            ELSE e.value END
          ELSE e.value END)
        FROM jsonb_each(doc) AS e), '{}'::jsonb) END
    $$
  `);
    pgm.sql(`
    CREATE OR REPLACE FUNCTION search_keys_of(doc JSONB) RETURNS JSONB
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
    DECLARE
      result JSONB := search_keys_project(doc);
      size INT := octet_length(result::text);
      candidate RECORD;
    BEGIN
      IF result IS NULL OR size <= 3000 THEN
        RETURN result;
      END IF;
      FOR candidate IN
        WITH RECURSIVE kept(path, value) AS (
          SELECT ARRAY[e.key], e.value FROM jsonb_each(result) AS e
          UNION ALL
          SELECT k.path || e.key, e.value FROM kept AS k, jsonb_each(k.value) AS e
          WHERE jsonb_typeof(k.value) = 'object'
        )
        SELECT path, octet_length(value::text) AS bytes FROM kept
        WHERE jsonb_typeof(value) IN ('string', 'array')
          AND octet_length(value::text) > 14
          AND NOT (
            array_length(path, 1) = 1
            AND path[1] IN ('id', 'cardTitle', '_title', '_cardType', '_isCardInstanceFile')
          )
        ORDER BY bytes DESC, path::text COLLATE "C"
      LOOP
        EXIT WHEN size <= 3000;
        -- '{"$doc": true}' is 14 bytes of JSON in place of the value's.
        result := jsonb_set(result, candidate.path, '{"$doc": true}'::jsonb);
        size := size - candidate.bytes + 14;
      END LOOP;
      -- Still over (many short values): whole objects, largest first. An
      -- object's members come after it (they are smaller), and one whose
      -- object is already marked is no longer there to mark.
      FOR candidate IN
        WITH RECURSIVE kept(path, value) AS (
          SELECT ARRAY[e.key], e.value FROM jsonb_each(result) AS e
          UNION ALL
          SELECT k.path || e.key, e.value FROM kept AS k, jsonb_each(k.value) AS e
          WHERE jsonb_typeof(k.value) = 'object'
        )
        SELECT path, octet_length(value::text) AS bytes FROM kept
        WHERE jsonb_typeof(value) = 'object'
          AND value <> '{"$doc": true}'::jsonb
          AND octet_length(value::text) > 14
        ORDER BY bytes DESC, path::text COLLATE "C"
      LOOP
        EXIT WHEN size <= 3000;
        CONTINUE WHEN result #> candidate.path IS NULL;
        result := jsonb_set(result, candidate.path, '{"$doc": true}'::jsonb);
        size := size - candidate.bytes + 14;
      END LOOP;
      -- Still over (many short values at the top): the whole doc.
      IF size > 3000 THEN
        RETURN '{"$doc": true}'::jsonb;
      END IF;
      RETURN result;
    END
    $$
  `);
    pgm.sql(
      `ALTER TABLE boxel_index ${HOT_COLUMNS.map((c) => `ALTER COLUMN ${c} SET STORAGE MAIN`).join(', ')}`,
    );
    // `search_keys` is an ordinary column, computed when a row is staged: a
    // generated column was computed in the promotion that holds the realm's
    // commit lock (12.3 s of a 28.9 s promotion at 36k cards). A trigger on
    // each table fills it from `search_keys_of(search_doc)` whenever a
    // statement writes `search_doc` without it; on `boxel_index_pending`
    // that is every staged row, outside the lock, and promotion copies it.
    // A database that holds the generated column keeps its values: DROP
    // EXPRESSION changes the catalog only.
    pgm.sql(`
    ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_keys JSONB
      STORAGE PLAIN;
    ${SEARCH_KEYS_TO_ORDINARY_COLUMN}
    UPDATE boxel_index SET search_keys = search_keys_of(search_doc)
      WHERE search_keys IS NULL AND search_doc IS NOT NULL;
    ALTER TABLE boxel_index_pending ADD COLUMN IF NOT EXISTS search_keys JSONB
      STORAGE PLAIN;
    CREATE OR REPLACE FUNCTION boxel_index_fill_search_keys() RETURNS trigger
      LANGUAGE plpgsql AS $$
    BEGIN
      -- Filled when the statement left it out: on an INSERT that is NULL; on
      -- an UPDATE that wrote search_doc without it, the row's old value
      -- carried over. search_keys is compared first, so a row whose
      -- projection the statement replaced reads no doc.
      IF NEW.search_keys IS NULL
         OR (TG_OP = 'UPDATE'
             AND NEW.search_keys IS NOT DISTINCT FROM OLD.search_keys
             AND NEW.search_doc IS DISTINCT FROM OLD.search_doc) THEN
        NEW.search_keys := search_keys_of(NEW.search_doc);
      END IF;
      RETURN NEW;
    END
    $$;
    DROP TRIGGER IF EXISTS boxel_index_fill_search_keys ON boxel_index;
    CREATE TRIGGER boxel_index_fill_search_keys
      BEFORE INSERT OR UPDATE OF search_doc ON boxel_index
      FOR EACH ROW EXECUTE FUNCTION boxel_index_fill_search_keys();
    DROP TRIGGER IF EXISTS boxel_index_pending_fill_search_keys ON boxel_index_pending;
    CREATE TRIGGER boxel_index_pending_fill_search_keys
      BEFORE INSERT OR UPDATE OF search_doc ON boxel_index_pending
      FOR EACH ROW EXECUTE FUNCTION boxel_index_fill_search_keys();
  `);
  };

  exports.down = (pgm) => {
    pgm.sql(`DROP TRIGGER IF EXISTS boxel_index_fill_search_keys ON boxel_index`);
    pgm.sql(
      `DROP TRIGGER IF EXISTS boxel_index_pending_fill_search_keys ON boxel_index_pending`,
    );
    pgm.sql(`DROP FUNCTION IF EXISTS boxel_index_fill_search_keys()`);
    pgm.sql(`ALTER TABLE boxel_index_pending DROP COLUMN IF EXISTS search_keys`);
    pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_keys`);
    pgm.sql(
      `ALTER TABLE boxel_index ${HOT_COLUMNS.map((c) => `ALTER COLUMN ${c} SET STORAGE EXTENDED`).join(', ')}`,
    );
    pgm.sql(`DROP FUNCTION IF EXISTS search_keys_of(JSONB)`);
    pgm.sql(`DROP FUNCTION IF EXISTS search_keys_project(JSONB)`);
  };
  return exports;
})();

// ---- 1794379540000_index-boxel-index-search-keys.js ----
const step2 = (() => {
  const exports = {};
  // The index the search's containment and jsonpath tests of a field run on:
  // a GIN (jsonb_path_ops) over `search_keys`, the hot projection of the search
  // doc (add-boxel-index-search-keys). The compiler tests `search_keys` and
  // reads the doc only for a row whose projection holds the `$doc` marker at
  // or above the tested path (dialect.ts, `hotIndexedTest`). With the test on
  // `search_doc`, its GIN (jsonb_ops) returned every row holding the key and
  // the value anywhere, and the recheck detoasted each one's whole doc: a video app's
  // shelf rechecked 6,105 cards' docs for 690 matches. On
  // `search_keys`, the path-and-value hash narrows to the matches, and their
  // recheck reads the inline projection. It names no app's field.
  //
  // `search_keys_of` now makes a doc that is not an object (none is, but the
  // column allows one) the marker, so a test of such a row falls to its doc,
  // and the rows holding one are written again so their projection is
  // regenerated.
  //
  // CREATE INDEX CONCURRENTLY doesn't block writes while it builds, and can't
  // run inside a transaction, hence noTransaction(). An interrupted build leaves
  // an INVALID index under the name, which `IF NOT EXISTS` would take as done,
  // so the CREATE follows an unconditional DROP and a retry rebuilds it. On the
  // bench (292,000 rows) it builds in about 4 s and is 139 MB.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`
    CREATE OR REPLACE FUNCTION search_keys_of(doc JSONB) RETURNS JSONB
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
    DECLARE
      result JSONB := search_keys_project(doc);
      size INT := octet_length(result::text);
      candidate RECORD;
    BEGIN
      -- A doc that is not an object (none is, today) is the marker: every
      -- read of it is the doc's, and every test of it the doc's.
      IF doc IS NOT NULL AND jsonb_typeof(doc) <> 'object' THEN
        RETURN '{"$doc": true}'::jsonb;
      END IF;
      IF result IS NULL OR size <= 3000 THEN
        RETURN result;
      END IF;
      FOR candidate IN
        WITH RECURSIVE kept(path, value) AS (
          SELECT ARRAY[e.key], e.value FROM jsonb_each(result) AS e
          UNION ALL
          SELECT k.path || e.key, e.value FROM kept AS k, jsonb_each(k.value) AS e
          WHERE jsonb_typeof(k.value) = 'object'
        )
        SELECT path, octet_length(value::text) AS bytes FROM kept
        WHERE jsonb_typeof(value) IN ('string', 'array')
          AND octet_length(value::text) > 14
          AND NOT (
            array_length(path, 1) = 1
            AND path[1] IN ('id', 'cardTitle', '_title', '_cardType', '_isCardInstanceFile')
          )
        ORDER BY bytes DESC, path::text COLLATE "C"
      LOOP
        EXIT WHEN size <= 3000;
        -- '{"$doc": true}' is 14 bytes of JSON in place of the value's.
        result := jsonb_set(result, candidate.path, '{"$doc": true}'::jsonb);
        size := size - candidate.bytes + 14;
      END LOOP;
      -- Still over (many short values): whole objects, largest first. An
      -- object's members come after it (they are smaller), and one whose
      -- object is already marked is no longer there to mark.
      FOR candidate IN
        WITH RECURSIVE kept(path, value) AS (
          SELECT ARRAY[e.key], e.value FROM jsonb_each(result) AS e
          UNION ALL
          SELECT k.path || e.key, e.value FROM kept AS k, jsonb_each(k.value) AS e
          WHERE jsonb_typeof(k.value) = 'object'
        )
        SELECT path, octet_length(value::text) AS bytes FROM kept
        WHERE jsonb_typeof(value) = 'object'
          AND value <> '{"$doc": true}'::jsonb
          AND octet_length(value::text) > 14
        ORDER BY bytes DESC, path::text COLLATE "C"
      LOOP
        EXIT WHEN size <= 3000;
        CONTINUE WHEN result #> candidate.path IS NULL;
        result := jsonb_set(result, candidate.path, '{"$doc": true}'::jsonb);
        size := size - candidate.bytes + 14;
      END LOOP;
      -- Still over (many short values at the top): the whole doc.
      IF size > 3000 THEN
        RETURN '{"$doc": true}'::jsonb;
      END IF;
      RETURN result;
    END
    $$
  `);
    pgm.sql(`
    UPDATE boxel_index SET search_doc = search_doc
     WHERE search_doc IS NOT NULL AND jsonb_typeof(search_doc) <> 'object'
  `);
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_search_keys_idx`);
    pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_search_keys_idx
      ON boxel_index USING gin (search_keys jsonb_path_ops)
  `);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_search_keys_idx`);
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
