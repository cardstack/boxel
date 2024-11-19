let table = 'realm_user_permissions';

exports.up = (pgm) => {
  // since we are loosening the PK remove all records as we may have records
  // that currently have PK collisions
  pgm.sql(`DELETE FROM ${table}`);
  pgm.dropConstraint(table, 'unique_realm_user_permissions');
  pgm.addConstraint(table, `${table}_pkey`, {
    primaryKey: ['realm_url', 'username'],
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint(table, `${table}_pkey`);
  pgm.addConstraint(table, 'unique_realm_user_permissions', {
    primaryKey: ['realm_url', 'username', 'read', 'write'],
  });
};
