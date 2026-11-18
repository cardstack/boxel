// `platform_secrets` holds secrets the platform itself keeps and only ever
// reads, such as the secret that verifies a vendor's signed webhook. Each is
// named (`name`, such as `openrouter-batch-webhook-signing`) and sealed on the
// row (`value_*`, field `platform_secrets.value`, the platform as owner, bound
// to the row and its name). The table has no destination: nothing sends these
// secrets anywhere, and nothing on the outbound path reads the table. `note`
// and `updated_at` say who last set the secret, by the operator's own
// account, and when.
//
// `platform_secret_history` is the audit trail: one row per set or delete,
// with the secret it touched (its row id and its name), the operator's note,
// the data key its value was sealed under, and what the server observed of
// the caller: its address and when its operator token was signed
// (`token_issued_at`, seconds since the epoch). It never holds a value.
// `secret_id` has no foreign key, so a deleted secret keeps its history; a
// secret set again under the same name has a new id, and its name joins the
// two.
//
// `platform_secrets` is withheld from the read-only role, as
// `platform_oauth_clients` is, and from every role that reads with its
// privileges, by the same steps. Both tables are excluded from the SQLite
// schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS platform_secrets (
      id uuid PRIMARY KEY,
      name varchar NOT NULL UNIQUE,
      value_ciphertext bytea NOT NULL,
      value_nonce bytea NOT NULL,
      value_tag bytea NOT NULL,
      value_key_id varchar NOT NULL,
      note text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS platform_secret_history (
      id bigserial PRIMARY KEY,
      secret_id uuid NOT NULL,
      name varchar NOT NULL,
      action varchar NOT NULL,
      note text NOT NULL,
      key_id varchar,
      client_address varchar,
      token_issued_at bigint,
      changed_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT platform_secret_history_action_check CHECK (action IN ('set', 'delete'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS platform_secret_history_name_changed_at_idx
      ON platform_secret_history (name, changed_at)
  `);

  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      table_name text := 'platform_secrets';
      grantor_name name;
      grantee_name name;
      revoked_grantor oid;
      revoked_grantee oid;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        LOOP
          -- One SELECT grant the read-only role or a member of it still holds
          -- on the table or one of its columns. A grant the table's owner
          -- made has no grantor name.
          SELECT
            CASE WHEN held.grantor <> held.relowner
              THEN grantor_role.rolname END,
            grantee_role.rolname,
            held.grantor,
            held.grantee
          INTO grantor_name, grantee_name, revoked_grantor, revoked_grantee
          FROM (
            SELECT tbl.relowner, true AS on_table, acl.*
            FROM pg_class tbl
            CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
            WHERE tbl.oid = table_name::regclass
            UNION ALL
            SELECT tbl.relowner, false AS on_table, acl.*
            FROM pg_class tbl
            JOIN pg_attribute col ON col.attrelid = tbl.oid
            CROSS JOIN LATERAL aclexplode(col.attacl) acl
            WHERE tbl.oid = table_name::regclass
              AND col.attnum > 0
              AND NOT col.attisdropped
          ) held
          JOIN pg_roles grantor_role ON grantor_role.oid = held.grantor
          JOIN pg_roles grantee_role ON grantee_role.oid = held.grantee
          WHERE held.privilege_type = 'SELECT'
            AND grantee_role.oid <> held.relowner
            AND grantee_role.oid IN (
              WITH RECURSIVE reader(oid) AS (
                SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
                UNION
                SELECT membership.member
                FROM pg_auth_members membership
                JOIN reader ON membership.roleid = reader.oid
                WHERE membership.inherit_option OR membership.set_option
              )
              SELECT oid FROM reader
            )
          -- Column grants come before table grants: CASCADE on a table grant
          -- leaves the column grants passed on from it, and once their
          -- grantor has lost the table grant, nobody can revoke them. Within
          -- each, grants the owner made come first, so CASCADE takes what a
          -- reader passed on from one without acting as that reader.
          ORDER BY held.on_table, held.grantor <> held.relowner
          LIMIT 1;
          EXIT WHEN NOT FOUND;
          IF grantor_name IS NOT NULL THEN
            BEGIN
              EXECUTE format('SET ROLE %I', grantor_name);
            EXCEPTION WHEN insufficient_privilege THEN
              RAISE EXCEPTION
                'cannot revoke the SELECT on % that % granted to %',
                table_name, grantor_name, grantee_name
                USING HINT = format(
                  'Run the migration as a superuser or as a role that can SET ROLE %I.',
                  grantor_name
                );
            END;
          END IF;
          EXECUTE format(
            'REVOKE SELECT ON TABLE %I FROM %I CASCADE',
            table_name,
            grantee_name
          );
          EXECUTE format('SET ROLE %I', migrating_role);
          IF EXISTS (
            SELECT 1
            FROM pg_class tbl
            CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
            WHERE tbl.oid = table_name::regclass
              AND acl.privilege_type = 'SELECT'
              AND acl.grantor = revoked_grantor
              AND acl.grantee = revoked_grantee
            UNION ALL
            SELECT 1
            FROM pg_attribute col
            CROSS JOIN LATERAL aclexplode(col.attacl) acl
            WHERE col.attrelid = table_name::regclass
              AND acl.privilege_type = 'SELECT'
              AND acl.grantor = revoked_grantor
              AND acl.grantee = revoked_grantee
          ) THEN
            RAISE EXCEPTION 'the SELECT on % that % granted to % survived its REVOKE',
              table_name, COALESCE(grantor_name, 'the owner'), grantee_name;
          END IF;
        END LOOP;
      END IF;
    END
    $$
  `);
  pgm.sql(`
    DO $$
    DECLARE
      readable_by name;
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
        SELECT reader_role.rolname, col.attname
          INTO readable_by, readable_column
          FROM reader
          JOIN pg_roles reader_role ON reader_role.oid = reader.oid
          CROSS JOIN pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          WHERE tbl.oid = to_regclass('platform_secrets')
            AND reader.oid <> tbl.relowner
            AND col.attnum > 0
            AND NOT col.attisdropped
            AND has_column_privilege(reader.oid, tbl.oid, col.attnum, 'SELECT')
          ORDER BY reader_role.rolname, col.attnum
          LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION
            '% can read platform_secrets.%, which is withheld from readonly_role and the roles that read through it',
            readable_by, readable_column
            USING HINT = format(
              'Revoke the grant or role membership that lets %I read platform_secrets.%I, then run the migration again.',
              readable_by, readable_column
            );
        END IF;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS platform_secret_history`);
  pgm.sql(`DROP TABLE IF EXISTS platform_secrets`);
};
