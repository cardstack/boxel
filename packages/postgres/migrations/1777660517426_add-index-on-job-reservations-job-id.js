exports.shorthands = undefined;

// Postgres does not auto-create an index on FK columns. Several pg-queue
// queries filter `job_reservations` by `job_id` (the new abandon-after-N
// claim path counts prior reservations per job; existing eligibility,
// monitor, and finalize paths all also have `WHERE job_id = ...` clauses).
// Without an index they all full-scan the table, which becomes a
// bottleneck once `job_reservations` grows past a few thousand rows.
exports.up = (pgm) => {
  pgm.createIndex('job_reservations', 'job_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('job_reservations', 'job_id');
};
