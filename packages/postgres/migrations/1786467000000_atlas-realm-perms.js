// Permissions for the Atlas Slice realm — the versioned-vertical fixture
// described in `docs/atlas-slice-version-scenarios.md`.
//
// LOCAL ONLY, and deliberately so. This realm exists to publish thirty-odd
// Versions across six fictional publishers and then break them on purpose;
// none of that belongs in staging or production, so both cases return early
// rather than inserting rows a deploy would have to clean up later.
//
// A REALM WITHOUT A `realm-owner` ROW MOUNTS AND NEVER INDEXES. That is the
// failure this migration exists to prevent, and it is quiet: the realm answers
// requests, the route is live, and `from-scratch-index` aborts in
// `getRealmOwnerUserId()` with "Cannot determine realm owner", leaving an empty
// realm that looks configured. Both spellings of the local URL are declared
// because `seedEnvironmentPermissionParity` mirrors standard-mode rows onto
// env-mode URLs by PATH match, so a row has to exist at some standard URL for
// an environment-mode realm to inherit one.

exports.shorthands = undefined;

const LOCAL_URLS = [
  'http://localhost:4201/atlas/',
  'http://localhost:4205/atlas/',
];

exports.up = (pgm) => {
  if (
    ['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }
  let values = LOCAL_URLS.flatMap((url) => [
    `('${url}', '@atlas_realm:localhost', true, true, true)`,
    `('${url}', '@user:localhost', true, true, false)`,
    `('${url}', '*', true, false, false)`,
  ]).join(',\n       ');
  pgm.sql(
    `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
     VALUES
       ${values}
     ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
     DO UPDATE SET
       realm_url   = EXCLUDED.realm_url,
       username    = EXCLUDED.username,
       read        = EXCLUDED.read,
       write       = EXCLUDED.write,
       realm_owner = EXCLUDED.realm_owner`,
  );
};

exports.down = (pgm) => {
  if (
    ['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }
  let urls = LOCAL_URLS.map((url) => `'${url}'`).join(', ');
  pgm.sql(
    `DELETE FROM realm_user_permissions WHERE realm_url IN (${urls}) AND username IN ('@atlas_realm:localhost', '@user:localhost', '*')`,
  );
};
