// OAuth clients and connections, two kinds of key.
//
// An `oauth-client` key is an app its owner registered with a vendor. Its
// `user_keys` value is the client secret; `oauth_clients` holds the rest, none
// of it secret: the client id, the grant it uses (`authorization_code`, for
// people to connect through, or `client_credentials`, which mints tokens with
// no person involved), the authorization and token endpoints, the scopes it
// asks for, how it authenticates at the token endpoint, and the API hosts it
// serves, which only decide where connect mode offers it. A client's
// endpoints never change: replacing the key rotates only its secret. `state`
// is `active`, or `broken` once its token endpoint has answered
// `invalid_client`, until its secret is replaced.
//
// `platform_oauth_clients` holds the clients Boxel itself registers, such as
// its read-only GitHub App, managed by operators. Its secret is sealed on the
// row (`secret_*`, field `platform_oauth_clients.secret`, the platform as
// owner, bound to the row and its token endpoint).
//
// An `oauth-connection` key is a person's sign-in through a client. Its
// `user_keys` value is the token the vendor issued that mints the rest: the
// refresh token, or for a vendor that issues no refresh token, the access
// token itself (`token_kind`). `oauth_connections` names the client it was
// made through: one of the owner's own clients, a share of a client in a realm,
// or a platform client. Each reference is cleared when its client goes, and
// `client_kind` keeps which it was, so the connection reads as needing an
// administrator rather than as made through nothing. `generation` moves on
// with every refresh and `refreshing_until` is the refresh lease, so one
// process at a time spends a rotating refresh token without holding a
// database connection while the vendor answers.
//
// `oauth_connect_requests` holds a sign-in in progress, from the moment the
// secure window sends the user to the vendor until the vendor sends them back
// to the realm server: only the SHA-256 of its `state` parameter is stored,
// with whom it is for, the client, the new key's name (or the connection it
// reconnects) and when it expires.
//
// The four tables are withheld from the read-only role, as `user_keys` is,
// and from every role that reads with its privileges, by the same steps the
// grants migration takes. They are excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      key_id uuid PRIMARY KEY REFERENCES user_keys (id) ON DELETE CASCADE,
      client_id varchar NOT NULL,
      grant_type varchar NOT NULL,
      authorize_url varchar,
      token_url varchar NOT NULL,
      scopes varchar NOT NULL DEFAULT '',
      token_auth varchar NOT NULL,
      api_hosts varchar[] NOT NULL DEFAULT '{}',
      state varchar NOT NULL DEFAULT 'active',
      broken_at timestamptz,
      CONSTRAINT oauth_clients_grant_type_check CHECK (
        (grant_type = 'authorization_code' AND authorize_url IS NOT NULL)
        OR (grant_type = 'client_credentials' AND authorize_url IS NULL)
      ),
      CONSTRAINT oauth_clients_token_auth_check CHECK (token_auth IN ('client_secret_post', 'client_secret_basic')),
      CONSTRAINT oauth_clients_state_check CHECK (state IN ('active', 'broken'))
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS platform_oauth_clients (
      id uuid PRIMARY KEY,
      -- A handle operators and the CLI name it by, such as 'github'.
      name varchar NOT NULL UNIQUE,
      label varchar NOT NULL,
      client_id varchar NOT NULL,
      -- Always 'authorization_code': people connect through a platform client.
      grant_type varchar NOT NULL DEFAULT 'authorization_code',
      authorize_url varchar NOT NULL,
      token_url varchar NOT NULL,
      scopes varchar NOT NULL DEFAULT '',
      token_auth varchar NOT NULL,
      api_hosts varchar[] NOT NULL DEFAULT '{}',
      state varchar NOT NULL DEFAULT 'active',
      broken_at timestamptz,
      secret_ciphertext bytea NOT NULL,
      secret_nonce bytea NOT NULL,
      secret_tag bytea NOT NULL,
      secret_key_id varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT platform_oauth_clients_grant_type_check CHECK (grant_type = 'authorization_code'),
      CONSTRAINT platform_oauth_clients_token_auth_check CHECK (token_auth IN ('client_secret_post', 'client_secret_basic')),
      CONSTRAINT platform_oauth_clients_state_check CHECK (state IN ('active', 'broken'))
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_connections (
      key_id uuid PRIMARY KEY REFERENCES user_keys (id) ON DELETE CASCADE,
      client_kind varchar NOT NULL,
      client_key_id uuid REFERENCES oauth_clients (key_id) ON DELETE SET NULL,
      client_share_id uuid REFERENCES key_shares (id) ON DELETE SET NULL,
      platform_client_id uuid REFERENCES platform_oauth_clients (id) ON DELETE SET NULL,
      token_kind varchar NOT NULL,
      -- The scopes the vendor said it granted, which may be fewer than asked.
      scopes varchar NOT NULL DEFAULT '',
      rejected_at timestamptz,
      -- When an access token stored as the value (no refresh token issued)
      -- stops serving.
      access_expires_at timestamptz,
      -- Moves on with every refresh, so a process holding an access token
      -- minted at an earlier one knows to mint again.
      generation integer NOT NULL DEFAULT 0,
      -- While set and in the future, one process holds the refresh lease.
      refreshing_until timestamptz,
      CONSTRAINT oauth_connections_client_kind_check CHECK (client_kind IN ('own', 'share', 'platform')),
      CONSTRAINT oauth_connections_client_check CHECK (
        (client_kind = 'own' AND client_share_id IS NULL AND platform_client_id IS NULL)
        OR (client_kind = 'share' AND client_key_id IS NULL AND platform_client_id IS NULL)
        OR (client_kind = 'platform' AND client_key_id IS NULL AND client_share_id IS NULL)
      ),
      CONSTRAINT oauth_connections_token_kind_check CHECK (token_kind IN ('refresh', 'access'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_connections_client_key_id_idx ON oauth_connections (client_key_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_connections_client_share_id_idx ON oauth_connections (client_share_id)
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_connect_requests (
      state_sha256 varchar PRIMARY KEY,
      owner varchar NOT NULL,
      name varchar NOT NULL,
      client_kind varchar NOT NULL,
      client_key_id uuid REFERENCES oauth_clients (key_id) ON DELETE CASCADE,
      client_share_id uuid REFERENCES key_shares (id) ON DELETE CASCADE,
      platform_client_id uuid REFERENCES platform_oauth_clients (id) ON DELETE CASCADE,
      -- The connection a reconnect replaces the token of; null for a new one.
      reconnects_key_id uuid REFERENCES user_keys (id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      CONSTRAINT oauth_connect_requests_client_check CHECK (num_nonnulls(client_key_id, client_share_id, platform_client_id) = 1)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_connect_requests_expires_at_idx ON oauth_connect_requests (expires_at)
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
        FOREACH table_name IN ARRAY ARRAY['oauth_clients', 'platform_oauth_clients', 'oauth_connections', 'oauth_connect_requests']
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
              to_regclass('oauth_clients'),
              to_regclass('platform_oauth_clients'),
              to_regclass('oauth_connections'),
              to_regclass('oauth_connect_requests')
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
  pgm.sql(`DROP TABLE IF EXISTS oauth_connect_requests`);
  pgm.sql(`DROP TABLE IF EXISTS oauth_connections`);
  pgm.sql(`DROP TABLE IF EXISTS platform_oauth_clients`);
  pgm.sql(`DROP TABLE IF EXISTS oauth_clients`);
};
