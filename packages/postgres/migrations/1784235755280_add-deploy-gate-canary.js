exports.shorthands = undefined;

// TEMPORARY — deployment-gate verification canary. Adds a throwaway column so a
// paired removal migration (migrations-removal/1784235755281_drop-deploy-gate-canary)
// can exercise a genuine DROP of a real column through the post-deploy removal
// phase. Nothing reads this column, so adding/dropping it has no serving impact.
// This migration and its pair exist only on the deploy-gate-canary-cs-12113
// branch for staging verification — they must never merge to main.

exports.up = (pgm) => {
  pgm.addColumn(
    'boxel_index',
    { deploy_gate_canary: { type: 'text' } },
    { ifNotExists: true },
  );
};

exports.down = (pgm) => {
  pgm.dropColumn('boxel_index', 'deploy_gate_canary', { ifExists: true });
};
