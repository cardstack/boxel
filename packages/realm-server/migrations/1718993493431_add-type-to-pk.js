exports.up = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_pkey');
  pgm.addConstraint('boxel_index', 'boxel_index_pkey', {
    primaryKey: ['url', 'realm_version', 'realm_url', 'type'],
  });
};

exports.down = (pgm) => {
  // migrating down could cause constraint errors because the PK becomes looser,
  // so we must delete the index first
  pgm.sql('DELETE FROM boxel_index');
  pgm.dropConstraint('boxel_index', 'boxel_index_pkey');
  pgm.addConstraint('boxel_index', 'boxel_index_pkey', {
    primaryKey: ['url', 'realm_version', 'realm_url'],
  });
};
