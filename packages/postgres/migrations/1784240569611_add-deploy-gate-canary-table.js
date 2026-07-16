exports.shorthands = undefined;

// TEMPORARY — deployment-gate verification canary. Creates a standalone
// throwaway table so a paired removal migration can exercise a genuine DROP
// through the post-deploy removal phase.
//
// A standalone table (NOT a column on boxel_index) is deliberate: the indexer
// does `SELECT * FROM boxel_index` and mirrors the row shape into its twin
// boxel_index_working, so adding a column to one of those twins breaks index
// writes. A separate table is invisible to the indexer. This branch is a
// verification harness and must never merge to main.

exports.up = (pgm) => {
  pgm.createTable(
    'deploy_gate_canary',
    { note: { type: 'text' } },
    { ifNotExists: true },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('deploy_gate_canary', { ifExists: true });
};
