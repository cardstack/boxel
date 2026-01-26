exports.up = (pgm) => {
  pgm.addColumn('realm_file_meta', {
    content_hash: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('realm_file_meta', 'content_hash');
};
