// The choreo-gallery realm is mounted by the realm server rather than created
// through the app, so nothing seeds its realm_metadata row: create-realm is
// the only path that sets publishable = true. Without it the host doesn't
// offer the Host submode for the realm and _publish-realm refuses to publish
// it. This marks the gallery's source realm publishable on each environment.
exports.shorthands = undefined;

function galleryRealmURLs() {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      return ['https://realms-staging.stack.cards/choreo-gallery/'];
    case 'production':
      return ['https://app.boxel.ai/choreo-gallery/'];
    default:
      return [
        'https://localhost:4201/choreo-gallery/',
        'https://localhost:4205/choreo-gallery/',
      ];
  }
}

exports.up = (pgm) => {
  let values = galleryRealmURLs()
    .map((url) => `('${url}', true)`)
    .join(', ');
  pgm.sql(`
    INSERT INTO realm_metadata (url, publishable)
    VALUES ${values}
    ON CONFLICT (url) DO UPDATE SET publishable = true, updated_at = now()
  `);
};

exports.down = (pgm) => {
  let urls = galleryRealmURLs()
    .map((url) => `'${url}'`)
    .join(', ');
  pgm.sql(`
    UPDATE realm_metadata SET publishable = NULL, updated_at = now()
    WHERE url IN (${urls})
  `);
};
