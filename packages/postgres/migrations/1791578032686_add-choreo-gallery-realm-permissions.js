exports.shorthands = undefined;

exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/choreo-gallery/', '@choreo_gallery_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/choreo-gallery/', '@choreo_gallery_writer:stack.cards', true, true, false),
           ('https://realms-staging.stack.cards/choreo-gallery/', '*', true, false, false)
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
           ('https://app.boxel.ai/choreo-gallery/', '@choreo_gallery_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/choreo-gallery/', '@choreo_gallery_writer:boxel.ai', true, true, false),
           ('https://app.boxel.ai/choreo-gallery/', '*', true, false, false)
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
           ('https://localhost:4201/choreo-gallery/', '@choreo_gallery_realm:localhost', true, true, true),
           ('https://localhost:4201/choreo-gallery/', '@choreo_gallery_writer:localhost', true, true, false),
           ('https://localhost:4201/choreo-gallery/', '*', true, false, false),
           ('https://localhost:4205/choreo-gallery/', '@choreo_gallery_realm:localhost', true, true, true),
           ('https://localhost:4205/choreo-gallery/', '@choreo_gallery_writer:localhost', true, true, false),
           ('https://localhost:4205/choreo-gallery/', '*', true, false, false)
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
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/choreo-gallery/' AND username IN ('@choreo_gallery_realm:stack.cards', '@choreo_gallery_writer:stack.cards', '*')",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/choreo-gallery/' AND username IN ('@choreo_gallery_realm:boxel.ai', '@choreo_gallery_writer:boxel.ai', '*')",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url IN ('https://localhost:4201/choreo-gallery/', 'https://localhost:4205/choreo-gallery/') AND username IN ('@choreo_gallery_realm:localhost', '@choreo_gallery_writer:localhost', '*')",
      );
  }
};
