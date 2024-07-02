exports.up = (pgm) => {
  pgm.sql('DELETE FROM boxel_index');
  pgm.dropColumns('boxel_index', ['embedded_html']);
  pgm.addColumns('boxel_index', {
    embedded_html: 'jsonb',
  });
};

exports.down = (pgm) => {
  pgm.sql('DELETE FROM boxel_index');
  pgm.dropColumns('boxel_index', ['embedded_html']);
  pgm.addColumns('boxel_index', {
    embedded_html: 'varchar',
  });
};
