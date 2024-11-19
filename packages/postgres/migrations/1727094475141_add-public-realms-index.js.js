exports.up = (pgm) => {
  pgm.createIndex('realm_user_permissions', ['username', 'read']);
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(`DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/experiments/' AND username = '*' AND read = true`);
      break;
    case 'production':
      pgm.sql(`DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/experiments/' AND username = '*' AND read = true`);
      break;
    default:
      pgm.sql(`DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/experiments/' AND username = '*' AND read = true`);
      pgm.sql(`DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4204/' AND username = '*' AND read = true`);
      break;
  }
};

exports.down = (pgm) => {
  pgm.dropIndex('realm_user_permissions', ['username', 'read']);
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(`INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ('https://realms-staging.stack.cards/experiments/', '*', true, false, false)`);
      break;
    case 'production':
      pgm.sql(`INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ('https://app.boxel.ai/experiments/', '*', true, false, false)`);
      break;
    default:
      pgm.sql(`INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) 
               VALUES ('http://localhost:4201/experiments/', '*', true, false, false), ('http://localhost:4204/', '*', true, false, false)`);
      break;
  }
};
