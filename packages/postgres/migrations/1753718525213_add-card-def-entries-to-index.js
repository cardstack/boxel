exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    meta: 'jsonb',
  });
  pgm.addColumns('boxel_index_working', {
    meta: 'jsonb',
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['meta']);
  pgm.dropColumns('boxel_index_working', ['meta']);
};
