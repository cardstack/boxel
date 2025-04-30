 

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    icon_html: 'varchar',
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['icon_html']);
};
