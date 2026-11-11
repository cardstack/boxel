// A run's AI spending, in credits, held against its automation's AI spending
// cap (ADR 029 §1.5).
//
// `ai_credits_reserved` is the most the run's AI requests in flight can cost:
// each request reserves its worst case before it is sent. `ai_credits_spent`
// is what its finished requests cost. A request is refused when spent plus
// reserved plus its own worst case would pass the cap, and when it finishes
// its reservation is released and its actual cost added to spent. Both are
// credits, which an AI request's cost need not be a whole number of, so they
// are `numeric`.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS ai_credits_spent numeric NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_credits_reserved numeric NOT NULL DEFAULT 0
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS ai_credits_spent,
      DROP COLUMN IF EXISTS ai_credits_reserved
  `);
};
