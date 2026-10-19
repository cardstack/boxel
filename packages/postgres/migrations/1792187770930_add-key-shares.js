// Shares: a key its owner has put into a realm for other people there to
// consume. A share holds no secret, only the key it refers to; one key may be
// shared into several realms and its value is stored once, in `user_keys`.
//
// `key_shares` holds one row per share. `owner` is the owner of the key the
// share holds: whoever shared it, or the writer who last swapped one of their
// own keys in. `label` names the share for people and is unique within its
// realm. `state` is `active` or `suspended`; a suspended share carries the
// reason:
//
// - `owner-lost-write`: the owner is no longer a direct writer of the realm.
//   The share resumes by itself if they become one again.
// - `suspended-by-writer`: a direct writer of the realm suspended it
//   (`suspended_by`).
// - `key-deleted`: the owner deleted the key; `key_id` is then null.
//
// A suspended share serves nothing. A direct writer swaps one of their own
// keys into it to bring it back. `limits` is reserved for the limits a share's
// owner sets on its use.
//
// Triggers keep the state right whatever writes the rows they watch:
//
// - On `realm_user_permissions`, any change to a person's row suspends that
//   person's active shares in the realm when the row no longer grants write,
//   and resumes the ones it suspended for that reason when it does again.
//   A share's owner is always a person whose own row granted write when they
//   shared or swapped a key in, since only a direct writer (see
//   `isDirectWriter`, which refuses wildcard rows and bot accounts) can do
//   either; so their own row is the whole answer.
// - On `user_keys`, deleting a key suspends every share holding it, whatever
//   it was suspended for before, since the share then holds no key.
// - On `key_shares`, a share going from active to suspended, or a suspended
//   share whose key is deleted, records a row in `key_share_notices` for the
//   realm's direct writers.
//
// Both tables are withheld from the read-only role used by dashboards and
// read-only database access, as `user_keys` is, and from every role that reads
// with its privileges: one granted it with INHERIT or SET, directly or through
// other roles granted that way. A role that only administers the membership
// isn't one (on Postgres 16 the role that creates `readonly_role` holds that
// membership, and it is often the tables' owner), and a table's owner is never
// treated as one, so its own privileges are left alone.
//
// A REVOKE removes only the grants its grantor made, so `up` revokes each
// SELECT grant those roles hold on a table or its columns acting as the role
// that made it, with CASCADE, which also removes the grants passed on from it
// at the same level. CASCADE on a table grant leaves the column grants passed
// on from it, which nobody could then revoke, so column grants go first.
// Within each level, grants a table's owner made go first, so a grant one
// reader passed on to another goes with the grant it came from. Acting as
// another role needs the migrating role to be a superuser or able to SET ROLE
// to it; where it isn't, `up` stops and names the grant rather than leave the
// table readable. SELECT granted to PUBLIC, or to a role outside the read-only
// role that one of its readers also belongs to, still lets them read, and
// revoking it isn't a migration's call, so `up` then asks
// `has_column_privilege` about every column of both tables for each reader and
// stops, naming the role and the column, if any of them can still read one.
//
// `readonly_role` exists only where it was provisioned (staging and
// production), so both steps are skipped wherever it doesn't. Every statement
// is idempotent, so running `up` again changes nothing.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_shares (
      id uuid PRIMARY KEY,
      realm_url varchar NOT NULL,
      label varchar NOT NULL,
      -- The Matrix user id of the owner of the key the share holds.
      owner varchar NOT NULL,
      key_id uuid REFERENCES user_keys (id) ON DELETE SET NULL,
      state varchar NOT NULL,
      suspension_reason varchar,
      suspended_by varchar,
      suspended_at timestamptz,
      limits jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT key_shares_realm_url_label_key UNIQUE (realm_url, label),
      CONSTRAINT key_shares_state_check CHECK (
        (
          state = 'active'
          AND key_id IS NOT NULL
          AND suspension_reason IS NULL
          AND suspended_by IS NULL
          AND suspended_at IS NULL
        )
        OR (
          state = 'suspended'
          AND suspended_at IS NOT NULL
          AND (
            (suspension_reason = 'owner-lost-write' AND key_id IS NOT NULL AND suspended_by IS NULL)
            OR (suspension_reason = 'suspended-by-writer' AND key_id IS NOT NULL AND suspended_by IS NOT NULL)
            OR (suspension_reason = 'key-deleted' AND key_id IS NULL AND suspended_by IS NULL)
          )
        )
      )
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_shares_realm_url_owner_idx
      ON key_shares (realm_url, owner)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_shares_owner_idx ON key_shares (owner)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_shares_key_id_idx ON key_shares (key_id)
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_share_notices (
      id bigserial PRIMARY KEY,
      share_id uuid NOT NULL REFERENCES key_shares (id) ON DELETE CASCADE,
      realm_url varchar NOT NULL,
      label varchar NOT NULL,
      owner varchar NOT NULL,
      reason varchar NOT NULL,
      suspended_by varchar,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_share_notices_realm_url_idx
      ON key_share_notices (realm_url, created_at)
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION key_shares_follow_owner_write(
      share_realm_url varchar,
      share_owner varchar
    ) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      -- Lock the person's shares before deciding. A resume that read no
      -- permission row (there was none to lock) may be about to set a share
      -- to 'owner-lost-write'. Waiting on its lock means the UPDATE below,
      -- a new statement with a new snapshot, sees that committed reason and
      -- resumes the share, rather than skipping it as 'suspended-by-writer'.
      PERFORM 1 FROM key_shares
        WHERE realm_url = share_realm_url AND owner = share_owner
        FOR UPDATE;
      IF EXISTS (
        SELECT 1 FROM realm_user_permissions
        WHERE realm_url = share_realm_url
          AND username = share_owner
          AND write
      ) THEN
        UPDATE key_shares
          SET state = 'active',
              suspension_reason = NULL,
              suspended_at = NULL,
              updated_at = NOW()
          WHERE realm_url = share_realm_url
            AND owner = share_owner
            AND state = 'suspended'
            AND suspension_reason = 'owner-lost-write';
      ELSE
        UPDATE key_shares
          SET state = 'suspended',
              suspension_reason = 'owner-lost-write',
              suspended_at = NOW(),
              updated_at = NOW()
          WHERE realm_url = share_realm_url
            AND owner = share_owner
            AND state = 'active';
      END IF;
    END
    $$
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION key_shares_on_permission_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM key_shares_follow_owner_write(OLD.realm_url, OLD.username);
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM key_shares_follow_owner_write(NEW.realm_url, NEW.username);
      END IF;
      RETURN NULL;
    END
    $$
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS key_shares_follow_permissions ON realm_user_permissions
  `);
  pgm.sql(`
    CREATE TRIGGER key_shares_follow_permissions
      AFTER INSERT OR UPDATE OR DELETE ON realm_user_permissions
      FOR EACH ROW EXECUTE FUNCTION key_shares_on_permission_change()
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION key_shares_on_key_delete()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE key_shares
        SET state = 'suspended',
            suspension_reason = 'key-deleted',
            suspended_by = NULL,
            suspended_at = COALESCE(suspended_at, NOW()),
            key_id = NULL,
            updated_at = NOW()
        WHERE key_id = OLD.id;
      RETURN OLD;
    END
    $$
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS key_shares_follow_key_delete ON user_keys`);
  pgm.sql(`
    CREATE TRIGGER key_shares_follow_key_delete
      BEFORE DELETE ON user_keys
      FOR EACH ROW EXECUTE FUNCTION key_shares_on_key_delete()
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION key_shares_record_suspension()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO key_share_notices
        (share_id, realm_url, label, owner, reason, suspended_by)
        VALUES
        (NEW.id, NEW.realm_url, NEW.label, NEW.owner, NEW.suspension_reason, NEW.suspended_by);
      RETURN NULL;
    END
    $$
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS key_shares_notice_suspension ON key_shares`);
  pgm.sql(`
    CREATE TRIGGER key_shares_notice_suspension
      AFTER UPDATE OF state, suspension_reason ON key_shares
      FOR EACH ROW
      WHEN (
        NEW.state = 'suspended'
        AND (
          OLD.state = 'active'
          OR (
            NEW.suspension_reason = 'key-deleted'
            AND OLD.suspension_reason IS DISTINCT FROM 'key-deleted'
          )
        )
      )
      EXECUTE FUNCTION key_shares_record_suspension()
  `);

  // A ticket to share a key names the key and the realm it goes into; a
  // ticket to swap a key in names the key and the share it goes into; a
  // ticket to resume a share names the share.
  pgm.sql(`
    ALTER TABLE key_write_tickets ADD COLUMN IF NOT EXISTS realm_url varchar
  `);
  pgm.sql(`
    ALTER TABLE key_write_tickets ADD COLUMN IF NOT EXISTS share_id uuid
  `);
  pgm.sql(`
    ALTER TABLE key_write_tickets
      DROP CONSTRAINT IF EXISTS key_write_tickets_action_key_id_check
  `);
  pgm.sql(`
    ALTER TABLE key_write_tickets
      ADD CONSTRAINT key_write_tickets_action_key_id_check CHECK (
        (action = 'add' AND key_id IS NULL AND realm_url IS NULL AND share_id IS NULL)
        OR (action IN ('replace', 'delete') AND key_id IS NOT NULL AND realm_url IS NULL AND share_id IS NULL)
        OR (action = 'share' AND key_id IS NOT NULL AND realm_url IS NOT NULL AND share_id IS NULL)
        OR (action = 'swap' AND key_id IS NOT NULL AND realm_url IS NULL AND share_id IS NOT NULL)
        OR (action = 'resume' AND key_id IS NULL AND realm_url IS NULL AND share_id IS NOT NULL)
      )
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
        FOREACH table_name IN ARRAY ARRAY['key_shares', 'key_share_notices']
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
          WHERE tbl.oid IN (
              to_regclass('key_shares'),
              to_regclass('key_share_notices')
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

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM key_write_tickets WHERE action IN ('share', 'swap', 'resume')
  `);
  pgm.sql(`
    ALTER TABLE key_write_tickets
      DROP CONSTRAINT IF EXISTS key_write_tickets_action_key_id_check
  `);
  pgm.sql(`
    ALTER TABLE key_write_tickets
      ADD CONSTRAINT key_write_tickets_action_key_id_check CHECK (
        (action = 'add' AND key_id IS NULL)
        OR (action IN ('replace', 'delete') AND key_id IS NOT NULL)
      )
  `);
  pgm.sql(`ALTER TABLE key_write_tickets DROP COLUMN IF EXISTS share_id`);
  pgm.sql(`ALTER TABLE key_write_tickets DROP COLUMN IF EXISTS realm_url`);
  pgm.sql(`DROP TRIGGER IF EXISTS key_shares_notice_suspension ON key_shares`);
  pgm.sql(`DROP TRIGGER IF EXISTS key_shares_follow_key_delete ON user_keys`);
  pgm.sql(`
    DROP TRIGGER IF EXISTS key_shares_follow_permissions ON realm_user_permissions
  `);
  pgm.sql(`DROP FUNCTION IF EXISTS key_shares_record_suspension()`);
  pgm.sql(`DROP FUNCTION IF EXISTS key_shares_on_key_delete()`);
  pgm.sql(`DROP FUNCTION IF EXISTS key_shares_on_permission_change()`);
  pgm.sql(
    `DROP FUNCTION IF EXISTS key_shares_follow_owner_write(varchar, varchar)`,
  );
  pgm.sql(`DROP TABLE IF EXISTS key_share_notices`);
  pgm.sql(`DROP TABLE IF EXISTS key_shares`);
};
