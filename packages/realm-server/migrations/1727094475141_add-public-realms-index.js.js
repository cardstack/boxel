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
      break;
  }
};
