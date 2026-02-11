exports.up = (pgm) => {
  pgm.addColumn('boxel_index', {
    last_known_good_deps: { type: 'jsonb' },
  });
  pgm.addColumn('boxel_index_working', {
    last_known_good_deps: { type: 'jsonb' },
  });

  // Backfill existing successful entries
  pgm.sql(`
    UPDATE boxel_index SET last_known_good_deps = deps
    WHERE (has_error = FALSE OR has_error IS NULL) AND deps IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn('boxel_index', 'last_known_good_deps');
  pgm.dropColumn('boxel_index_working', 'last_known_good_deps');
};
