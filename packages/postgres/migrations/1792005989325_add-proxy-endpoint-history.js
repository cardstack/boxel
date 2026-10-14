// The audit trail of changes to system keys (`proxy_endpoints` rows): one row
// per add, replace or delete, with the endpoint it touched and the operator's
// note. It never holds a key value. `endpoint_id` has no foreign key, so a
// deleted endpoint keeps its history.

exports.up = (pgm) => {
  pgm.createTable(
    'proxy_endpoint_history',
    {
      id: { type: 'bigserial', primaryKey: true },
      endpoint_id: { type: 'uuid', notNull: true },
      url: { type: 'varchar', notNull: true },
      action: {
        type: 'varchar',
        notNull: true,
        check: "action IN ('add', 'replace', 'delete')",
      },
      note: { type: 'text', notNull: true },
      key_id: { type: 'varchar' },
      changed_at: {
        type: 'timestamp',
        notNull: true,
        default: pgm.func('CURRENT_TIMESTAMP'),
      },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('proxy_endpoint_history', ['endpoint_id', 'changed_at'], {
    ifNotExists: true,
  });
};

exports.down = (pgm) => {
  pgm.dropTable('proxy_endpoint_history', { ifExists: true });
};
