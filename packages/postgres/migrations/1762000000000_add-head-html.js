exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    head_html: { type: 'text' },
  });
  pgm.addColumns('boxel_index_working', {
    head_html: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['head_html']);
  pgm.dropColumns('boxel_index_working', ['head_html']);
};
