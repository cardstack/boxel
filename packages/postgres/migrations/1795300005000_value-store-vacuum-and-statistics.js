// Autovacuum and analyze for the value store's tables (add-boxel-index-values),
// set on the tables, as search-tables-vacuum-and-statistics set them for the
// search tables. That migration came before the value store, whose tables
// kept Postgres's defaults: analyze when a tenth of a table's rows have
// changed. The value rows table holds every realm's cards (3.4 million rows
// on the bench), so a realm's new or rewritten rows could stay out of the
// planner's statistics for a long time, and a value-store statement planned
// without them reads by guesses. The value tables now vacuum at 5% dead and
// analyze at 2% changed, with the same floors.

exports.shorthands = undefined;

const VALUE_TABLES = [
  'boxel_index_values',
  'boxel_index_value_cards',
  'boxel_index_value_types',
  'boxel_index_value_paths',
  'boxel_index_value_realms',
];

const VACUUM = `autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05`;
const VACUUM_KEYS = `autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold, autovacuum_vacuum_insert_scale_factor`;

exports.up = (pgm) => {
  for (let table of VALUE_TABLES) {
    pgm.sql(`ALTER TABLE ${table} SET (${VACUUM});`);
  }
};

exports.down = (pgm) => {
  for (let table of VALUE_TABLES) {
    pgm.sql(`ALTER TABLE ${table} RESET (${VACUUM_KEYS});`);
  }
};
