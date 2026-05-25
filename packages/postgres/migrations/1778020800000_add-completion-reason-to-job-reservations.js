exports.shorthands = undefined;

// Distinguishes *why* a job_reservations row closed so the per-job
// reservation cap (MAX_RESERVATION_COUNT_PER_JOB in pg-queue.ts) doesn't
// burn attempts on operational interruptions.
//
//   NULL          - reservation still open (locked_until > NOW()) OR a
//                   lease expired without the worker getting a chance to
//                   finalize (rare; pre-migration rows; SIGKILL'd worker
//                   whose connection has not yet dropped).
//   'completed'   - genuine attempt: worker ran the job to a verdict
//                   (resolved or rejected). Counts toward the cap.
//   'interrupted' - operational interruption: child crash, manager
//                   SIGTERM, autoscaler scale-in. Does NOT count toward
//                   the cap.
//   'timeout-expired' - reserved for the future pg-pid reaper that
//                   reclaims leases when the worker's PG connection
//                   dies. Treated like 'interrupted' for cap purposes.
exports.up = (pgm) => {
  pgm.addColumn('job_reservations', {
    completion_reason: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('job_reservations', 'completion_reason');
};
