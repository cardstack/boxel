exports.up = (pgm) => {
  pgm.sql(`DELETE FROM boxel_index WHERE type = 'module'`);
  pgm.sql(`DELETE FROM boxel_index_working WHERE type = 'module'`);

  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');

  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check: "type in ('instance','file')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check: "type in ('instance','file')",
  });
};

exports.down = (pgm) => {
  // Row deletions in `up` are irreversible, but we can restore the prior
  // allowed type domain on both index tables.
  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');

  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check: "type in ('instance','module','file')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check: "type in ('instance','module','file')",
  });
};
