exports.up = (pgm) => {
  pgm.addColumn('realm_file_meta', {
    content_size: { type: 'integer' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('realm_file_meta', 'content_size');
};
