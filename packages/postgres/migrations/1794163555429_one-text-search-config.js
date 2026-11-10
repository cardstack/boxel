// One text-search configuration family everywhere. Every text vector and every
// query folds accents with `unaccent` (migration 1794163494426): `boxel_english`
// where words are stemmed (field, rank, passage and rendered-markdown vectors)
// and `boxel_simple` where they are not (type-ahead, and a prefix still being
// typed). Before this, rendered markdown and type-ahead used Postgres's plain
// `english` and `simple`, so "creme" found "Crème" in a card's fields but not
// in its rendered page or its type-ahead.
//
// - Type-ahead gets a GIN index on the `boxel_simple` vector the engine now
//   queries. The old `simple` index stays until the post-deploy removal
//   migration, because the previous code revision still queries it.
// - Stored vectors built under the old configurations are folded in place:
//   each non-ASCII lexeme is unaccented and stemmed again, keeping its
//   positions and weights. A row's field and rank vectors can't be rebuilt
//   from scratch, because the search doc no longer holds the text they came
//   from. Folding a fresh `english` vector this way gives exactly the
//   `boxel_english` one for 1,986 of 2,000 rendered pages sampled (28 of
//   187,387 lexemes differ), and the next index pass replaces it anyway.
//   Only vectors holding a non-ASCII lexeme are touched, in committed batches
//   walked by primary key, so no transaction holds row locks across the
//   table.
//
// Built CONCURRENTLY and batched, so it needs noTransaction.

exports.up = (pgm) => {
  pgm.noTransaction();
  // An interrupted CONCURRENTLY build leaves an INVALID index that `IF NOT
  // EXISTS` would treat as done, so the build follows a DROP and a retry
  // rebuilds it. Separate statements: CONCURRENTLY can't share one.
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_type_ahead_folded_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_type_ahead_folded_idx
      ON boxel_index
      USING GIN (to_tsvector('boxel_simple', coalesce(search_doc ->> '_typeahead', '')));
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION boxel_fold_tsvector(v tsvector) RETURNS tsvector
      LANGUAGE sql STABLE STRICT AS $$
        SELECT coalesce(string_agg(
          '''' || replace(replace(f.lexeme, '\\', '\\\\'), '''', '''''') || '''' ||
          CASE WHEN u.positions IS NULL THEN '' ELSE ':' ||
            (SELECT string_agg(x.p::text || x.w::text, ',')
               FROM unnest(u.positions, u.weights) AS x(p, w)) END,
          ' '), '')::tsvector
        FROM unnest(v) AS u,
          LATERAL (SELECT CASE WHEN u.lexeme ~ '[^[:ascii:]]'
            THEN coalesce((ts_lexize('english_stem', unaccent(u.lexeme)))[1], unaccent(u.lexeme))
            ELSE u.lexeme END AS lexeme) AS f
        -- A word made only of combining marks folds to nothing, and
        -- boxel_english indexes nothing for it either.
        WHERE f.lexeme <> ''
      $$
  `);
  // One procedure per table, each walking the primary key 500 rows at a time
  // and committing after each batch.
  for (let [name, table, set, where] of [
    [
      'boxel_fold_markdown_vectors',
      'prerendered_html',
      `markdown_tsv = boxel_fold_tsvector(t.markdown_tsv)`,
      `t.markdown_tsv::text ~ '[^[:ascii:]]'`,
    ],
    [
      'boxel_fold_field_vectors',
      'boxel_index',
      `search_tsv = boxel_fold_tsvector(t.search_tsv),
       rank_tsv = boxel_fold_tsvector(t.rank_tsv)`,
      `(t.search_tsv::text ~ '[^[:ascii:]]' OR t.rank_tsv::text ~ '[^[:ascii:]]')`,
    ],
  ]) {
    pgm.sql(`
      CREATE OR REPLACE PROCEDURE ${name}()
        LANGUAGE plpgsql AS $$
        DECLARE
          lu varchar := ''; lr varchar := ''; lt varchar := '';
          nu varchar; nr varchar; nt varchar;
        BEGIN
          LOOP
            SELECT b.url, b.realm_url, b.type INTO nu, nr, nt FROM (
              SELECT url, realm_url, type FROM ${table}
              WHERE (url, realm_url, type) > (lu, lr, lt)
              ORDER BY url, realm_url, type
              LIMIT 500
            ) AS b ORDER BY b.url DESC, b.realm_url DESC, b.type DESC LIMIT 1;
            EXIT WHEN nu IS NULL;
            UPDATE ${table} AS t SET ${set}
              WHERE (t.url, t.realm_url, t.type) > (lu, lr, lt)
                AND (t.url, t.realm_url, t.type) <= (nu, nr, nt)
                AND ${where};
            lu := nu; lr := nr; lt := nt;
            COMMIT;
          END LOOP;
        END
      $$;
    `);
    pgm.sql(`CALL ${name}()`);
    pgm.sql(`DROP PROCEDURE ${name}()`);
  }
  pgm.sql(`DROP FUNCTION boxel_fold_tsvector(tsvector)`);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_type_ahead_folded_idx;`,
  );
};
