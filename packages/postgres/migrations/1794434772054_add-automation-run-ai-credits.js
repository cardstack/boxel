// A run's AI spending, in credits, held against its automation's AI spending
// cap (ADR 029 §1.5).
//
// `ai_credits_reserved` is the most the run's AI requests in flight can cost:
// each request reserves its worst case before it is sent, held in
// `ai_reservations` under the reservation's id, and `ai_credits_reserved` is
// their sum. `ai_credits_spent` is what its finished requests cost. A request
// is refused when spent plus reserved plus its own worst case would pass the
// cap. When it finishes, its reservation is removed and its actual cost added
// to spent, so a reservation settles once. Credits needn't be whole for an AI
// request, so they are `numeric`.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS ai_credits_spent numeric NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_credits_reserved numeric NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_reservations jsonb NOT NULL DEFAULT '{}'::jsonb
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS ai_credits_spent,
      DROP COLUMN IF EXISTS ai_credits_reserved,
      DROP COLUMN IF EXISTS ai_reservations
  `);
};
