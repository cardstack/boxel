// Limits on how much of a key anyone spends, set by the key's owner. No
// credits change hands for a user's key, so these are what bound its use.
//
// A share and a personal key each carry their own limits:
//
// * `rate_burst` and `rate_refill_per_minute`: a token bucket per caller, so a
//   full refresh fits in one burst and a runaway loop is held to the refill.
// * `daily_budget` and `monthly_budget`: how many calls the share or key
//   serves in one UTC day or month, across every caller.
//
// Null means the platform's default: a share or key nobody set limits on is
// still limited. A monthly budget left null is thirty times the daily one.
// Only interactive calls count against them; a pipeline is bounded by its
// schedule's payer and caps instead.
//
// `key_limit_notices` records the notices sent when a share's or key's use
// for a period reaches the high-water mark and when it reaches the budget,
// one row per recipient: the key's owner and, for a share, the direct writers
// of the share's realm. Its unique index lets each threshold notify each
// recipient once per period, however many calls cross it together. The label
// is copied, so a notice still reads after the share or key is renamed.
//
// The notices table holds no secret, but like the other key tables it is
// withheld from the read-only role and from every role that reads with its
// privileges, by the same steps the grants migration takes, and excluded from
// the SQLite schema dump.

const LIMIT_COLUMNS = `
  ADD COLUMN IF NOT EXISTS rate_burst integer,
  ADD COLUMN IF NOT EXISTS rate_refill_per_minute double precision,
  ADD COLUMN IF NOT EXISTS daily_budget integer,
  ADD COLUMN IF NOT EXISTS monthly_budget integer
`;

function limitChecks(table) {
  return `
    ALTER TABLE ${table} ADD CONSTRAINT ${table}_limits_check CHECK (
      (rate_burst IS NULL OR rate_burst >= 1)
      AND (rate_refill_per_minute IS NULL OR rate_refill_per_minute > 0)
      AND (daily_budget IS NULL OR daily_budget >= 1)
      AND (monthly_budget IS NULL OR monthly_budget >= 1)
    )
  `;
}

exports.up = (pgm) => {
  for (let table of ['key_shares', 'user_keys']) {
    pgm.sql(`ALTER TABLE ${table} ${LIMIT_COLUMNS}`);
    pgm.sql(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_limits_check`,
    );
    pgm.sql(limitChecks(table));
  }

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_limit_notices (
      id bigserial PRIMARY KEY,
      -- The share or the personal key whose use reached the threshold.
      share_id uuid REFERENCES key_shares (id) ON DELETE CASCADE,
      key_id uuid REFERENCES user_keys (id) ON DELETE CASCADE,
      -- The share's realm; null for a personal key.
      realm_url varchar,
      -- The share's label or the key's name.
      label varchar NOT NULL,
      -- The Matrix user id the notice is for.
      recipient varchar NOT NULL,
      -- The key's owner.
      owner varchar NOT NULL,
      period varchar NOT NULL,
      -- When the period ends and its count starts over.
      period_ends_at timestamptz NOT NULL,
      threshold varchar NOT NULL,
      -- The budget for the period when the threshold was reached.
      budget integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT key_limit_notices_subject_check CHECK (
        (share_id IS NOT NULL AND key_id IS NULL AND realm_url IS NOT NULL)
        OR (share_id IS NULL AND key_id IS NOT NULL AND realm_url IS NULL)
      ),
      CONSTRAINT key_limit_notices_period_check CHECK (period IN ('day', 'month')),
      CONSTRAINT key_limit_notices_threshold_check CHECK (threshold IN ('high-water', 'budget'))
    )
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS key_limit_notices_once_idx
      ON key_limit_notices (COALESCE(share_id, key_id), recipient, period, period_ends_at, threshold)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_limit_notices_recipient_idx
      ON key_limit_notices (recipient, created_at)
  `);

  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      table_name text;
      grantor_name name;
      grantee_name name;
      revoked_grantor oid;
      revoked_grantee oid;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        FOREACH table_name IN ARRAY ARRAY['key_limit_notices']
        LOOP
          LOOP
            -- One SELECT grant the read-only role or a member of it still
            -- holds on the table or one of its columns. A grant the table's
            -- owner made has no grantor name.
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
            -- Column grants come before table grants: CASCADE on a table
            -- grant leaves the column grants passed on from it, and once
            -- their grantor has lost the table grant, nobody can revoke
            -- them. Within each, grants the owner made come first, so
            -- CASCADE takes what a reader passed on from one without acting
            -- as that reader.
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
        END LOOP;
      END IF;
    END
    $$
  `);
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
          WHERE tbl.oid = to_regclass('key_limit_notices')
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

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS key_limit_notices`);
  for (let table of ['key_shares', 'user_keys']) {
    pgm.sql(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_limits_check`,
    );
    pgm.sql(`
      ALTER TABLE ${table}
        DROP COLUMN IF EXISTS rate_burst,
        DROP COLUMN IF EXISTS rate_refill_per_minute,
        DROP COLUMN IF EXISTS daily_budget,
        DROP COLUMN IF EXISTS monthly_budget
    `);
  }
};
