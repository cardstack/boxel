// Large existing tables must remain writable while these indexes build.
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql("SET lock_timeout = '2s'");
  // A cancelled CONCURRENTLY build can leave an invalid index behind; a
  // retry must replace it rather than let IF NOT EXISTS declare success.
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS boxel_index_valid_until');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS lattice_delivery_active_user');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS jobs_source_latest');
  pgm.sql(`CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_valid_until
    ON boxel_index (realm_url, valid_until) WHERE valid_until IS NOT NULL`);
  pgm.sql(`CREATE INDEX CONCURRENTLY IF NOT EXISTS lattice_delivery_active_user
    ON lattice_publication_deliveries (user_id, lease_until)
    WHERE delivered_at IS NULL AND terminal_reason IS NULL`);
  pgm.sql(`CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_source_latest
    ON jobs (concurrency_group, id DESC)
    WHERE job_type IN ('incremental-index','from-scratch-index','copy-index')`);
  pgm.sql('RESET lock_timeout');
};
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS jobs_source_latest');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS lattice_delivery_active_user');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS boxel_index_valid_until');
};
