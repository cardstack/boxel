// Store each rendered card's full-text vector in a column, `markdown_tsv`, so
// every `matches` search reads it instead of recomputing
// `to_tsvector('english', markdown_search_text(markdown))` per row.
//
// The expression index answers "which rows hold these words", but anything it
// can't decide from the index alone is a recompute of that expression: a
// phrase (the index holds no word positions), a relevance rank, and any plan
// that probes rows by key and filters them. `markdown_search_text` runs a
// regex over up to 400 KB of markdown, so on long documents (talk
// transcripts) each recompute costs ~0.8 ms and a phrase over a few thousand
// candidates took seconds. Reading a stored tsvector is a detoast.
//
// Deploy safety, for tables that can be large in production:
// - The column is added nullable with no default, which is a catalog-only
//   change (no table rewrite, no long lock). `GENERATED ... STORED` would
//   rewrite the whole table under an exclusive lock.
// - A trigger keeps it current from then on: on INSERT when the writer didn't
//   supply it, and on UPDATE when `markdown` changed and the writer didn't
//   change it. Promotion from `prerendered_html_pending` copies every column,
//   so the value computed at staging is carried into production rather than
//   computed twice.
// - Existing rows are backfilled in committed batches, so no single
//   transaction holds row locks across the table.
// - The GIN index is built CONCURRENTLY. The old expression indexes stay until
//   the post-deploy removal migration, because the previous code revision
//   still queries through them during a rolling deploy.
//
// `prerendered_html_pending` gets the column and trigger too (a search can
// read a pass's staged rows), but no index: it only ever holds one pass.

const TABLES = ['prerendered_html', 'prerendered_html_pending'];

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE OR REPLACE FUNCTION prerendered_markdown_tsv_sync() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.markdown_tsv IS NULL AND NEW.markdown IS NOT NULL THEN
            NEW.markdown_tsv := to_tsvector('english', markdown_search_text(NEW.markdown));
          END IF;
        ELSIF NEW.markdown IS DISTINCT FROM OLD.markdown
          AND NEW.markdown_tsv IS NOT DISTINCT FROM OLD.markdown_tsv THEN
          NEW.markdown_tsv := CASE
            WHEN NEW.markdown IS NULL THEN NULL
            ELSE to_tsvector('english', markdown_search_text(NEW.markdown))
          END;
        END IF;
        RETURN NEW;
      END
    $$;
  `);
  for (let table of TABLES) {
    pgm.sql(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS markdown_tsv tsvector`,
    );
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_markdown_tsv_sync ON ${table}`);
    pgm.sql(`
      CREATE TRIGGER ${table}_markdown_tsv_sync
        BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION prerendered_markdown_tsv_sync();
    `);
  }
  // Backfill existing production rows in committed batches of 500. Staged
  // pending rows are transient and are either promoted (carrying a value the
  // trigger computes from now on) or discarded, so they need none.
  pgm.sql(`
    CREATE OR REPLACE PROCEDURE prerendered_markdown_tsv_backfill()
      LANGUAGE plpgsql AS $$
      DECLARE
        updated integer;
      BEGIN
        LOOP
          UPDATE prerendered_html AS p
            SET markdown_tsv = to_tsvector('english', markdown_search_text(p.markdown))
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
  for (let table of TABLES) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_markdown_tsv_sync ON ${table}`);
    pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS markdown_tsv`);
  }
  pgm.sql(`DROP FUNCTION IF EXISTS prerendered_markdown_tsv_sync()`);
};
