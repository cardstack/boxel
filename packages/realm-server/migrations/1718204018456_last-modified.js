exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    last_modified: { type: 'bigint' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['last_modified']);
};
