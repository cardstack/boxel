// Takes `pipeline` out of the modes a `key_uses` row may record, once no task
// that predates the `automation` name is serving. The additive migration
// `allow-automation-key-use-mode` allows both and rewrites the rows that
// existed when it ran; this rewrites any a departing task recorded since,
// folding a collapsed refusal row into its twin under the new mode as that
// migration does. `down` allows `pipeline` again and leaves the rows as they
// are.

function rewriteMode(pgm, from, to) {
  pgm.sql(`
    WITH folded AS (
      UPDATE key_uses target
         SET count = target.count + source.count,
             created_at = GREATEST(target.created_at, source.created_at)
        FROM key_uses source
       WHERE source.mode = '${from}'
         AND target.mode = '${to}'
         AND source.refusal_window IS NOT NULL
         AND target.refusal_window = source.refusal_window
         AND source.share_id IS NOT DISTINCT FROM target.share_id
         AND source.key_id IS NOT DISTINCT FROM target.key_id
         AND source.realm_url = target.realm_url
         AND source.operation = target.operation
         AND source.caller IS NOT DISTINCT FROM target.caller
         AND source.code IS NOT DISTINCT FROM target.code
         AND source.status IS NOT DISTINCT FROM target.status
         AND source.host IS NOT DISTINCT FROM target.host
      RETURNING source.id
    )
    DELETE FROM key_uses WHERE id IN (SELECT id FROM folded)
  `);
  pgm.sql(`UPDATE key_uses SET mode = '${to}' WHERE mode = '${from}'`);
}

function setModeCheck(pgm, modes) {
  pgm.sql(`ALTER TABLE key_uses DROP CONSTRAINT IF EXISTS key_uses_mode_check`);
  pgm.sql(
    `ALTER TABLE key_uses ADD CONSTRAINT key_uses_mode_check CHECK (mode IN ${modes})`,
  );
}

exports.up = (pgm) => {
  rewriteMode(pgm, 'pipeline', 'automation');
  setModeCheck(pgm, `('interactive', 'automation')`);
};

exports.down = (pgm) => {
  setModeCheck(pgm, `('interactive', 'pipeline', 'automation')`);
};
