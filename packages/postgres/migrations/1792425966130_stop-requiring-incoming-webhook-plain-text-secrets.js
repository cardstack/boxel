// A webhook's signing secret is held only in its sealed columns, and the realm
// server writes rows without `incoming_webhooks.signing_secret`. The column
// stays until a removal migration drops it, once no running revision reads
// it, so meanwhile it accepts a row written without it.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE incoming_webhooks ALTER COLUMN signing_secret DROP NOT NULL
  `);
};

// The column is required again only when every row still has a plain-text
// secret, since a row written without one can't be given its value back. A
// database where the column is already dropped is left as it is.
exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'incoming_webhooks'
          AND column_name = 'signing_secret'
      ) AND NOT EXISTS (
        SELECT 1 FROM incoming_webhooks WHERE signing_secret IS NULL
      ) THEN
        ALTER TABLE incoming_webhooks ALTER COLUMN signing_secret SET NOT NULL;
      END IF;
    END $$
  `);
};
