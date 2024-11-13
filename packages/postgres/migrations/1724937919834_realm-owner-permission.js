exports.up = (pgm) => {
  pgm.addColumns('realm_user_permissions', {
    realm_owner: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('realm_user_permissions', ['realm_owner']);
};
