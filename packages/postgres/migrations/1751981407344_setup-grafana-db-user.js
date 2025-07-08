/* eslint-disable camelcase */

exports.shorthands = undefined;

const username = process.env.GRAFANA_DB_USER;

exports.up = (pgm) => {
  if (
    !['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }

  pgm.sql(`CREATE ROLE readonly_role`);
  pgm.sql(`GRANT CONNECT ON DATABASE your_database_name TO readonly_role`);
  pgm.sql(`GRANT USAGE ON SCHEMA public TO readonly_role`);
  pgm.sql(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`);
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_role`,
  );
  pgm.sql(`GRANT readonly_role TO ${username}`);
};

exports.down = (pgm) => {
  if (
    !['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }

  pgm.sql(`REVOKE readonly_role FROM ${username}`);
  pgm.sql(
    `REVOKE ALL PRIVILEGES ON DATABASE your_database_name FROM readonly_role`,
  );
  pgm.sql(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM readonly_role`);
  pgm.sql(
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM readonly_role`,
  );
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM readonly_role`,
  );
  pgm.sql(`DROP ROLE readonly_role`);
};
