exports.shorthands = undefined;

// An ordering over host shells, so a row can be asked whether it was rendered
// before or after the shell currently being served.
//
// The shell itself is identified by a hash of the host app's index HTML, which
// is the only thing the realm server can observe about a bundle it fetches
// over HTTP. A hash cannot be ordered, so it cannot answer "is this row's
// shell older than the current one" — the question every repair of
// deploy-skewed rows has to ask. This table supplies that ordering.
//
// One row, ever. `generation` advances by one each time a realm server
// observes a shell hash different from the one recorded here, and every
// server that observes the same shell reads back the same number. Advancing on
// *transition* rather than per distinct hash is what makes a rollback behave:
// redeploying a bundle that ran before is a new generation, higher than the
// one it is replacing, because the question is when a render happened and not
// which artifact is semantically newer.
//
// Seeded rather than left empty so the claim is always an UPDATE against an
// existing row — which is what makes concurrent claims safe without a lock.
// Generation 0 with an empty hash means "no shell observed yet", which no real
// hash can collide with.
exports.up = (pgm) => {
  pgm.createTable('host_shell_generation', {
    // Pinned to 1 by the constraint below: this table holds the current shell,
    // not a history of them.
    id: { type: 'integer', primaryKey: true },
    shell_hash: { type: 'varchar', notNull: true },
    generation: { type: 'integer', notNull: true },
    // Unix ms, as a bigint, matching `prerendered_html.rendered_at` and the
    // media-cache ledger (pg returns these as JS strings).
    observed_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint(
    'host_shell_generation',
    'host_shell_generation_singleton',
    { check: 'id = 1' },
  );
  pgm.sql(`
    INSERT INTO host_shell_generation (id, shell_hash, generation, observed_at)
    VALUES (1, '', 0, 0)
    ON CONFLICT (id) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('host_shell_generation');
};
