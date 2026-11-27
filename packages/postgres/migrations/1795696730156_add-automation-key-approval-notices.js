// One row per person an automation waiting for key approval waits on, other
// than its payer: a key approval notice, which the app counts in its API Keys
// badge and the secure origin's key page lists.
//
// `operations` are the operations the recipient is asked about, each as
// `{ operation, targetType: { module, name }, destination, ask }`, where
// `destination` is the origin and path the operation sends to and `ask` is
// `approve` when the recipient's key serves the operation and the recipient's
// approval of the automation is missing, or `share-a-key` when no share in the
// realm has a key for the operation's `{{apiKey}}` slot and the recipient, a
// direct writer of the realm, can share one.
//
// `automation_url` and `realm_url` are the automation's card and its realm as
// URLs, which the key page links to and names.
//
// A row goes with its automation (`ON DELETE CASCADE`), and the realm server
// rewrites an automation's rows each time it checks the automation's key
// approvals: a recipient no longer waited on loses the row, and one asked
// about an operation the row didn't name before gets it unread again.
// `read_at` is when the recipient's key page first listed it.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_key_approval_notices (
      id bigserial PRIMARY KEY,
      automation_id text NOT NULL
        REFERENCES automations (automation_id) ON DELETE CASCADE,
      recipient text NOT NULL,
      automation_url text NOT NULL,
      realm_url text NOT NULL,
      operations jsonb NOT NULL,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT automation_key_approval_notices_once
        UNIQUE (automation_id, recipient)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_key_approval_notices_recipient_idx
      ON automation_key_approval_notices (recipient, created_at)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_key_approval_notices`);
};
