/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('DELETE FROM modules');
  pgm.addColumn('modules', {
    file_alias: { type: 'text' },
  });
  pgm.addIndex('modules', ['resolved_realm_url', 'file_alias']);
};

exports.down = (pgm) => {
  pgm.dropIndex('modules', ['resolved_realm_url', 'file_alias']);
  pgm.dropColumn('modules', 'file_alias');
};
