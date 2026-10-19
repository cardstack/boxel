exports.shorthands = undefined;

// `proxy_endpoints.api_key` and `incoming_webhooks.signing_secret` are the
// plain-text copies of the platform's vendor keys and webhook signing secrets.
// Nothing reads or writes them: every key and secret is held in its sealed
// columns. Drop them.
//
// A row whose value is only in plain text, or whose sealed value is missing
// any of its four parts (so a read can't open it), would lose it, so `up`
// stops and names the table instead. Every application write seals its whole
// value, so such a row was written outside the application. Give it its value
// again through the application (`boxel realm-server keys replace` for a
// system key, rotating the secret for a webhook) and run `up` again.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      unsealed bigint;
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'proxy_endpoints' AND column_name = 'api_key'
      ) THEN
        SELECT COUNT(*) INTO unsealed FROM proxy_endpoints
          WHERE api_key IS NOT NULL
            AND (api_key_ciphertext IS NULL OR api_key_nonce IS NULL
              OR api_key_tag IS NULL OR api_key_key_id IS NULL);
        IF unsealed > 0 THEN
          RAISE EXCEPTION
            'proxy_endpoints has % row(s) whose api_key is not sealed; replace each key so it is sealed before dropping the column',
            unsealed;
        END IF;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'incoming_webhooks'
          AND column_name = 'signing_secret'
      ) THEN
        SELECT COUNT(*) INTO unsealed FROM incoming_webhooks
          WHERE signing_secret IS NOT NULL
            AND (signing_secret_ciphertext IS NULL
              OR signing_secret_nonce IS NULL OR signing_secret_tag IS NULL
              OR signing_secret_key_id IS NULL);
        IF unsealed > 0 THEN
          RAISE EXCEPTION
            'incoming_webhooks has % row(s) whose signing_secret is not sealed; rotate each secret so it is sealed before dropping the column',
            unsealed;
        END IF;
      END IF;
    END $$
  `);
  pgm.sql(`ALTER TABLE proxy_endpoints DROP COLUMN IF EXISTS api_key`);
  pgm.sql(`ALTER TABLE incoming_webhooks DROP COLUMN IF EXISTS signing_secret`);
};

// Restore the columns empty, in the shape a revision that reads them
// expects, since the plain-text values are gone. `signing_secret` comes back
// nullable: the rows already present have no value to give it.
//
// A revision that reads these columns treats them as the source, so starting
// one against rows the current revision wrote loses secrets, whether that is
// a rollback past this migration or one before it (the realm server's rollout
// failing and its tasks rolling back before this migration runs): its startup
// backfill empties the sealed columns of a proxy endpoint with no plain-text
// key, and it can't verify a webhook with no plain-text secret. After either,
// add again every system key written since the current revision rolled out
// (`boxel realm-server keys list` and the `proxy_endpoint_history` entries
// show which) and rotate every webhook secret issued since then; after a
// rollback past this migration, that is every key and secret.
exports.down = (pgm) => {
  pgm.sql(
    `ALTER TABLE proxy_endpoints ADD COLUMN IF NOT EXISTS api_key varchar`,
  );
  pgm.sql(
    `ALTER TABLE incoming_webhooks ADD COLUMN IF NOT EXISTS signing_secret text`,
  );
};
