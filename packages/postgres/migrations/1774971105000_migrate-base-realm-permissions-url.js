/**
 * Migrate base realm permission URLs from the old canonical
 * https://cardstack.com/base/ to the environment-appropriate resolved URL,
 * matching how all other realm permissions are stored.
 */

const OLD_BASE = 'https://cardstack.com/base/';

function getNewBase() {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      return 'https://realms-staging.stack.cards/base/';
    case 'production':
      return 'https://app.boxel.ai/base/';
    default:
      return 'http://localhost:4201/base/';
  }
}

exports.up = (pgm) => {
  let newBase = getNewBase();
  pgm.sql(
    `UPDATE realm_user_permissions
     SET realm_url = '${newBase}'
     WHERE realm_url = '${OLD_BASE}'`,
  );
};

exports.down = (pgm) => {
  let newBase = getNewBase();
  pgm.sql(
    `UPDATE realm_user_permissions
     SET realm_url = '${OLD_BASE}'
     WHERE realm_url = '${newBase}'`,
  );
};
