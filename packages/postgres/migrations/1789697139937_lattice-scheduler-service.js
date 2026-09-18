exports.shorthands = undefined;

// Advisory scheduling history, not indexed data or a freshness receipt.
exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE lattice_scheduler_service (
    realm_url text PRIMARY KEY,
    state jsonb NOT NULL
  )`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE lattice_scheduler_service');
};
