// A lease saying "leave this concurrency group's jobs un-claimable until
// `expires_at`". The queue's claim query anti-joins against it, so a held
// group's jobs stay pending — still visible to coalescing, which merges an
// incoming job into a pending one — instead of being claimed the instant a
// worker is free.
//
// The one holder today is a bulk realm write. Coalescing helps most when the
// queue is backed up and not at all when workers are idle, so a large import
// on a quiet cluster gets no merging at all: each write's render pass is
// claimed and finished before the next write ends, and the same cards are
// re-rendered once per write. Holding the realm's render lane for the
// duration of the write gives the next pass something to merge into.
//
// `expires_at` rather than a plain flag because the holder can die mid-write:
// a lease that is not refreshed frees the lane on its own, so a crashed
// writer costs one lease interval rather than stalling the group for good.
//
// Keyed by holder as well as group so holds compose. A group is held while
// any live lease names it, and a holder only ever deletes its own row, so one
// holder finishing cannot free the group out from under another. Nothing
// takes two holds on one group today (same-realm writes serialize on the
// realm write lock), but a release that can revoke someone else's hold is the
// kind of thing that only shows up as a rare double render.
//
// Additive: a new table nothing reads until the code that writes it ships.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('job_claim_holds', {
    concurrency_group: { type: 'varchar', notNull: true },
    holder_id: { type: 'varchar', notNull: true },
    expires_at: { type: 'timestamp', notNull: true },
  });
  pgm.addConstraint('job_claim_holds', 'job_claim_holds_pkey', {
    primaryKey: ['concurrency_group', 'holder_id'],
  });
  // The claim query asks only "is any live lease naming this group?", on every
  // poll of every worker. The primary key's leading column already serves that
  // lookup; `expires_at` rides along so the answer never leaves the index.
  pgm.createIndex('job_claim_holds', ['concurrency_group', 'expires_at'], {
    name: 'job_claim_holds_live_group_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('job_claim_holds');
};
