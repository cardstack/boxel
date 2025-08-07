exports.up = (pgm) => {
  pgm.renameColumn('boxel_index', 'meta', 'definition');
  pgm.renameColumn('boxel_index_working', 'meta', 'definition');
};

exports.down = (pgm) => {
  pgm.renameColumn('boxel_index', 'definition', 'meta');
  pgm.renameColumn('boxel_index_working', 'definition', 'meta');
};
