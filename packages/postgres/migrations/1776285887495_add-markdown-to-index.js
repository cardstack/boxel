exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    markdown: { type: 'text' },
  });
  pgm.addColumns('boxel_index_working', {
    markdown: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['markdown']);
  pgm.dropColumns('boxel_index_working', ['markdown']);
};
