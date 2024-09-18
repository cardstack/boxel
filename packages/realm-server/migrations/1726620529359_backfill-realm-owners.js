exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/seed/', '@seed_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/experiments/', '@experiments_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/experiments/', '*', true, false, false),
           ('https://realms-staging.stack.cards/experiments/', 'users', true, true, false),
           ('https://cardstack.com/base/', '@base_realm:stack.cards', true, true, true),
           ('https://cardstack.com/base/', '*', true, false, false)`,
      );
      break;
    case 'production':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://app.boxel.ai/seed/', '@seed_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/experiments/', '@experiments_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/experiments/', '*', true, false, false),
           ('https://app.boxel.ai/experiments/', 'users', true, true, false),
           ('https://cardstack.com/base/', '@base_realm:boxel.ai', true, true, true),
           ('https://cardstack.com/base/', '*', true, false, false)`,
      );
      break;
    default:
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://cardstack.com/base/', '@base_realm:localhost', true, true, true),
           ('https://cardstack.com/base/', '*', true, false, false),
           ('http://localhost:4201/seed/', '@seed_realm:localhost', true, true, true),
           ('http://localhost:4201/experiments/', '@experiments_realm:localhost', true, true, true),
           ('http://localhost:4201/experiments/', '*', true, false, false),
           ('http://localhost:4201/experiments/', 'users', true, true, false),
           ('http://localhost:4202/test/', '@test_realm:localhost', true, true, true),
           ('http://localhost:4202/test/', '*', true, false, false),
           ('http://localhost:4202/test/', 'users', true, true, false),
           ('http://localhost:4202/node-test/', '@node-test_realm:localhost', true, true, true),
           ('http://localhost:4202/node-test/', '*', true, false, false),
           ('http://localhost:4202/node-test/', 'users', true, true, false),
           ('http://localhost:4203/', '@base_realm:localhost', true, true, true),
           ('http://localhost:4203/', '*', true, false, false),
           ('http://localhost:4204/', '@experiments_realm:localhost', true, true, true),
           ('http://localhost:4204/', '*', true, false, false),
           ('http://localhost:4204/', 'users', true, true, false),
           ('http://localhost:4205/test/', '@test_realm:localhost', true, true, true),
           ('http://localhost:4205/test/', '*', true, false, false),
           ('http://localhost:4205/test/', 'users', true, true, false)`,
      );
  }
};

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/seed/' AND username = '@seed_realm:stack.cards'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/experiments/' AND username = '@experiments_realm:stack.cards'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://cardstack.com/base/' AND username = '@base_realm:stack.cards'",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/seed/' AND username = '@seed_realm:boxel.ai'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/experiments/' AND username = '@experiments_realm:boxel.ai'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://cardstack.com/base/' AND username = '@base_realm:boxel.ai'",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://cardstack.com/base/' AND username = '@base_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/seed/' AND username = '@seed_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/experiments/' AND username = '@experiments_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4202/test/' AND username = '@test_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4202/node-test/' AND username = '@node-test_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4203/' AND username = '@base_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4204/' AND username = '@experiments_realm:localhost'",
      );
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4205/test/' AND username = '@test_realm:localhost'",
      );
  }
};
