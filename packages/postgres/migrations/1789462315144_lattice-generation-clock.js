exports.up = (pgm) => {
  // This durable clock also fixes recovery for ordinary realms.
  // SET LOGGED takes an ACCESS EXCLUSIVE lock; schedule the migration accordingly.
  pgm.sql('ALTER TABLE realm_generations SET LOGGED');
  // A previous crash may have lost the old UNLOGGED clock while retaining
  // published renderings. Never reuse a generation already served to clients.
  // Preserve the floor from retained index artifacts for ordinary realms too.
  pgm.sql(`
    WITH repaired AS (
    INSERT INTO realm_generations (realm_url, current_generation)
    SELECT realm_url, MAX(generation) FROM (
      SELECT realm_url, generation FROM realm_meta
      UNION ALL
      SELECT realm_url, generation FROM prerendered_html
      UNION ALL
      SELECT realm_url, generation FROM boxel_index
    ) published GROUP BY realm_url
    ON CONFLICT (realm_url) DO UPDATE SET current_generation = EXCLUDED.current_generation
      WHERE realm_generations.current_generation < EXCLUDED.current_generation
    RETURNING realm_url
    )
    DELETE FROM realm_meta WHERE realm_url IN (SELECT realm_url FROM repaired)
  `);
  // A prior recovery may already have restored the clock after losing the
  // index. Do not mistake the retained summary for a surviving index. A truly
  // empty realm may rebuild once on upgrade; subsequent empty commits have a
  // valid summary and do not rebuild on every mount.
  pgm.sql(`
    DELETE FROM realm_meta rm WHERE NOT EXISTS (
      SELECT 1 FROM boxel_index i WHERE i.realm_url = rm.realm_url
    )
  `);
  // This is derived data, written in the same transaction as boxel_index.
  // Its presence at the durable clock identifies a completed index, including
  // an empty realm. Losing both on crash tells startup to rebuild.
  pgm.sql('ALTER TABLE realm_meta SET UNLOGGED');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE realm_meta SET LOGGED');
  pgm.sql('ALTER TABLE realm_generations SET UNLOGGED');
  // A rollback never lowers the repaired generation floor.
};
