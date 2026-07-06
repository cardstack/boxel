exports.shorthands = undefined;

// The `prerendered_html` / `prerendered_html_working` pair holds a card's
// prerendered HTML on its own channel, separate from the search-doc index in
// `boxel_index`. It mirrors the `boxel_index` / `boxel_index_working` split:
// writers stage rows in the working table and the completed batch swaps them
// into the production table in one transaction, with the same
// (url, realm_url, type) key and tombstone (`is_deleted`) semantics.
//
// One row per (url, realm_url, type), one column per HTML format. `icon_html`
// intentionally stays on `boxel_index` — the icon renders in the index visit,
// not the prerender-html visit. `generation` correlates a rendering with the
// index data it belongs to: a row's HTML is fresh when
// `prerendered_html.generation == boxel_index.generation`.
//
// This migration also backfills every existing rendering out of `boxel_index`
// so the new tables read as fully populated (and fresh) from the start; the
// index writer dual-writes going forward. No read path consults these tables
// yet.

const HTML_COLUMNS = {
  url: { type: 'varchar', notNull: true },
  file_alias: { type: 'varchar', notNull: true },
  realm_url: { type: 'varchar', notNull: true },
  type: { type: 'varchar', notNull: true },
  // fitted/embedded are JSONB keyed by render type; the rest are single strings
  fitted_html: 'jsonb',
  embedded_html: 'jsonb',
  atom_html: 'varchar',
  head_html: 'varchar',
  isolated_html: 'varchar',
  // The full-text `matches` predicate and its GIN index read this column.
  markdown: 'text',
  // Deps carry the scoped-CSS URLs needed to serve the HTML.
  // `last_known_good_deps` is the fallback preserved through error cycles.
  deps: 'jsonb',
  last_known_good_deps: 'jsonb',
  generation: { type: 'integer', notNull: true },
  is_deleted: 'boolean',
  // A render error rides here (an index error rides on `boxel_index`); the
  // effective error of an instance is the union of the two.
  error_doc: 'jsonb',
  // Wall-clock (unix ms) the HTML was produced. pg represents bigints as
  // strings in JS.
  rendered_at: 'bigint',
};

exports.up = (pgm) => {
  pgm.createTable('prerendered_html', HTML_COLUMNS);
  pgm.createTable('prerendered_html_working', {
    ...HTML_COLUMNS,
    // Originating worker job id, stamped on every working-table write so the
    // prerender job can find (and skip) URLs a previous attempt processed.
    // Only on the working table, matching `boxel_index_working`.
    job_id: { type: 'integer' },
  });
  // The working table is transient staging, rebuilt each batch — skip WAL like
  // `boxel_index_working`.
  pgm.sql('ALTER TABLE prerendered_html_working SET UNLOGGED');

  pgm.addConstraint('prerendered_html', 'prerendered_html_pkey', {
    primaryKey: ['url', 'realm_url', 'type'],
  });
  pgm.addConstraint(
    'prerendered_html_working',
    'prerendered_html_working_pkey',
    {
      primaryKey: ['url', 'realm_url', 'type'],
    },
  );

  // Backfill from the fused index. Seed each row's `generation` and
  // `rendered_at` from its source row so every backfilled rendering reads as
  // fresh (its generation equals the matching `boxel_index` row's generation).
  pgm.sql(`
    INSERT INTO prerendered_html (
      url, file_alias, realm_url, type,
      fitted_html, embedded_html, atom_html, head_html, isolated_html,
      markdown, deps, last_known_good_deps,
      generation, is_deleted, error_doc, rendered_at
    )
    SELECT
      url, file_alias, realm_url, type,
      fitted_html, embedded_html, atom_html, head_html, isolated_html,
      markdown, deps, last_known_good_deps,
      generation, is_deleted, error_doc, indexed_at
    FROM boxel_index
  `);
  pgm.sql(`
    INSERT INTO prerendered_html_working (
      url, file_alias, realm_url, type,
      fitted_html, embedded_html, atom_html, head_html, isolated_html,
      markdown, deps, last_known_good_deps,
      generation, is_deleted, error_doc, rendered_at, job_id
    )
    SELECT
      url, file_alias, realm_url, type,
      fitted_html, embedded_html, atom_html, head_html, isolated_html,
      markdown, deps, last_known_good_deps,
      generation, is_deleted, error_doc, indexed_at, job_id
    FROM boxel_index_working
  `);

  pgm.createIndex('prerendered_html', ['realm_url']);
  pgm.createIndex('prerendered_html_working', ['realm_url']);
  pgm.createIndex('prerendered_html_working', ['realm_url', 'job_id']);

  // `markdown_search_text` sanitizes markdown before it is fed to `to_tsvector`.
  // Postgres caps a single tsvector at 1,048,575 bytes; `make_tsvector` throws
  // SQLSTATE 54000 above that, which aborts a plain GIN expression-index build.
  // Image cards embed base64 in their markdown (multi-megabyte, one long
  // `[A-Za-z0-9+/=]` run that the `+`/`/` split into thousands of lexemes), so
  // the raw column can't be indexed. The function strips runs of >=255
  // base64-alphabet characters (no natural word is that long, so real prose is
  // untouched) and then caps length at 400000 as a backstop against any other
  // pathological density. IMMUTABLE so it is usable in an index expression;
  // matchesCondition() in packages/runtime-common/index-query-engine.ts MUST
  // call this same function or the planner won't use the index. The boxel_index
  // markdown FTS indexes are rebuilt onto this function in a later migration.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION markdown_search_text(md text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$
        SELECT left(
          regexp_replace(coalesce(md, ''), '[A-Za-z0-9+/=]{255,}', ' ', 'g'),
          400000
        )
      $$;
  `);

  // GIN expression index for the full-text `matches` predicate. Built
  // non-concurrently inside the migration transaction: these tables are brand
  // new and have no concurrent writers until the dual-write code deploys behind
  // this same migration.
  pgm.sql(`
    CREATE INDEX prerendered_html_markdown_fts_idx
      ON prerendered_html
      USING GIN (to_tsvector('english', markdown_search_text(markdown)));
  `);
  pgm.sql(`
    CREATE INDEX prerendered_html_working_markdown_fts_idx
      ON prerendered_html_working
      USING GIN (to_tsvector('english', markdown_search_text(markdown)));
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('prerendered_html_working', { cascade: true });
  pgm.dropTable('prerendered_html', { cascade: true });
  // Dropped last: the boxel_index FTS-repair migration (later timestamp) has
  // already reverted off this function by the time this down() runs.
  pgm.sql(`DROP FUNCTION IF EXISTS markdown_search_text(text);`);
};
