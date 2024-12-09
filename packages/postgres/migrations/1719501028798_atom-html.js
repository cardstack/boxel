exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    atom_html: 'varchar',
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['atom_html']);
};
