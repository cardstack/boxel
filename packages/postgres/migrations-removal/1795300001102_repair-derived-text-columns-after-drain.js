// Post-deploy: fills the derived text columns that rows promoted by the
// previous revision left empty while this release's migrations and its code
// rolled out.
//
// The pre-deploy migrations add `boxel_index.search_title` and
// `prerendered_html.markdown_tsv` and backfill the rows already there, then
// the new code fills them as it promotes a pass. In between, the previous
// revision keeps committing passes against the migrated tables, and its
// writer promotes every column it does not stage as NULL (runtime-common's
// `stagedColumn`), so a row it wrote after the backfill walked past has no
// search title and no markdown vector. Once that revision has drained, nothing
// writes such a row again; this repair runs then, which is the removal
// phase's place in a deploy. It is not destructive.
//
// The render-dependent columns (`search_tsv`, `rank_tsv`, `pattern_text`)
// are not repaired: nothing a row stores derives them, and as their own
// migrations say, a row gains them the next time it is indexed.
//
// Idempotent: each table is walked in primary-key order in committed batches
// of 500, updating only a row whose derived value is missing or differs, so
// no transaction holds row locks across a table and a rerun does no work.

exports.up = (pgm) => {
  pgm.noTransaction();
  for (let [name, table, set, differs] of [
    [
      'boxel_repair_index_titles',
      'boxel_index',
      `search_title = lower(t.search_doc ->> '_title')`,
      `t.search_title IS DISTINCT FROM lower(t.search_doc ->> '_title')`,
    ],
    [
      'boxel_repair_markdown_vectors',
      'prerendered_html',
      `markdown_tsv = to_tsvector('boxel_english', markdown_search_text(t.markdown))`,
      `t.markdown_tsv IS NULL AND t.markdown IS NOT NULL`,
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
                AND ${differs};
            lu := nu; lr := nr; lt := nt;
            COMMIT;
          END LOOP;
        END
      $$;
    `);
    pgm.sql(`CALL ${name}()`);
    pgm.sql(`DROP PROCEDURE ${name}()`);
  }
};

// Nothing to undo: the repair writes the values the writer would have.
exports.down = () => {};
