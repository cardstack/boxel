exports.shorthands = undefined;

// Content-addressed storage for scoped-CSS stylesheets. `glimmer-scoped-css`
// emits virtual-module URLs that base64-embed the entire stylesheet; recording
// those URLs verbatim in the index tables' `deps` columns made the encoded CSS
// the overwhelming majority of dependency storage. The index writer instead
// persists deps in the hashed form `<fromFile>.md5-<hash>.glimmer-scoped.css`
// and interns the CSS bytes here, once per (realm, stylesheet).
//
// `realm_url` is the realm whose index rows reference the stylesheet — the
// *consuming* realm, not necessarily the realm the styled module lives in — so
// each realm ref-counts its own rows: the scheduled `scoped-css-gc` job
// sweeps the realm's rows its live deps no longer reference
// (`sweepUnreferencedScopedCSS`), and realm deletion removes them
// (`removeRealmDatabaseArtifacts`). The realm's own `_scoped-css/` serving
// route looks up by (realm_url, hash) — the consuming realm interned every
// stylesheet its rows reference, so cross-realm deps stay servable without
// consulting other realms' rows.
//
// `last_interned_at` is a unix-ms bigint like `prerendered_html.rendered_at`
// (pg returns them as JS strings). Every intern refreshes it, including one
// whose bytes were already stored — the GC's grace window reads it as "no
// unpromoted index pass can still be about to reference this row".

exports.up = (pgm) => {
  pgm.createTable('scoped_css', {
    realm_url: { type: 'varchar', notNull: true },
    hash: { type: 'varchar', notNull: true },
    css: { type: 'text', notNull: true },
    last_interned_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('scoped_css', 'scoped_css_pkey', {
    primaryKey: ['realm_url', 'hash'],
  });
  // The published-site pipeline (`resolveScopedCSSFromDeps`) resolves a
  // page's hashed deps by hash alone; realm serving goes through the primary
  // key.
  pgm.createIndex('scoped_css', ['hash']);
};

exports.down = (pgm) => {
  pgm.dropTable('scoped_css');
};
