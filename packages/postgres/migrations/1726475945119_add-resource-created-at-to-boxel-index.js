exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    resource_created_at: { type: 'bigint' },
  });

  pgm.createIndex('boxel_index', ['resource_created_at']);
  pgm.createIndex('boxel_index', ['last_modified']);
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['resource_created_at']);
};
