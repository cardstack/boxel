exports.shorthands = undefined;

// Scheduling advice only; no existing output or publication receipt changes.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE lattice_owners
    ADD COLUMN liveness_tier text CHECK (liveness_tier IN ('visible','background','progress')),
    ADD COLUMN published_at timestamptz,
    ADD COLUMN dirty_since timestamptz,
    ADD COLUMN membership_dirty boolean NOT NULL DEFAULT false`);
};
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE lattice_owners DROP COLUMN membership_dirty,
    DROP COLUMN dirty_since, DROP COLUMN published_at, DROP COLUMN liveness_tier`);
};
