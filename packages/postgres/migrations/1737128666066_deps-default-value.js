exports.up = (pgm) => {
  pgm.alterColumn('boxel_index', 'deps', {
    default: `[]`,
  });
  pgm.alterColumn('boxel_index_working', 'deps', {
    default: `[]`,
  });
  pgm.createIndex('boxel_index', ['realm_url', 'type']);
  pgm.createIndex('boxel_index_working', ['realm_url', 'type']);
  pgm.sql(`UPDATE boxel_index SET deps = '[]'::jsonb WHERE deps IS NULL`);
  pgm.sql(
    `UPDATE boxel_index_working SET deps = '[]'::jsonb WHERE deps IS NULL`,
  );
};

exports.down = (pgm) => {
  pgm.dropIndex('boxel_index', ['realm_url', 'type']);
  pgm.dropIndex('boxel_index_working', ['realm_url', 'type']);
  pgm.alterColumn('boxel_index', 'deps', {
    default: null,
  });
  pgm.alterColumn('boxel_index_working', 'deps', {
    default: null,
  });
};
