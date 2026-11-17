// One row: the boot key under which the modules table's rows were derived.
// A realm server that boots with the same key keeps the table rather than
// clearing it (realm-server/lib/definition-cache-key.ts). Losing the row only
// costs a clear on the next boot, as every boot used to. `set_at` is when the
// key last changed and `settled_set_at` the `set_at` the post-deployment hook
// last saw, so the hook clears once after a deploy that changed the key.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS definition_cache_key (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      key text NOT NULL,
      set_at bigint NOT NULL,
      settled_set_at bigint
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS definition_cache_key`);
};
