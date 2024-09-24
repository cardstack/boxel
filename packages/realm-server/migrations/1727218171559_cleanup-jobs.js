/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('delete from jobs');
  pgm.sql('delete from queues');
  pgm.sql('delete from boxel_index');
  pgm.sql('delete from realm_versions');
};

exports.down = (pgm) => {};
