// A `key_uses` row records whether the use was interactive (a card opened in
// the browser, the AI assistant or the CLI) or an automation's: a run the
// realm server makes on its own, for the run's payer. This lets `mode` be
// `automation` and rewrites the rows recorded as `pipeline`, the earlier name
// for the same runs. `pipeline` stays allowed so a task that predates the name
// can still record its uses during a rollout; the removal-phase migration
// `require-automation-key-use-mode` takes it out once no such task serves.
//
// A collapsed refusal row (one with a `refusal_window`) that already has a
// twin under the new mode is folded into it, adding its `count` and keeping
// the later `created_at`, since the unique index on refusal windows keys the
// mode and would refuse the rewrite. `down` folds and rewrites the other way.

const MODES = {
  up: `('interactive', 'pipeline', 'automation')`,
  down: `('interactive', 'pipeline')`,
};

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
  setModeCheck(pgm, MODES.up);
  rewriteMode(pgm, 'pipeline', 'automation');
};

exports.down = (pgm) => {
  rewriteMode(pgm, 'automation', 'pipeline');
  setModeCheck(pgm, MODES.down);
};
