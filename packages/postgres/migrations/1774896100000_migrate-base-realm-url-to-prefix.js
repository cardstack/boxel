/**
 * Migrate base realm URLs from https://cardstack.com/base/ to the
 * @cardstack/base/ import map prefix form, consistent with how
 * @cardstack/catalog/ and @cardstack/skills/ are stored.
 */

const OLD_BASE = 'https://cardstack.com/base/';
const NEW_BASE = '@cardstack/base/';

exports.up = (pgm) => {
  pgm.sql(
    `UPDATE realm_user_permissions
     SET realm_url = '${NEW_BASE}'
     WHERE realm_url = '${OLD_BASE}'`,
  );
};

exports.down = (pgm) => {
  pgm.sql(
    `UPDATE realm_user_permissions
     SET realm_url = '${OLD_BASE}'
     WHERE realm_url = '${NEW_BASE}'`,
  );
};
