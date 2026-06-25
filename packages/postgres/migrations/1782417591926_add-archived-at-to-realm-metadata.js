// Storage for the owner-controlled realm archive flag. Archiving is a
// global, per-realm state (not per-user), so it lives on realm_metadata,
// the purpose-built mutable per-realm flags table.
//
// archived_at IS NULL  -> realm is active
// archived_at NOT NULL -> realm is archived (timestamp it was archived)
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('realm_metadata', {
    archived_at: {
      type: 'timestamptz',
      notNull: false,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('realm_metadata', 'archived_at');
};
