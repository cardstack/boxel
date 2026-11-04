// The audit trail of changes to platform OAuth clients
// (`platform_oauth_clients` rows): one row per add, secret replace or delete,
// with the client it touched (its row id, its name and the vendor's client
// id), the operator's note, the data key its secret was sealed under, and
// what the server observed of the caller: its address and when its operator
// token was signed (`token_issued_at`, seconds since the epoch). It never
// holds a secret. `platform_client_id` has no foreign key, so a deleted
// client keeps its history; a client added again under the same name has a
// new id, and its name joins the two.

exports.up = (pgm) => {
  pgm.createTable(
    'platform_oauth_client_history',
    {
      id: { type: 'bigserial', primaryKey: true },
      platform_client_id: { type: 'uuid', notNull: true },
      name: { type: 'varchar', notNull: true },
      client_id: { type: 'varchar', notNull: true },
      action: {
        type: 'varchar',
        notNull: true,
        check: "action IN ('add', 'replace', 'delete')",
      },
      note: { type: 'text', notNull: true },
      key_id: { type: 'varchar' },
      client_address: { type: 'varchar' },
      token_issued_at: { type: 'bigint' },
      changed_at: {
        type: 'timestamp',
        notNull: true,
        default: pgm.func('CURRENT_TIMESTAMP'),
      },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('platform_oauth_client_history', ['name', 'changed_at'], {
    ifNotExists: true,
  });
};

exports.down = (pgm) => {
  pgm.dropTable('platform_oauth_client_history', { ifExists: true });
};
