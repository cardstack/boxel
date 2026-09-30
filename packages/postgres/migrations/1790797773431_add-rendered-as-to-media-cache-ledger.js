exports.shorthands = undefined;

// Whose authority a capture was drawn under, as part of its ledger identity.
// A capture a user asks for renders as that user, so what it draws is that
// user's view of the card and is served back only to them; `rendered_as`
// names that user, or is `*` for a reader who authenticated nobody. A capture
// the realm makes of its own cards (a declared screenshot, rendered by
// indexing) is the realm's artifact, served to every reader, and carries the
// empty string. Empty rather than NULL because the column is part of the
// primary key.
//
// The primary key is rebuilt under its own name, so an upsert that names the
// constraint keeps resolving, and a writer that never sets the column keeps
// the realm-authority key it always had.

exports.up = (pgm) => {
  pgm.addColumns('media_cache_ledger', {
    rendered_as: { type: 'varchar', notNull: true, default: '' },
  });
  pgm.dropConstraint('media_cache_ledger', 'media_cache_ledger_pkey');
  pgm.addConstraint('media_cache_ledger', 'media_cache_ledger_pkey', {
    primaryKey: [
      'realm_url',
      'source_url',
      'capture_spec_hash',
      'source_generation',
      'rendered_as',
    ],
  });
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM media_cache_ledger WHERE rendered_as <> ''`);
  pgm.dropConstraint('media_cache_ledger', 'media_cache_ledger_pkey');
  pgm.addConstraint('media_cache_ledger', 'media_cache_ledger_pkey', {
    primaryKey: [
      'realm_url',
      'source_url',
      'capture_spec_hash',
      'source_generation',
    ],
  });
  pgm.dropColumns('media_cache_ledger', ['rendered_as']);
};
