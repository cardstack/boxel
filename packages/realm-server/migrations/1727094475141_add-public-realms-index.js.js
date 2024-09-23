exports.up = (pgm) => {
  pgm.createIndex('realm_user_permissions', ['username', 'read']);
};
