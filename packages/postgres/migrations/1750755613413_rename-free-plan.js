/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`UPDATE plans SET name = 'Starter' WHERE name = 'Free'`);

  pgm.sql(`UPDATE plans SET credits_included = 2500 WHERE name = 'Starter'`);
  pgm.sql(`UPDATE plans SET credits_included = 6500 WHERE name = 'Creator'`);
  pgm.sql(
    `UPDATE plans SET credits_included = 35000 WHERE name = 'Power User'`,
  );
};

exports.down = (pgm) => {
  pgm.sql(`UPDATE plans SET name = 'Free' WHERE name = 'Starter'`);
  pgm.sql(`UPDATE plans SET credits_included = 1000 WHERE name = 'Starter'`);
  pgm.sql(`UPDATE plans SET credits_included = 5000 WHERE name = 'Creator'`);
  pgm.sql(
    `UPDATE plans SET credits_included = 25000 WHERE name = 'Power User'`,
  );
};
