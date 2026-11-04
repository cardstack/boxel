// Lets the read-only role used by dashboards and read-only database access
// read `key_shares` and `key_bindings`. Neither holds a secret: a share names
// the key it holds, the realm it's shared into, its label and its limits, and
// a binding names the operation it fills, the slot, the key or share behind it
// and how it was approved. Reading them is what explains, without the
// application role, why a card's call isn't ready: which share a realm has and
// whether its operations are bound to it.
//
// The key values stay withheld: they live in `user_keys`, which this leaves
// alone, along with the other key tables.
//
// `readonly_role` exists only where it was provisioned (staging and
// production), so the grant is skipped wherever it doesn't. GRANT is
// idempotent, so running `up` again changes nothing.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        GRANT SELECT ON TABLE key_shares, key_bindings TO readonly_role;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        REVOKE SELECT ON TABLE key_shares, key_bindings FROM readonly_role;
      END IF;
    END
    $$
  `);
};
