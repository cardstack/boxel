// The text-search columns, tables and configuration: title trigrams, passages, the rendered markdown and role-weighted vectors, typo words and pattern text, the rank vector, BM25 term statistics, one text-search configuration, and the generated title sort.
//
// One migration for this structure: the steps below are the migrations it
// was built from, in their order, each kept whole with its own
// notes. Each step's up runs in order and its down in reverse. A step that
// builds an index CONCURRENTLY calls noTransaction(), so the migration runs
// outside one transaction, as those steps did on their own.

exports.shorthands = undefined;

// ---- 1794378772375_add-search-doc-title-trigram-indexes.js ----
const step1 = (() => {
  const exports = {};
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
  return exports;
})();

// ---- 1794378808630_add-boxel-index-passages.js ----
const step2 = (() => {
  const exports = {};
  // Passages: the items of a card's PassageField lists, searchable one by one.
  //
  // A card can hold a long text as a list of passages (a talk's transcript
  // segments, a book's chapters) instead of one card per passage. When an index
  // pass promotes its rows, the index writer copies each passage of every card
  // it touched into this table: one row per (card, field, position), with the
  // passage's start, end and text, and the text's english tsvector. A
  // `matches` filter with `within: '<field>'` asks this table's GIN index which
  // cards have a matching passage, and a search reports the passages that
  // matched (`meta.passages`).
  //
  // `tsv` is computed by the writer's INSERT rather than by an expression index
  // so ranking can read it back.

  exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_index_passages (
      realm_url TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      field_path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      start_at DOUBLE PRECISION,
      end_at DOUBLE PRECISION,
      body TEXT NOT NULL,
      tsv TSVECTOR NOT NULL,
      CONSTRAINT boxel_index_passages_pkey
        PRIMARY KEY (realm_url, url, type, field_path, ordinal)
    );
    CREATE INDEX IF NOT EXISTS boxel_index_passages_tsv_idx
      ON boxel_index_passages USING GIN (tsv);
  `);
    // The search tables' autovacuum settings (see
    // search-tables-vacuum-and-statistics).
    pgm.sql(
      `ALTER TABLE boxel_index_passages SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05);`,
    );
  };

  exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS boxel_index_passages`);
  };
  return exports;
})();

// ---- 1794378861227_add-prerendered-markdown-tsv.js ----
const step3 = (() => {
  const exports = {};
  // Store each rendered card's full-text vector in `prerendered_html.markdown_tsv`
  // so every `matches` search reads it instead of recomputing
  // `to_tsvector('english', markdown_search_text(markdown))` per row.
  //
  // This is the first text-search migration, so it also creates the one
  // configuration family every text vector and query uses. Accents fold:
  // `boxel_english` is the English configuration with `unaccent` in front of
  // the stemmer (field, rank, passage and rendered-markdown vectors), so
  // "creme" finds "Crème". `boxel_simple` is the unstemmed counterpart
  // (type-ahead, and a prefix still being typed). Both need only the
  // `unaccent` extension, which RDS ships.
  //
  // The expression index answers "which rows hold these words", but anything it
  // can't decide from the index alone recomputes that expression: a phrase (the
  // index holds no word positions), a relevance rank, and any plan that probes
  // rows by key and filters them. `markdown_search_text` runs a regex over up to
  // 400 KB of markdown, so on long documents (talk transcripts) each recompute
  // costs ~0.8 ms, and a phrase over a few thousand candidates took seconds.
  // Reading a stored vector is a detoast.
  //
  // The index writer computes the vector as it promotes a pass's staged rows
  // into prerendered_html (`promotePrerenderedHtmlPending`), which is the only
  // path that writes a production row's markdown. prerendered_html is a
  // secondary index the writer owns, so the vector is written on the way in,
  // next to the markdown it comes from; there is no trigger. Staging
  // (`prerendered_html_pending`) doesn't carry it: a search over a pass's staged
  // rows computes it inline.
  //
  // Deploy safety, for a table that can be large in production:
  // - The column is added nullable with no default, a catalog-only change (no
  //   table rewrite, no long lock). `GENERATED ... STORED` would rewrite the
  //   whole table under an exclusive lock.
  // - Existing rows are backfilled in committed batches, so no transaction holds
  //   row locks across the table, and searches find them without a reindex.
  // - The GIN index is built CONCURRENTLY. An interrupted build leaves an invalid
  //   index and an unrecorded migration; rerunning drops it and builds again.
  // - The old expression index stays until the post-deploy removal migration,
  //   because the previous code revision still queries through it during a
  //   rolling deploy.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `ALTER TABLE prerendered_html ADD COLUMN IF NOT EXISTS markdown_tsv tsvector`,
    );
    pgm.sql(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'boxel_english') THEN
        CREATE TEXT SEARCH CONFIGURATION boxel_english (COPY = english);
        ALTER TEXT SEARCH CONFIGURATION boxel_english
          ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'boxel_simple') THEN
        CREATE TEXT SEARCH CONFIGURATION boxel_simple (COPY = simple);
        ALTER TEXT SEARCH CONFIGURATION boxel_simple
          ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;
      END IF;
    END
    $$
  `);
    pgm.sql(`
    CREATE OR REPLACE PROCEDURE prerendered_markdown_tsv_backfill()
      LANGUAGE plpgsql AS $$
      DECLARE
        updated integer;
      BEGIN
        LOOP
          UPDATE prerendered_html AS p
            SET markdown_tsv = to_tsvector('boxel_english', markdown_search_text(p.markdown))
            WHERE (p.url, p.realm_url, p.type) IN (
              SELECT url, realm_url, type FROM prerendered_html
              WHERE markdown_tsv IS NULL AND markdown IS NOT NULL
              LIMIT 500
            );
          GET DIAGNOSTICS updated = ROW_COUNT;
          COMMIT;
          EXIT WHEN updated = 0;
        END LOOP;
      END
    $$;
  `);
    pgm.sql(`CALL prerendered_markdown_tsv_backfill()`);
    pgm.sql(`DROP PROCEDURE prerendered_markdown_tsv_backfill()`);
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_markdown_tsv_idx`,
    );
    pgm.sql(`
    CREATE INDEX CONCURRENTLY prerendered_html_markdown_tsv_idx
      ON prerendered_html USING GIN (markdown_tsv)
  `);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_markdown_tsv_idx`,
    );
    pgm.sql(`ALTER TABLE prerendered_html DROP COLUMN IF EXISTS markdown_tsv`);
    pgm.sql(`DROP TEXT SEARCH CONFIGURATION IF EXISTS boxel_english`);
    pgm.sql(`DROP TEXT SEARCH CONFIGURATION IF EXISTS boxel_simple`);
  };
  return exports;
})();

// ---- 1794378932017_add-boxel-index-search-tsv.js ----
const step4 = (() => {
  const exports = {};
  // Store each card's role-weighted full-text vector in `boxel_index.search_tsv`
  // (docs/search-intent.md).
  //
  // A card author gives a field a search role (`title`, `summary`, `body`, …),
  // and the render groups the card's words by the weight their roles carry: A
  // for titles, names and aliases; B for summaries, keywords and labels; C for
  // plain text; D for body text, notes and code. It stamps the groups into the
  // search doc as `_searchText: { A, B, C, D }`. The index writer builds this
  // column from them as it promotes a pass (`search_text_vector`), and the
  // promoted doc doesn't keep them. Relevance ranks over this vector together
  // with the rendered markdown's, so a word in a title outranks the same word in
  // a transcript, and `matches … in: 'title'` reads its A weight alone.
  //
  // Deploy safety mirrors `add-prerendered-markdown-tsv`: the column is added
  // nullable with no default (a catalog-only change), and the GIN index is
  // built CONCURRENTLY. There is no backfill: a row gains its vector the next
  // time it is indexed, and until then ranks by its markdown alone, as every row
  // did before.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_tsv tsvector`,
    );
    pgm.sql(`
    CREATE OR REPLACE FUNCTION search_text_vector(t JSONB) RETURNS tsvector
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'A', ''), 10000)), 'A') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'B', ''), 40000)), 'B') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'C', ''), 200000)), 'C') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'D', ''), 200000)), 'D')
      $$
  `);
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_search_tsv_idx`);
    pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_search_tsv_idx
      ON boxel_index USING GIN (search_tsv)
  `);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_search_tsv_idx`);
    pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_tsv`);
    pgm.sql(`DROP FUNCTION IF EXISTS search_text_vector(JSONB)`);
  };
  return exports;
})();

// ---- 1794378946683_add-typo-words-and-pattern-text.js ----
const step5 = (() => {
  const exports = {};
  // What `typos` and `patterns` search (docs/search-intent.md) read, on stock
  // Postgres with pg_trgm (added by `add-search-doc-title-trigram-indexes`).
  //
  // `boxel_index_words` is each realm's word list: the words of every field
  // declared `typos: true`, lowercased, three letters or more. A
  // `matches … typos: true` term looks up the listed words closest to each of
  // its words (trigram similarity, through the GIN index) and matches any of
  // them, so "kleppman" finds "Kleppmann". The index writer adds a pass's words
  // as it promotes the pass; a word that no card holds any more stays listed and
  // matches nothing.
  //
  // `boxel_index.pattern_text` holds the values of a card's pattern fields
  // (declared `patterns: true`, or an `identifier` or `code` role), one per
  // line, trigram-indexed so a glob or regex filter narrows to the rows that
  // can match before it checks the field itself.
  //
  // Both are additive: the column is nullable with no default, the indexes are
  // built CONCURRENTLY, and a row gains its values the next time it is indexed.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_index_words (
      realm_url TEXT NOT NULL,
      word TEXT NOT NULL,
      CONSTRAINT boxel_index_words_pkey PRIMARY KEY (realm_url, word)
    )
  `);
    // The search tables' autovacuum settings (see
    // search-tables-vacuum-and-statistics).
    pgm.sql(
      `ALTER TABLE boxel_index_words SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05);`,
    );
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_words_trgm_idx`);
    pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_words_trgm_idx
      ON boxel_index_words USING GIN (word gin_trgm_ops)
  `);
    pgm.sql(
      `ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS pattern_text TEXT`,
    );
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_pattern_text_idx`);
    pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_pattern_text_idx
      ON boxel_index USING GIN (pattern_text gin_trgm_ops)
  `);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_pattern_text_idx`);
    pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS pattern_text`);
    pgm.sql(`DROP TABLE IF EXISTS boxel_index_words`);
  };
  return exports;
})();

// ---- 1794378976722_add-boxel-index-rank-vector.js ----
const step6 = (() => {
  const exports = {};
  // A small, inline ranking vector and title for every row, so ranking stays
  // fast whatever a realm's cards hold (docs/search-intent.md).
  //
  // `search_tsv` holds every field word a card has, which makes it a good
  // match vector but an expensive rank vector: a card with a long body field
  // carries a vector of hundreds of kilobytes, stored out of line, and ranking
  // thousands of matches reads every one of them. `rank_tsv` holds the words
  // that decide relevance (titles, names and aliases; summaries, keywords and
  // labels; and only the start of plain and body text) capped so it stays
  // inline in the row (under the ~2 KB at which Postgres moves a value out of
  // line). Ranking reads it alone; matching still reads the full vectors.
  //
  // `search_title` is the row's display title, lowercased, also inline: type-
  // ahead ranks a title that equals or starts with what was typed above other
  // matches, without reading the search doc.
  //
  // Additive: nullable columns with no default. Existing rows are backfilled in
  // committed batches, so no transaction holds row locks across the table: the
  // title from the stored doc, and the rank vector from the row's match vector
  // (`search_tsv`) when that is small enough to stay inline, else its title and
  // summary tiers alone (`ts_filter` A and B), which always are. A row the next
  // index pass reaches gets the full rank vector; a row with no match vector
  // yet (indexed before search intent) ranks lowest until it is reindexed.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS rank_tsv tsvector`,
    );
    pgm.sql(
      `ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_title TEXT`,
    );
    pgm.sql(`
    CREATE OR REPLACE FUNCTION search_rank_vector(t JSONB) RETURNS tsvector
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'A', ''), 400)), 'A') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'B', ''), 600)), 'B') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'C', ''), 600)), 'C') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'D', ''), 400)), 'D')
      $$
  `);
    pgm.sql(`
    CREATE OR REPLACE PROCEDURE boxel_index_rank_vector_backfill()
      LANGUAGE plpgsql AS $$
      DECLARE
        updated integer;
      BEGIN
        LOOP
          UPDATE boxel_index AS b
            SET rank_tsv = COALESCE(
                  b.rank_tsv,
                  CASE
                    WHEN b.search_tsv IS NULL THEN NULL
                    WHEN pg_column_size(b.search_tsv) <= 1800 THEN b.search_tsv
                    ELSE ts_filter(b.search_tsv, '{a,b}')
                  END
                ),
                search_title = COALESCE(
                  b.search_title,
                  lower(b.search_doc ->> '_title')
                )
            WHERE (b.url, b.realm_url, b.type) IN (
              SELECT url, realm_url, type FROM boxel_index
              WHERE (rank_tsv IS NULL AND search_tsv IS NOT NULL)
                 -- A null _title would stay NULL after the update and be
                 -- selected again forever, so only a real title counts.
                 OR (search_title IS NULL AND search_doc ->> '_title' IS NOT NULL)
              LIMIT 500
            );
          GET DIAGNOSTICS updated = ROW_COUNT;
          COMMIT;
          EXIT WHEN updated = 0;
        END LOOP;
      END
    $$;
  `);
    pgm.sql(`CALL boxel_index_rank_vector_backfill()`);
    pgm.sql(`DROP PROCEDURE boxel_index_rank_vector_backfill()`);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS rank_tsv`);
    pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_title`);
    pgm.sql(`DROP FUNCTION IF EXISTS search_rank_vector(JSONB)`);
  };
  return exports;
})();

// ---- 1794379023914_add-bm25-term-stats.js ----
const step7 = (() => {
  const exports = {};
  // Removed again: 1795300002000_drop-word-statistics drops both tables this
  // step creates, and no search reads them. The step stays so the history
  // replays in order. What it was for:
  //
  // Word statistics for text relevance, in plain SQL on stock Postgres
  // (docs/search.md). A card type that declares `searchDefaults.wordStatistics`
  // ranks its `matches` by each query word's inverse document frequency times
  // Postgres's own `ts_rank` of the word in the row's rank vector, so rare words
  // count more, repetition saturates, title words outweigh body words and long
  // rows are normalized.
  //
  // - `boxel_term_stats`: each realm's lexemes and how many rows hold each (df).
  // - `boxel_realm_text_stats`: each realm's row count and when the statistics
  //   were rebuilt. The engine rebuilds them in the background, under an
  //   advisory lock, when a search on an opted-in type finds them missing or
  //   older than a few minutes; never inside an index commit.
  //
  // The vectors and the engine's queries use `boxel_english`, the accent-folding
  // configuration migration 1794378861227 creates. Additive: two new tables.

  exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_term_stats (
      realm_url TEXT NOT NULL,
      lexeme TEXT NOT NULL,
      df INTEGER NOT NULL,
      PRIMARY KEY (realm_url, lexeme)
    )
  `);
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_realm_text_stats (
      realm_url TEXT PRIMARY KEY,
      doc_count INTEGER NOT NULL,
      rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  };

  exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS boxel_term_stats`);
    pgm.sql(`DROP TABLE IF EXISTS boxel_realm_text_stats`);
  };
  return exports;
})();

// ---- 1794379052401_one-text-search-config.js ----
const step8 = (() => {
  const exports = {};
  // Type-ahead folds accents too. Every text vector and every query uses the
  // `unaccent` configuration family (migration 1794378861227): `boxel_english`
  // where words are stemmed and `boxel_simple` where they are not (type-ahead,
  // and a prefix still being typed). This gives type-ahead a GIN index on the
  // `boxel_simple` vector the engine queries.
  //
  // Built CONCURRENTLY, so it needs noTransaction.

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
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_type_ahead_folded_idx;`,
    );
  };
  return exports;
})();

// ---- 1794379316236_add-boxel-index-title-sort.js ----
const step9 = (() => {
  const exports = {};
  // A title sort an index can read in order. A card's title sorts as
  // `search_doc ->> 'cardTitle'`, an expression no index holds, so
  // "A to Z by title" read and sorted every row a realm's query matched,
  // detoasting each row's search doc for its title, to keep a page of 25.
  // `title_sort` holds the same text as a column Postgres generates from the
  // search doc on every write, and the engine sorts a `cardTitle` sort on it
  // (`handleFieldQuery`), so a plain page reads its rows off the index below
  // and stops after the page, and a sort that can't use the index reads the
  // small inline column rather than each row's search doc.
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
  // Adding a stored generated column rewrites `boxel_index` under an exclusive
  // lock. Nothing released has this column yet, so only a database that
  // already ran this stack pays it. The index is built CONCURRENTLY, so it
  // doesn't block writes while it builds, which can't run inside a
  // transaction, hence noTransaction(). An interrupted CONCURRENTLY build
  // leaves an INVALID index under the name, which `IF NOT EXISTS` would treat
  // as done, so the CREATE follows an unconditional DROP and a retry rebuilds
  // it.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(`
    ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS title_sort TEXT
      GENERATED ALWAYS AS (search_doc ->> 'cardTitle') STORED
  `);
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
  return exports;
})();

const steps = [step1, step2, step3, step4, step5, step6, step7, step8, step9];

exports.up = async (pgm) => {
  for (let step of steps) await step.up(pgm);
};

exports.down = async (pgm) => {
  for (let step of [...steps].reverse()) await step.down(pgm);
};
