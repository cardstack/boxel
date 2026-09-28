// The lane family a job's concurrency group belongs to. A group alone names one
// lane: the claim query runs one job per group, and a group can say nothing
// about which other groups a job must not run beside. So a group cannot
// describe a realm's index as several writer lanes plus exclusive work that
// excludes them all, and a reader matching one group string sees one lane of
// it. This column records the set a lane belongs to, which lets the claim
// query exclude across it and lets a reader of a realm's lane — readiness, the
// settle gate, cancel and teardown, publish progress — ask about all of it.
//
// A family groups lanes. Its exclusive work runs in a group named for the
// family and excludes every other member; its writer lanes are groups of their
// own that record the family here and run alongside each other. Readers match
// the group or this column, so they see the whole family.
//
// Nullable, and a null reads as exclusive work in a family named by the row's
// own group. That is every row written before this column existed and every
// job published without a family, so nothing needs backfilling, and a worker
// that predates the column claims exactly the rows it always could: it treats
// every group as a lane of its own, which is what an exclusive group is.
//
// The partial index mirrors `jobs_unfulfilled_concurrency_group_idx`: a
// family reader asks `concurrency_group = F OR lane_family = F` over the
// queue's live rows, and each side of the OR is answered from its own index.
// Built CONCURRENTLY for the same reason as that one, which is also why the
// migration runs outside a transaction and why the column add is guarded: an
// interrupted run re-applies from the top.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.addColumn(
    'jobs',
    {
      lane_family: { type: 'varchar' },
    },
    { ifNotExists: true },
  );
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS jobs_unfulfilled_lane_family_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY jobs_unfulfilled_lane_family_idx
      ON jobs (lane_family)
      WHERE status = 'unfulfilled';
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS jobs_unfulfilled_lane_family_idx;`,
  );
  pgm.dropColumn('jobs', 'lane_family');
};
