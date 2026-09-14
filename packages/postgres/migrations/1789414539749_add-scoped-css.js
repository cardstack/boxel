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
// each realm ref-counts its own rows: a reindex can drop the realm's rows that
// its live deps no longer reference, and deleting a realm drops all of its
// rows. Serving looks up by `hash` alone (any realm's copy of the same
// content-addressed bytes qualifies), which keeps cross-realm deps servable.
//
// `created_at` is a unix-ms bigint like `prerendered_html.rendered_at` (pg
// returns them as JS strings).

exports.up = (pgm) => {
  pgm.createTable('scoped_css', {
    realm_url: { type: 'varchar', notNull: true },
    hash: { type: 'varchar', notNull: true },
    css: { type: 'text', notNull: true },
    created_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('scoped_css', 'scoped_css_pkey', {
    primaryKey: ['realm_url', 'hash'],
  });
  // Serving resolves a hashed request by hash alone, across realms.
  pgm.createIndex('scoped_css', ['hash']);
};

exports.down = (pgm) => {
  pgm.dropTable('scoped_css');
};
