// A secure window's session lasts as long as the app session it handed a
// sign-in to: `app_device_id` is the Matrix device the hand-off's login token
// signs the app in as. While that device exists, the window's session is
// renewed past its `expires_at`. Ending a session clears it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE secure_sessions ADD COLUMN IF NOT EXISTS app_device_id varchar
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE secure_sessions DROP COLUMN IF EXISTS app_device_id
  `);
};
