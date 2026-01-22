const {
  migrationRenames,
  buildUpdateMigrationSql,
} = require('../scripts/migration-name-fixes');

function updateMigrationNames(pgm, mapping) {
  if (!mapping.length) {
    return;
  }

  pgm.sql(buildUpdateMigrationSql(mapping));
}

exports.up = (pgm) => {
  updateMigrationNames(pgm, migrationRenames);
};

exports.down = (pgm) => {
  const reversed = migrationRenames.map(([oldName, newName]) => [newName, oldName]);
  updateMigrationNames(pgm, reversed);
};
