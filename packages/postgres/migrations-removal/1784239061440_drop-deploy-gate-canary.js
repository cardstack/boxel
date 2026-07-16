exports.shorthands = undefined;

// TEMPORARY — deployment-gate verification canary (paired with
// migrations/1784235755280_add-deploy-gate-canary). Lives in the removal phase,
// so the deploy runs this DROP only after the previous realm-server tasks have
// drained — exercising a genuine drop of a real column through the post-deploy
// removal phase, with no serving impact (nothing reads the column). This branch
// is a verification harness and must never merge to main.

exports.up = (pgm) => {
  pgm.dropColumn('boxel_index', 'deploy_gate_canary', { ifExists: true });
};

exports.down = (pgm) => {
  pgm.addColumn(
    'boxel_index',
    { deploy_gate_canary: { type: 'text' } },
    { ifNotExists: true },
  );
};
