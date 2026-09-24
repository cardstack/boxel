exports.shorthands = undefined;

// The ledger of committed index passes: one row per commit of a realm's index
// swap. `realm_generations.current_generation` holds only the newest
// generation; this records what each recent one was — the pass and job that
// took it, the URLs its commit promoted, and the committed generation the pass
// had started from. A pass allocates its generation at commit, under a
// per-realm commit lock, so the rows of one realm follow commit order.
//
// `urls` lists the rows the commit promoted and `render_only_urls` the
// render-only dependents it restamped without promoting. Both are NULL for a
// full-realm pass (a from-scratch index or a copy) and for a pass that moved
// too many rows to list; NULL reads as every URL in the realm. Each commit
// deletes its own realm's rows older than the retention window, which the
// `(realm_url, committed_at)` index serves. `(realm_url, pass_id)` serves the
// lookups that wait on a particular pass having committed: a job id can commit
// more than once when its job reruns, so a pass is identified by `pass_id`.
// `committed_at` is epoch milliseconds.
exports.up = (pgm) => {
  pgm.createTable('realm_index_commits', {
    realm_url: { type: 'varchar', notNull: true },
    generation: { type: 'integer', notNull: true },
    base_generation: { type: 'integer', notNull: true },
    pass_id: { type: 'varchar', notNull: true },
    job_id: { type: 'integer' },
    urls: { type: 'jsonb' },
    render_only_urls: { type: 'jsonb' },
    full_realm: { type: 'boolean', notNull: true, default: false },
    committed_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('realm_index_commits', 'realm_index_commits_pkey', {
    primaryKey: ['realm_url', 'generation'],
  });
  pgm.createIndex('realm_index_commits', ['realm_url', 'committed_at']);
  pgm.createIndex('realm_index_commits', ['realm_url', 'pass_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('realm_index_commits');
};
