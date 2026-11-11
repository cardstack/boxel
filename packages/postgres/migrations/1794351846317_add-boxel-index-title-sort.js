// A title sort an index can read in order. A card's title sorts as
// `spill_text(search_doc -> 'cardTitle')`, an expression no index holds, so
// "A to Z by title" read and sorted every row a realm's query matched,
// detoasting each row's search doc for its title, to keep a page of 25.
// `title_sort` holds the same text as a plain column, written by the index
// writer at promotion (`#restampedColumns` in runtime-common's index-writer),
// and the engine sorts a `cardTitle` sort on it (`handleFieldQuery`), so a
// plain page reads its rows off the index below and stops after the page.
//
// The column is the sort expression's own text: the title as `->>` reads it,
// NULL when the card has none, in the database's default collation (the
// collation the expression sorts in), so every answer is unchanged.
//
// The index serves `asc` (`ASC NULLS LAST`, then `url COLLATE "POSIX"` and
// `type`, the engine's tiebreakers). A backward scan of it is `DESC NULLS
// FIRST` with the tiebreakers reversed, which no title sort asks for, so a
// `desc` title sort still sorts, though over the inline column rather than
// each row's search doc. Almost every title sort is `asc`; a second index
// would cost every write to `boxel_index` for the rare `desc` one.
//
// Additive: a nullable column with no default (no table rewrite). Existing rows
// are backfilled before the index is built, in committed batches walked in
// primary-key order, so no transaction holds row locks across the table and
// the backfill does no index maintenance for the new index. The index is built
// CONCURRENTLY, so it doesn't block writes while it builds. Neither can run
// inside a transaction, hence noTransaction(). An interrupted CONCURRENTLY
// build leaves an INVALID index under the name, which `IF NOT EXISTS` would
// treat as done, so the CREATE follows an unconditional DROP and a retry
// rebuilds it; a retried backfill skips the rows it already set.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS title_sort TEXT`);
  pgm.sql(`
    CREATE OR REPLACE PROCEDURE boxel_index_title_sort_backfill()
      LANGUAGE plpgsql AS $$
      DECLARE
        last_url text;
        last_realm text;
        last_type text;
      BEGIN
        LOOP
          WITH batch AS (
            SELECT url, realm_url, type FROM boxel_index
            WHERE last_url IS NULL
               OR (url, realm_url, type) > (last_url, last_realm, last_type)
            ORDER BY url, realm_url, type
            LIMIT 1000
          ), updated AS (
            UPDATE boxel_index AS b
              SET title_sort = spill_text(b.search_doc -> 'cardTitle')
              FROM batch
              WHERE b.url = batch.url
                AND b.realm_url = batch.realm_url
                AND b.type = batch.type
                AND b.title_sort IS DISTINCT FROM spill_text(b.search_doc -> 'cardTitle')
          )
          SELECT url, realm_url, type INTO last_url, last_realm, last_type
            FROM batch
            ORDER BY url DESC, realm_url DESC, type DESC
            LIMIT 1;
          EXIT WHEN NOT FOUND;
          COMMIT;
        END LOOP;
      END
    $$;
  `);
  pgm.sql(`CALL boxel_index_title_sort_backfill()`);
  pgm.sql(`DROP PROCEDURE boxel_index_title_sort_backfill()`);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_realm_title_sort_index;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_realm_title_sort_index
      ON boxel_index (realm_url, title_sort, url COLLATE "POSIX", type);
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_realm_title_sort_index;`,
  );
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS title_sort`);
};
