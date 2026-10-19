// Checks that the read-only role used by dashboards and read-only database
// access, and every role that reads through it, can't read the tables withheld
// from it: `proxy_endpoints` and `incoming_webhooks`, which hold the platform's
// vendor keys and the secrets that verify incoming webhooks, and `user_keys`
// and `key_write_tickets`. The migrations that create or seal those tables
// revoke the SELECT grants made to the role and its members by name. SELECT
// granted to PUBLIC, or to another role a member also belongs to, still lets
// them read, and revoking it isn't a migration's call. So `up` asks
// `has_column_privilege` about every column of each table and stops, naming
// the role and the column, if any of those roles can still read one.
//
// The roles checked are `readonly_role` and every role that inherits its
// privileges or can SET ROLE to it, directly or through other roles. A member
// holding only the ADMIN option reads nothing through the role (on Postgres 16
// and later a non-superuser that creates `readonly_role` holds that membership), and
// a table's owner reads it by owning it, so neither is checked. The check
// covers what each role reads as itself; a member that can SET ROLE to some
// other role reads as that role.
//
// `readonly_role` exists only where it was provisioned (staging and
// production), so the check is skipped wherever it doesn't. The migration
// changes nothing, so `down` has nothing to undo.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      readable_by name;
      readable_table name;
      readable_column name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        WITH RECURSIVE reader (oid) AS (
          SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
          UNION
          SELECT membership.member
          FROM pg_auth_members membership
          JOIN reader ON reader.oid = membership.roleid
          WHERE membership.inherit_option OR membership.set_option
        )
        SELECT reader_role.rolname, tbl.relname, col.attname
          INTO readable_by, readable_table, readable_column
          FROM reader
          JOIN pg_roles reader_role ON reader_role.oid = reader.oid
          CROSS JOIN pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          WHERE tbl.oid IN (
              to_regclass('proxy_endpoints'),
              to_regclass('incoming_webhooks'),
              to_regclass('user_keys'),
              to_regclass('key_write_tickets')
            )
            AND reader.oid <> tbl.relowner
            AND col.attnum > 0
            AND NOT col.attisdropped
            AND has_column_privilege(reader.oid, tbl.oid, col.attnum, 'SELECT')
          ORDER BY tbl.relname, reader_role.rolname, col.attnum
          LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION
            '% can read %.%, which is withheld from readonly_role and the roles that read through it',
            readable_by, readable_table, readable_column
            USING HINT = format(
              'Revoke the grant or role membership that lets %I read %I.%I, then run the migration again.',
              readable_by, readable_table, readable_column
            );
        END IF;
      END IF;
    END
    $$
  `);
};

exports.down = () => {};
