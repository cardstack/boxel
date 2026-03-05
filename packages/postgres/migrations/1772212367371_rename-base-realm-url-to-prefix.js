exports.up = (pgm) => {
  // Clear cached index and module data that references the old
  // https://cardstack.com/base/ URL format. These tables are rebuilt
  // automatically when the realm server starts.
  pgm.sql(`DELETE FROM boxel_index`);
  pgm.sql(`DELETE FROM boxel_index_working`);
  pgm.sql(`DELETE FROM realm_versions`);
  pgm.sql(`DELETE FROM modules`);

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
