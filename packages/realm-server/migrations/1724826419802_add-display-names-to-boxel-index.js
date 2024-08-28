exports.up = pgm => {
  pgm.addColumns('boxel_index', {
    display_names: 'jsonb',
  });
};

exports.down = pgm => {
  pgm.dropColumns('boxel_index', {
    display_names: 'jsonb',
  });
};
