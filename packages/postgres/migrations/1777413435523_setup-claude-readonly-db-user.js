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

exports.up = (pgm) => {
  if (
    !['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }

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

  pgm.sql(`REVOKE readonly_role FROM "${username}"`);
  pgm.dropRole(username);
};
