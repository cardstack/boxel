/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE boxel_index
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS transpiled_code;
  `);

  pgm.sql(`
    ALTER TABLE boxel_index_working
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS transpiled_code;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE boxel_index
    ADD COLUMN IF NOT EXISTS source varchar,
    ADD COLUMN IF NOT EXISTS transpiled_code varchar;
  `);

  pgm.sql(`
    ALTER TABLE boxel_index_working
    ADD COLUMN IF NOT EXISTS source varchar,
    ADD COLUMN IF NOT EXISTS transpiled_code varchar;
  `);
};
