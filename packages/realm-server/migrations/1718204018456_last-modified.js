exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    last_modified: { type: 'bigint' },
  });
  pgm.createIndex('boxel_index', ['file_alias']);
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['last_modified']);
  pgm.dropIndex('boxel_index', ['file_alias']);
};
