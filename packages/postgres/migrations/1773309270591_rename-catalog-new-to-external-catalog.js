exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = REPLACE(realm_url, '/catalog-new/', '/external-catalog/'),
             username = REPLACE(username, '@catalog_new_realm:', '@external_catalog_realm:')
         WHERE realm_url LIKE '%/catalog-new/'`,
      );
      break;
    case 'production':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = REPLACE(realm_url, '/catalog-new/', '/external-catalog/'),
             username = REPLACE(username, '@catalog_new_realm:', '@external_catalog_realm:')
         WHERE realm_url LIKE '%/catalog-new/'`,
      );
      break;
    default:
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = REPLACE(realm_url, '/catalog-new/', '/external-catalog/'),
             username = REPLACE(username, '@catalog_new_realm:', '@external_catalog_realm:')
         WHERE realm_url LIKE '%/catalog-new/'`,
      );
  }
};

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = REPLACE(realm_url, '/external-catalog/', '/catalog-new/'),
             username = REPLACE(username, '@external_catalog_realm:', '@catalog_new_realm:')
         WHERE realm_url LIKE '%/external-catalog/'`,
      );
      break;
    case 'production':
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = REPLACE(realm_url, '/external-catalog/', '/catalog-new/'),
             username = REPLACE(username, '@external_catalog_realm:', '@catalog_new_realm:')
         WHERE realm_url LIKE '%/external-catalog/'`,
      );
      break;
    default:
      pgm.sql(
        `UPDATE realm_user_permissions
         SET realm_url = REPLACE(realm_url, '/external-catalog/', '/catalog-new/'),
             username = REPLACE(username, '@external_catalog_realm:', '@catalog_new_realm:')
         WHERE realm_url LIKE '%/external-catalog/'`,
      );
  }
};
