/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('DELETE FROM boxel_index');
  pgm.sql('DELETE FROM realm_versions');
  pgm.sql('DELETE FROM jobs');
  pgm.sql('DELETE FROM queues');
};

exports.down = (pgm) => {};
