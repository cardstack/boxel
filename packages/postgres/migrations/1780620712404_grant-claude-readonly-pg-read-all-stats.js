// Grants the Claude read-only DB user the built-in `pg_read_all_stats` role.
//
// Without this grant, `claude_readonly_user` sees `<insufficient privilege>`
// for the `query` and `state` columns of every other backend in
// `pg_stat_activity` (and the other system statistics views). That masking
// hides the SQL a worker backend is actually running, which is exactly the
// information needed to diagnose a stuck or slow query during an indexing
// incident. `pg_read_all_stats` is a read-only stats-visibility grant: it
// lifts the masking on the statistics views without conferring any
// data-write or table-read privilege.
//
// The grant target reuses CLAUDE_DB_USER (the same source the
// claude-readonly-db-user migration created the role from), so the GRANT
// always lands on the role that exists in the deployed environment.

const username = process.env.CLAUDE_DB_USER;

// Conservative PostgreSQL identifier check. The username is interpolated
// into raw SQL for GRANT / REVOKE below, so anything outside this
// character set is rejected before it can become a SQL injection or a
// silent-corruption hazard. PostgreSQL itself allows up to NAMEDATALEN-1
// (63) characters in an identifier; this regex matches that limit and
// disallows the leading-digit / quoted-identifier variants we don't use.
const VALID_PG_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function ensureProvisioningEnv() {
  if (!username) {
    throw new Error(
      'CLAUDE_DB_USER must be set in staging/production. The infra side ' +
        'surfaces it from SSM into the pg-migration ECS task; if the ' +
        'migration is running without it set, that wiring has not landed yet.',
    );
  }
  if (!VALID_PG_IDENTIFIER.test(username)) {
    throw new Error(
      `CLAUDE_DB_USER (${JSON.stringify(username)}) does not match the ` +
        'allowed PostgreSQL identifier pattern [A-Za-z_][A-Za-z0-9_]{0,62}. ' +
        'Refusing to interpolate it into a GRANT / REVOKE statement.',
    );
  }
}

exports.up = (pgm) => {
  if (
    !['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }
  ensureProvisioningEnv();

  pgm.sql(`GRANT pg_read_all_stats TO "${username}"`);
};

exports.down = (pgm) => {
  if (
    !['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }
  ensureProvisioningEnv();

  pgm.sql(`REVOKE pg_read_all_stats FROM "${username}"`);
};
