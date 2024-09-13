exports.up = (pgm) => {
  // Add any specific users. If there are any new users to add after this
  // migration has run then please open a new PR with the user(s) to add for the
  // specific environment
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write)
         VALUES
           ('https://realms-staging.stack.cards/seed/', 'habdelra1', true, true)`,
      );
      break;
    case 'production':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write)
         VALUES
           ('https://app.boxel.ai/seed/', 'habdelra1', true, true)`,
      );
      break;
    // intentionally not giving localhost "user" read/write access so that we
    // can better simulate an actual user experience
  }
};

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/seed/'",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/seed/'",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/seed/'",
      );
  }
};
