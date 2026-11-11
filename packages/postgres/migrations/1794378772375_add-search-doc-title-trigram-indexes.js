// Trigram indexes for substring matches on a row's title.
//
// The search sheet matches its term with `contains` on `_title` and
// `cardTitle`, which compile to `search_doc ->> '<key>' ILIKE '%term%'`. No
// index answered that, so each search read every row of the realm and, for
// each one, its whole search doc: a doc that carries a transcript or other long
// text is stored out of line and has to be fetched and decompressed just to
// read the title. On a realm of ~45k cards that took 2.5–5 s per keystroke.
//
// A GIN trigram index on each title expression answers `ILIKE '%term%'` for
// terms of three or more characters, reading only the rows whose titles match.
// The query engine pairs it with the markdown full-text index by compiling the
// sheet's `matches` OR `_title` OR `cardTitle` filter as one UNION of the
// three index lookups (see `#anyAsIndexedUnion`).
//
// pg_trgm is a standard contrib extension and trusted since Postgres 13, so
// the database owner can create it without superuser. Built CONCURRENTLY so
// live index writers aren't blocked, which needs noTransaction.

const TITLE_KEYS = [
  ['_title', 'boxel_index_title_trgm_idx'],
  ['cardTitle', 'boxel_index_card_title_trgm_idx'],
];

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  for (let [key, name] of TITLE_KEYS) {
    // An interrupted CONCURRENTLY build leaves an INVALID index that `IF NOT
    // EXISTS` would treat as done, so the build follows a DROP and a retry
    // rebuilds it. Separate statements: CONCURRENTLY can't share one.
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`);
    pgm.sql(`
      CREATE INDEX CONCURRENTLY ${name}
        ON boxel_index
        USING GIN ((search_doc ->> '${key}') gin_trgm_ops);
    `);
  }
};

exports.down = (pgm) => {
  pgm.noTransaction();
  for (let [, name] of TITLE_KEYS) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`);
  }
};
