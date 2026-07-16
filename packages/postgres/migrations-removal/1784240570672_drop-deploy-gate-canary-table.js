exports.shorthands = undefined;

// TEMPORARY — deployment-gate verification canary (paired with the
// add-deploy-gate-canary-table migration). Drops the standalone throwaway table
// from the post-deploy removal phase, so a genuine DROP TABLE runs only after
// the previous realm-server tasks have drained. This branch is a verification
// harness and must never merge to main.

exports.up = (pgm) => {
  pgm.dropTable('deploy_gate_canary', { ifExists: true });
};

exports.down = (pgm) => {
  pgm.createTable(
    'deploy_gate_canary',
    { note: { type: 'text' } },
    { ifNotExists: true },
  );
};
