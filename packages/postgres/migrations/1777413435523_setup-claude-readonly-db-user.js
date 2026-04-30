// Provisions a dedicated read-only DB user for Claude Code (CS-10962).
//
// Why a separate user from `grafana`:
//   - Audit clarity: pg_stat_activity / slow-query logs distinguish Grafana
//     dashboard traffic from Claude triage traffic.
//   - Independent lifecycle: rotating Grafana's password (or revoking
//     Grafana access) doesn't break Claude, and vice versa.
//   - Future-proofing: Claude-specific grants (pg_stat_statements,
//     EXPLAIN-only views, etc.) can be added without enlarging Grafana's
//     surface area.
//
// The new user inherits from the existing `readonly_role` (created in
// 1751981407344_setup-grafana-db-user.js), so the SELECT-on-public grants
// stay defined exactly once. If anyone widens or narrows what's read-only,
// both Grafana and Claude pick up the change automatically.

const username = process.env.CLAUDE_DB_USER;
const password = process.env.CLAUDE_DB_PASSWORD;

// Conservative PostgreSQL identifier check. The username is interpolated
// into raw SQL for GRANT / REVOKE below, so anything outside this
// character set is rejected before it can become a SQL injection or a
// silent-corruption hazard. PostgreSQL itself allows up to NAMEDATALEN-1
// (63) characters in an identifier; this regex matches that limit and
// disallows the leading-digit / quoted-identifier variants we don't use.
const VALID_PG_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function ensureProvisioningEnv() {
  if (!username || !password) {
    throw new Error(
      'CLAUDE_DB_USER and CLAUDE_DB_PASSWORD must both be set in ' +
        'staging/production. The infra side of CS-10962 surfaces these ' +
        'from SSM into the pg-migration ECS task; if the migration is ' +
        'running without them set, that wiring has not landed yet.',
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

  pgm.createRole(username, {
    login: true,
    password: password,
    inherit: true,
    superuser: false,
    createdb: false,
    createrole: false,
    bypassrls: false,
  });
  pgm.sql(`GRANT readonly_role TO "${username}"`);
};

exports.down = (pgm) => {
  if (
    !['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }
  ensureProvisioningEnv();

  pgm.sql(`REVOKE readonly_role FROM "${username}"`);
  pgm.dropRole(username);
};
