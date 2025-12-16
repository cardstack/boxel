exports.up = (pgm) => {
  pgm.sql(
    `DELETE FROM boxel_index WHERE type = 'definition'; DELETE FROM boxel_index_working WHERE type = 'definition';`,
  );
  pgm.dropColumns('boxel_index', ['definition']);
  pgm.dropColumns('boxel_index_working', ['definition']);
};

exports.down = (pgm) => {
  pgm.addColumns('boxel_index', {
    definition: 'jsonb',
  });
  pgm.addColumns('boxel_index_working', {
    definition: 'jsonb',
  });
};
