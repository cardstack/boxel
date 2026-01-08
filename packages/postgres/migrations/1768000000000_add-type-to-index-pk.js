exports.up = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_pkey');
  pgm.addConstraint('boxel_index', 'boxel_index_pkey', {
    primaryKey: ['url', 'realm_url', 'type'],
  });

  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_pkey');
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_pkey', {
    primaryKey: ['url', 'realm_url', 'type'],
  });
};

exports.down = (pgm) => {
  // migrating down could cause constraint errors because the PK becomes tighter,
  // so we must delete the index first
  pgm.sql('DELETE FROM boxel_index');
  pgm.sql('DELETE FROM boxel_index_working');
  pgm.sql('DELETE FROM realm_versions');

  pgm.dropConstraint('boxel_index', 'boxel_index_pkey');
  pgm.addConstraint('boxel_index', 'boxel_index_pkey', {
    primaryKey: ['url', 'realm_url'],
  });

  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_pkey');
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_pkey', {
    primaryKey: ['url', 'realm_url'],
  });
};
