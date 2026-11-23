// Partial indexes over the `boxel_index` and `prerendered_html` rows whose
// render failed transiently: the rows whose diagnostics carry the
// `transientRenderFailure` verdict. The prerender-html reconcile reads them
// every minute to retry them on their backoff, and these let that read touch
// only the stamped rows, which are few, rather than scan both tables. The
// predicate is the text the reconcile queries use
// (`transientRenderFailureStampedSQL`), so the planner matches it.
//
// CONCURRENTLY because an ordinary build takes a lock that blocks writes for
// its whole duration, and both are large tables the previous revision is still
// writing to while this runs — the additive phase applies before the new code
// is deployed. It cannot run inside a transaction, hence noTransaction().
// node-pg-migrate logs `#> WARNING: Need to break single transaction! <` when
// applying this migration; that is expected, not a failure.
//
// An interrupted CONCURRENTLY build leaves an INVALID index under the target
// name, which the planner ignores and `IF NOT EXISTS` would treat as done. Each
// CREATE is therefore preceded by an unconditional DROP, so a retry rebuilds
// it.
//
// The pending tables get no index: the reconcile reads only production rows.

exports.shorthands = undefined;

const INDEXES = [
  ['boxel_index_transient_render_failure_index', 'boxel_index'],
  ['prerendered_html_transient_render_failure_index', 'prerendered_html'],
];

exports.up = (pgm) => {
  pgm.noTransaction();
  for (let [name, table] of INDEXES) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`);
    pgm.sql(`
      CREATE INDEX CONCURRENTLY ${name}
        ON ${table} (realm_url, url)
        WHERE jsonb_typeof(diagnostics -> 'transientRenderFailure') = 'array';
    `);
  }
};

exports.down = (pgm) => {
  pgm.noTransaction();
  for (let [name] of INDEXES) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`);
  }
};
