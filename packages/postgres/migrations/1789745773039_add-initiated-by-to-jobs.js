exports.shorthands = undefined;

// The matrix users whose writes a job is indexing, so a gate can ask whether
// anything of *its own* writer's is outstanding rather than whether the lane
// is occupied. The in-process view of this already exists and already scopes
// the read path's read-your-writes drain; it lives on a map entry in one
// replica's memory, so no other replica can read it. Behind a load balancer
// that makes the wait realm-wide again: every replica sees every other
// replica's pending pass, and one card's fan-out holds every writer in the
// realm.
//
// A set rather than one name, because index passes coalesce. A publish that
// merges into a pending job adds itself here, so the row answers the question
// for every writer waiting on it. Recording only whoever got there first would
// make a writer whose pass was absorbed into someone else's job invisible to
// its own gate, and it would not wait for indexing of bytes it wrote.
//
// A jsonb array rather than a `text[]`: no table in this schema uses a real
// postgres array, because the query builder binds an object-valued parameter
// as JSON, so an array column would need a binding path of its own. `deps` and
// `types` on the index tables are the same shape for the same reason, and
// membership reads as containment, the spelling `types` is already queried
// with.
//
// Nullable, and a null reads as the realm owner rather than as nobody: rows
// written before this column existed, and passes no HTTP write produced — the
// file watcher, GC — still gate somebody, and the owner is the identity a
// system-originated pass is closest to. The consequence is worth stating: the
// owner pays for those passes and no other writer does.
exports.up = (pgm) => {
  pgm.addColumn('jobs', {
    initiated_by: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('jobs', 'initiated_by');
};
