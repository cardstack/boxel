// One `ai_batches` row per batch of AI requests an automation run submits to
// OpenRouter's Batch API (ADR 030). A batch can't be canceled, so it is paid
// for whatever happens to its run, and the row is what the settle job bills
// it from once it ends. Nothing is charged when the batch is submitted.
//
// `batch_id` is OpenRouter's id for the batch. `run_id` is the
// `automation_runs` row that submitted it, and `acts_as` the Matrix user id
// that run acted as, whom the batch is billed to. `realm` and
// `automation_id` are canonical identifiers (RRIs), as `automation_runs`
// spells them. They are copied here rather than joined, because a batch must
// still be billed after its run's row is gone: deleting a realm deletes its
// runs, and a batch submitted before that still settles.
//
// `model` is the model every request in the batch names. `request_count` is
// how many requests it holds. `estimated_usd` is the most the batch can cost:
// each request's input and output-token limit at the model's listed batch
// price, or its listed price when it has no batch listing. OpenRouter reports
// a batch's cost only once it ends, and only for one that completed, so the
// settle job bills this estimate for a batch that ends with no reported cost.
//
// `run_ai_reservations` holds the ids of the reservations the batch's requests
// took on the submitting run's AI spending cap (`ai_reservations` on
// `automation_runs`), each at twice the request's worst case at the model's
// listed price (ADR 030 §1.4). They hold against the cap until the batch is
// settled. A jsonb array of strings, as `jobs.initiated_by` is.
//
// `deadline` is how long the submitting script will wait for the results,
// at most 24 hours after submission. `expires_at` is when OpenRouter says
// the provider stops working on the batch, which can be later than the
// deadline.
//
// `state` is OpenRouter's status for the batch as last read (`validating`,
// `in_progress`, `finalizing`, `completed`, `failed`, `expired`, `cancelling`
// or `cancelled`), and `state_read_at` when it was read. It is not
// constrained to those values, so a status OpenRouter adds is still
// recorded. The partial index serves the search for batches that haven't
// reached a final status.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ai_batches (
      batch_id text PRIMARY KEY,
      run_id uuid NOT NULL,
      acts_as text NOT NULL,
      realm text NOT NULL,
      automation_id text NOT NULL,
      model text NOT NULL,
      request_count integer NOT NULL,
      estimated_usd numeric NOT NULL,
      run_ai_reservations jsonb NOT NULL DEFAULT '[]'::jsonb,
      deadline timestamptz NOT NULL,
      expires_at timestamptz,
      state text NOT NULL,
      state_read_at timestamptz NOT NULL DEFAULT now(),
      submitted_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_batches_request_count_check CHECK (request_count > 0),
      CONSTRAINT ai_batches_estimated_usd_check CHECK (estimated_usd >= 0)
    )
  `);
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS ai_batches_run_idx ON ai_batches (run_id)`,
  );
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ai_batches_open_idx
      ON ai_batches (submitted_at)
      WHERE state NOT IN ('completed', 'failed', 'expired', 'cancelled')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS ai_batches`);
};
