// Validates the charge-reference CHECK on `credits_ledger`, adds the index
// that makes a charge write once (ADR 029 §1.6), and indexes `run_id` so a
// run's charges read back together.
//
// A charge whose reference names exactly one charge (run, run indexing,
// storage, batched AI) is identified by its kind and reference. It writes one
// row per credit bucket it draws from, so the unique key is the identity plus
// the credit type. `spendCredits` serializes a charge's identity and checks for
// it before writing; this index is the database's own guarantee that two
// writers of the same charge can't both land a row in the same bucket. AI
// charges are one per call, with no identity, and are outside it.
//
// Both steps run outside a transaction so neither blocks the ledger's writes:
// VALIDATE CONSTRAINT takes a lock that allows inserts, and the index is
// built CONCURRENTLY. node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure. An interrupted CONCURRENTLY
// build leaves an INVALID index under the target name, so the CREATE is
// preceded by an unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    ALTER TABLE credits_ledger
      VALIDATE CONSTRAINT credits_ledger_charge_reference_check
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS credits_ledger_charge_once_idx`);
  pgm.sql(`
    CREATE UNIQUE INDEX CONCURRENTLY credits_ledger_charge_once_idx
      ON credits_ledger (
        charge_kind, run_id, batch_id, automation_id, charge_day, credit_type
      ) NULLS NOT DISTINCT
      WHERE charge_kind IN ('run', 'run_indexing', 'storage', 'batched_ai')
  `);
  // A run's charges, of every kind, read back together.
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS credits_ledger_run_id_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY credits_ledger_run_id_idx
      ON credits_ledger (run_id) WHERE run_id IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS credits_ledger_run_id_idx`);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS credits_ledger_charge_once_idx`);
};
