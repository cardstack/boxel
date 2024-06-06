exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    source: { type: 'varchar' },
    transpiled_code: { type: 'varchar' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['source', 'transpiled_code']);
};
