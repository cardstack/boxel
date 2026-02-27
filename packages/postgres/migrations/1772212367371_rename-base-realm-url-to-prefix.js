exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = 'https://realms-staging.stack.cards/base/'
         WHERE realm_url = 'https://cardstack.com/base/'`,
      );
      break;
    case 'production':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = 'https://app.boxel.ai/base/'
         WHERE realm_url = 'https://cardstack.com/base/'`,
      );
      break;
    default:
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = 'http://localhost:4201/base/'
         WHERE realm_url = 'https://cardstack.com/base/'`,
      );
  }
};

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = 'https://cardstack.com/base/'
         WHERE realm_url = 'https://realms-staging.stack.cards/base/'`,
      );
      break;
    case 'production':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = 'https://cardstack.com/base/'
         WHERE realm_url = 'https://app.boxel.ai/base/'`,
      );
      break;
    default:
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = 'https://cardstack.com/base/'
         WHERE realm_url = 'http://localhost:4201/base/'`,
      );
  }
};
