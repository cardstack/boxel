exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    fitted_html: 'jsonb',
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['fitted_html']);
};
