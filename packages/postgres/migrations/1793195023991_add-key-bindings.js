// Bindings: a key owner's approval for one `callApi` operation, in one realm,
// to send a chosen key in one of the operation's credential slots. Card code
// never names a key; the binding does, and a slot no binding fills is not
// sent.
//
// `key_bindings` holds one row per slot. The operation is named by the realm
// it was approved in, its type's module (`definition_url`) and export, and
// its name, plus the card (`instance_url`) for an operation approved per
// instance. `slot` is the token it fills (`userKey`, `apiKey`, or a named slot
// such as `apiKey:token`). Exactly one of `key_id` (the approver's own key, for
// a `userKey` slot) and `share_id` (a share in the realm, for an `apiKey`
// slot) is set. `grant_id` is the grant the credential is sent under, a grant
// of that key or of the share's key. It is cleared when the share's key is
// deleted, and a swap sets it again. `approved_by` is the key's owner; for a
// `userKey` slot it is also the only caller the binding serves, so that
// uniqueness includes it. `fingerprint` is the SHA-256 of the request as it
// was approved, checked against the definition cache on every call, and
// `approval_id` the approval that set it. `state` is `active`,
// `needs-reapproval` (the operation now lowers to another request) or
// `suspended` (its share is).
//
// `key_binding_approvals` is append-only: one row per approval, re-approval or
// revocation, never updated, so it outlives the binding a revocation removes.
// It names the binding's operation and slot again for that reason, and keeps a
// readable copy of the request as it was approved: once the card definition
// changes, the definition cache no longer has the old request, and a
// fingerprint alone can't say what changed. `batch_id` is shared by every row
// one confirmation wrote. `via` is the client of the secure-origin session
// that acted (`window` or `cli`), or null for a revocation the realm server
// made because the key behind it was deleted.
//
// `key_binding_notices` records the one notice a binding's owner gets when it
// goes to `needs-reapproval`.
//
// A trigger on `key_shares` keeps a share's bindings `suspended` while the
// share is, and returns them to `active` when it resumes, however the share's
// state changes.
//
// The three tables hold no secret, but they are withheld from the read-only
// role, as `user_keys`, `user_key_grants` and `key_shares` are, and from every
// role that reads with its privileges, by the same steps the grants migration
// takes. They are excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_bindings (
      id uuid PRIMARY KEY,
      realm_url varchar NOT NULL,
      definition_url varchar NOT NULL,
      export_name varchar NOT NULL,
      operation_name varchar NOT NULL,
      instance_url varchar,
      slot varchar NOT NULL,
      key_id uuid REFERENCES user_keys (id) ON DELETE CASCADE,
      share_id uuid REFERENCES key_shares (id) ON DELETE CASCADE,
      grant_id uuid REFERENCES user_key_grants (id) ON DELETE SET NULL,
      -- The Matrix user id of the key's owner, who approved it.
      approved_by varchar NOT NULL,
      interactive boolean NOT NULL DEFAULT false,
      anonymous boolean NOT NULL DEFAULT false,
      fingerprint varchar NOT NULL,
      approval_id uuid NOT NULL,
      state varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT key_bindings_fills_check CHECK (num_nonnulls(key_id, share_id) = 1),
      CONSTRAINT key_bindings_grant_check CHECK (grant_id IS NOT NULL OR share_id IS NOT NULL),
      CONSTRAINT key_bindings_anonymous_check CHECK (NOT anonymous OR (interactive AND share_id IS NOT NULL)),
      CONSTRAINT key_bindings_state_check CHECK (state IN ('active', 'needs-reapproval', 'suspended'))
    )
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS key_bindings_share_slot_key
      ON key_bindings (realm_url, definition_url, export_name, operation_name, COALESCE(instance_url, ''), slot)
      WHERE share_id IS NOT NULL
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS key_bindings_user_slot_key
      ON key_bindings (realm_url, definition_url, export_name, operation_name, COALESCE(instance_url, ''), slot, approved_by)
      WHERE key_id IS NOT NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_bindings_approved_by_idx ON key_bindings (approved_by)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_bindings_grant_id_idx ON key_bindings (grant_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_bindings_share_id_idx ON key_bindings (share_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_bindings_key_id_idx ON key_bindings (key_id)
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_binding_approvals (
      id uuid PRIMARY KEY,
      binding_id uuid NOT NULL,
      batch_id uuid NOT NULL,
      grant_id uuid,
      action varchar NOT NULL,
      interactive boolean NOT NULL,
      anonymous boolean NOT NULL,
      realm_url varchar NOT NULL,
      definition_url varchar NOT NULL,
      export_name varchar NOT NULL,
      operation_name varchar NOT NULL,
      instance_url varchar,
      slot varchar NOT NULL,
      key_id uuid,
      share_id uuid,
      destination varchar NOT NULL,
      method varchar NOT NULL,
      path_template text NOT NULL,
      headers_template text NOT NULL,
      placement varchar NOT NULL,
      placement_name varchar NOT NULL,
      transform varchar,
      body_template text,
      fingerprint varchar NOT NULL,
      actor varchar NOT NULL,
      via varchar,
      at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT key_binding_approvals_action_check CHECK (action IN ('approved', 're-approved', 'revoked')),
      CONSTRAINT key_binding_approvals_via_check CHECK (via IS NULL OR via IN ('window', 'cli'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_binding_approvals_binding_id_idx
      ON key_binding_approvals (binding_id, at)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_binding_approvals_actor_idx
      ON key_binding_approvals (actor, at)
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_binding_notices (
      id bigserial PRIMARY KEY,
      binding_id uuid NOT NULL REFERENCES key_bindings (id) ON DELETE CASCADE,
      owner varchar NOT NULL,
      reason varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT key_binding_notices_reason_check CHECK (reason = 'needs-reapproval')
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_binding_notices_owner_idx
      ON key_binding_notices (owner, created_at)
  `);

  // A share's bindings follow its state. A binding that needs re-approval
  // keeps that state either way: the share resuming doesn't approve the
  // changed request.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION key_bindings_follow_share()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.state = 'suspended' AND OLD.state <> 'suspended' THEN
        UPDATE key_bindings SET state = 'suspended', updated_at = NOW()
          WHERE share_id = NEW.id AND state = 'active';
      ELSIF NEW.state = 'active' AND OLD.state <> 'active' THEN
        UPDATE key_bindings SET state = 'active', updated_at = NOW()
          WHERE share_id = NEW.id AND state = 'suspended';
      END IF;
      RETURN NULL;
    END
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS key_bindings_follow_share ON key_shares
  `);
  pgm.sql(`
    CREATE TRIGGER key_bindings_follow_share
      AFTER UPDATE OF state ON key_shares
      FOR EACH ROW EXECUTE FUNCTION key_bindings_follow_share()
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
        FOREACH table_name IN ARRAY ARRAY['key_bindings', 'key_binding_approvals', 'key_binding_notices']
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
              to_regclass('key_bindings'),
              to_regclass('key_binding_approvals'),
              to_regclass('key_binding_notices')
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
  pgm.sql(`DROP TRIGGER IF EXISTS key_bindings_follow_share ON key_shares`);
  pgm.sql(`DROP FUNCTION IF EXISTS key_bindings_follow_share()`);
  pgm.sql(`DROP TABLE IF EXISTS key_binding_notices`);
  pgm.sql(`DROP TABLE IF EXISTS key_binding_approvals`);
  pgm.sql(`DROP TABLE IF EXISTS key_bindings`);
};
