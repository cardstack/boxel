// A system key's own response size cap, in bytes: the realm server holds every
// response on that key to it in place of the system-key path's cap. Null, the
// default, leaves the key on the path's cap. Operators set and clear it with
// `boxel realm-server keys set-response-cap`, and each change is recorded in
// `proxy_endpoint_history` as a `set-response-cap` entry carrying the cap it
// set (null for a cleared one).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE proxy_endpoints
      ADD COLUMN IF NOT EXISTS response_size_cap_bytes bigint
        CHECK (response_size_cap_bytes > 0);

    ALTER TABLE proxy_endpoint_history
      ADD COLUMN IF NOT EXISTS response_size_cap_bytes bigint;

    ALTER TABLE proxy_endpoint_history
      DROP CONSTRAINT IF EXISTS proxy_endpoint_history_action_check;
    ALTER TABLE proxy_endpoint_history
      ADD CONSTRAINT proxy_endpoint_history_action_check
        CHECK (action IN ('add', 'replace', 'delete', 'set-response-cap'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM proxy_endpoint_history WHERE action = 'set-response-cap';
    ALTER TABLE proxy_endpoint_history
      DROP CONSTRAINT IF EXISTS proxy_endpoint_history_action_check;
    ALTER TABLE proxy_endpoint_history
      ADD CONSTRAINT proxy_endpoint_history_action_check
        CHECK (action IN ('add', 'replace', 'delete'));
    ALTER TABLE proxy_endpoint_history
      DROP COLUMN IF EXISTS response_size_cap_bytes;
    ALTER TABLE proxy_endpoints
      DROP COLUMN IF EXISTS response_size_cap_bytes;
  `);
};
