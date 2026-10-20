exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_objects (
      id varchar PRIMARY KEY,
      model varchar NOT NULL,
      grant_id varchar,
      uid varchar,
      user_code varchar,
      expires_at bigint,
      consumed_at bigint,
      payload_ciphertext bytea NOT NULL,
      payload_nonce bytea NOT NULL,
      payload_tag bytea NOT NULL,
      payload_key_id varchar NOT NULL
    );
    CREATE INDEX IF NOT EXISTS oauth_objects_grant_idx ON oauth_objects(grant_id);
    CREATE INDEX IF NOT EXISTS oauth_objects_uid_idx ON oauth_objects(model,uid);
    CREATE INDEX IF NOT EXISTS oauth_objects_user_code_idx ON oauth_objects(model,user_code);
    CREATE INDEX IF NOT EXISTS oauth_objects_expiry_idx ON oauth_objects(expires_at);
    CREATE TABLE IF NOT EXISTS oauth_grants (
      id varchar PRIMARY KEY,
      user_id varchar NOT NULL,
      client_id varchar NOT NULL,
      resource varchar NOT NULL,
      realms jsonb NOT NULL,
      scopes jsonb NOT NULL,
      issued_at bigint NOT NULL,
      permissions_ciphertext bytea NOT NULL,
      permissions_nonce bytea NOT NULL,
      permissions_tag bytea NOT NULL,
      permissions_key_id varchar NOT NULL,
      revoked_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS oauth_grants_user_idx ON oauth_grants(user_id);
  `);
  pgm.sql(`
    DO $$
    DECLARE
      member_name name;
      readable_by name;
      readable_column name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        REVOKE SELECT ON TABLE oauth_objects FROM readonly_role;
        FOR member_name IN
          SELECT member.rolname
          FROM pg_auth_members membership
          JOIN pg_roles grp ON grp.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          WHERE grp.rolname = 'readonly_role'
            AND (membership.inherit_option OR membership.set_option)
            AND membership.member <> (
              SELECT relowner FROM pg_class
              WHERE oid = 'oauth_objects'::regclass
            )
        LOOP
          EXECUTE format(
            'REVOKE SELECT ON TABLE oauth_objects FROM %I',
            member_name
          );
        END LOOP;

        -- The revokes above remove only grants this role made, and SELECT
        -- granted to PUBLIC or to another role a member belongs to still
        -- reads. So check every column against readonly_role and every role
        -- that inherits its privileges or can SET ROLE to it, directly or
        -- through other roles, and stop if any can read one. The table's
        -- owner reads it by owning it, so it isn't checked.
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
          WHERE tbl.oid = to_regclass('oauth_objects')
            AND reader.oid <> tbl.relowner
            AND col.attnum > 0
            AND NOT col.attisdropped
            AND has_column_privilege(reader.oid, tbl.oid, col.attnum, 'SELECT')
          ORDER BY reader_role.rolname, col.attnum
          LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION
            '% can read oauth_objects.%, which is withheld from readonly_role and the roles that read through it',
            readable_by, readable_column
            USING HINT = format(
              'Revoke the grant or role membership that lets %I read oauth_objects.%I, then run the migration again.',
              readable_by, readable_column
            );
        END IF;
      END IF;
    END
    $$
  `);
  pgm.sql(`
    DO $$
    DECLARE
      member_name name;
      readable_by name;
      readable_column name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        REVOKE SELECT ON TABLE oauth_grants FROM readonly_role;
        FOR member_name IN
          SELECT member.rolname
          FROM pg_auth_members membership
          JOIN pg_roles grp ON grp.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          WHERE grp.rolname = 'readonly_role'
            AND (membership.inherit_option OR membership.set_option)
            AND membership.member <> (
              SELECT relowner FROM pg_class
              WHERE oid = 'oauth_grants'::regclass
            )
        LOOP
          EXECUTE format(
            'REVOKE SELECT ON TABLE oauth_grants FROM %I',
            member_name
          );
        END LOOP;

        -- The revokes above remove only grants this role made, and SELECT
        -- granted to PUBLIC or to another role a member belongs to still
        -- reads. So check every column against readonly_role and every role
        -- that inherits its privileges or can SET ROLE to it, directly or
        -- through other roles, and stop if any can read one. The table's
        -- owner reads it by owning it, so it isn't checked.
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
          WHERE tbl.oid = to_regclass('oauth_grants')
            AND reader.oid <> tbl.relowner
            AND col.attnum > 0
            AND NOT col.attisdropped
            AND has_column_privilege(reader.oid, tbl.oid, col.attnum, 'SELECT')
          ORDER BY reader_role.rolname, col.attnum
          LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION
            '% can read oauth_grants.%, which is withheld from readonly_role and the roles that read through it',
            readable_by, readable_column
            USING HINT = format(
              'Revoke the grant or role membership that lets %I read oauth_grants.%I, then run the migration again.',
              readable_by, readable_column
            );
        END IF;
      END IF;
    END
    $$
  `);
};
exports.down = (pgm) => {
  pgm.sql(
    'DROP TABLE IF EXISTS oauth_objects; DROP TABLE IF EXISTS oauth_grants;',
  );
};
