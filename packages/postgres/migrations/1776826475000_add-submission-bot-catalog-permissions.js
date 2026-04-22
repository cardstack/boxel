// Grant the submission bot (@submissionbot) read+write access to the
// Cardstack Catalog (/catalog/). The bot runs pr-listing-create flows and
// needs to resolve and lint modules that live in the catalog. Follows the
// pattern established by 1770623937158_add-submission-realm-permissions.js.
exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/catalog/', '@submissionbot:stack.cards', true, true, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
      );
      break;
    case 'production':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://app.boxel.ai/catalog/', '@submissionbot:boxel.ai', true, true, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
      );
      break;
    default:
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('http://localhost:4201/catalog/', '@submissionbot:localhost', true, true, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
      );
  }
};

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/catalog/' AND username = '@submissionbot:stack.cards'",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/catalog/' AND username = '@submissionbot:boxel.ai'",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/catalog/' AND username = '@submissionbot:localhost'",
      );
  }
};
