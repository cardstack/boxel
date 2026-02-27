exports.up = (pgm) => {
  pgm.sql(
    `UPDATE realm_user_permissions
     SET realm_url = '@cardstack/base/'
     WHERE realm_url = 'https://cardstack.com/base/'`,
  );
};

exports.down = (pgm) => {
  pgm.sql(
    `UPDATE realm_user_permissions
     SET realm_url = 'https://cardstack.com/base/'
     WHERE realm_url = '@cardstack/base/'`,
  );
};
