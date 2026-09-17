exports.shorthands = undefined;

// Fresh Lattice schema: the POC has never shipped. No legacy aliases, backfills,
// query-term rows or triggers on ordinary file/index writes are installed.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE lattice_owners (
      realm_url varchar NOT NULL,
      owner_url varchar NOT NULL,
      published_generation bigint NOT NULL,
      input_generation bigint NOT NULL,
      dirty_generation bigint,
      definition_revision varchar NOT NULL,
      retired boolean NOT NULL DEFAULT FALSE,
      attributes_json text,
      attributes_generation bigint,
      code_bound boolean NOT NULL DEFAULT FALSE,
      -- The earliest freshUntil grain over the owner's fields at its last
      -- publication: a dirty owner is not runnable before it.
      settle_until timestamptz,
      PRIMARY KEY (realm_url, owner_url)
    );
    CREATE INDEX lattice_owners_realm_url_dirty_generation_index
      ON lattice_owners (realm_url, dirty_generation);
    CREATE TABLE lattice_query_watches (
      realm_url varchar NOT NULL,
      owner_url varchar NOT NULL,
      field_path varchar NOT NULL,
      query jsonb NOT NULL,
      routing_tokens jsonb NOT NULL DEFAULT '${JSON.stringify([JSON.stringify(['', ''])])}'::jsonb,
      -- Read-path change detection: the fields of a matching row the owner
      -- read (PublicationReceipt.readPaths); NULL invalidates on any change.
      read_paths jsonb,
      PRIMARY KEY (realm_url, owner_url, field_path)
    );
    -- jsonb_ops supports the any-token ?| lookup; jsonb_path_ops does not.
    CREATE INDEX lattice_query_watches_routing_tokens_gin
      ON lattice_query_watches USING gin (routing_tokens);
    CREATE TABLE lattice_pending_generations (
      realm_url varchar NOT NULL,
      generation bigint NOT NULL,
      definition_revision varchar NOT NULL,
      PRIMARY KEY (realm_url, generation)
    );
    CREATE TABLE lattice_index_events (
      realm_url varchar NOT NULL,
      generation bigint NOT NULL,
      url varchar NOT NULL,
      previous_row jsonb,
      next_row jsonb NOT NULL,
      PRIMARY KEY (realm_url, generation, url)
    );
    CREATE UNLOGGED TABLE lattice_input_artifacts (
      realm_url varchar NOT NULL,
      url varchar NOT NULL,
      type varchar NOT NULL,
      digest text NOT NULL,
      resource jsonb NOT NULL,
      row_xmin text,
      row_cmin text,
      row_ctid text,
      row_filenode text,
      captured_xid text,
      PRIMARY KEY (realm_url, url, type)
    );

    CREATE TABLE lattice_publication_events (
      id uuid PRIMARY KEY,
      realm_url text NOT NULL,
      owner_url text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE lattice_publication_deliveries (
      publication_id uuid NOT NULL REFERENCES lattice_publication_events(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      room_id text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      lease_token uuid,
      lease_until timestamptz,
      delivered_at timestamptz,
      event_id text,
      terminal_reason text,
      last_error text,
      PRIMARY KEY (publication_id, user_id)
    );
    CREATE INDEX lattice_publication_delivery_due
      ON lattice_publication_deliveries (next_attempt_at, publication_id)
      WHERE delivered_at IS NULL AND terminal_reason IS NULL;
    CREATE INDEX lattice_publication_created
      ON lattice_publication_events (created_at);

    CREATE UNLOGGED TABLE lattice_code_realms (
      realm_url text PRIMARY KEY,
      actor_user_id text NOT NULL,
      runtime_revision text NOT NULL,
      policy_revision text NOT NULL
    );
    CREATE UNLOGGED TABLE lattice_code_artifacts (
      realm_url text NOT NULL,
      file_url text NOT NULL,
      realm_username text NOT NULL,
      work_version bigint NOT NULL DEFAULT 1,
      dirty boolean NOT NULL DEFAULT TRUE,
      runtime_revision text,
      actor_user_id text,
      scope jsonb,
      receipt jsonb,
      dependency_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (realm_url,file_url)
    );
    CREATE INDEX lattice_code_dependencies ON lattice_code_artifacts USING gin (dependency_keys);
    CREATE INDEX lattice_code_pending ON lattice_code_artifacts (realm_url,file_url) WHERE dirty;

    CREATE UNLOGGED TABLE lattice_owner_code (
      realm_url text NOT NULL,
      owner_url text NOT NULL,
      generation bigint NOT NULL,
      reference jsonb NOT NULL,
      PRIMARY KEY (realm_url,owner_url)
    );
    CREATE INDEX lattice_owner_code_file ON lattice_owner_code (realm_url,(reference->>'fileURL'));

    CREATE FUNCTION lattice_code_reference_current(ref jsonb) RETURNS boolean
      LANGUAGE sql STABLE AS $$
      SELECT COALESCE((SELECT
        CASE WHEN jsonb_typeof(c.scope)='array' AND jsonb_array_length(c.scope) BETWEEN 1 AND 128 THEN
          NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(c.scope)
            AS s(realm text,path text,username text,hash text,size bigint)
            LEFT JOIN realm_user_permissions p ON p.realm_url=s.realm AND p.username=s.username AND p.read=TRUE
            LEFT JOIN realm_metadata m ON m.url=s.realm AND m.archived_at IS NULL
            LEFT JOIN realm_file_meta f ON f.realm_url=s.realm AND f.file_path=s.path
              AND f.content_hash=s.hash AND f.content_size=s.size
            WHERE p.realm_url IS NULL OR m.url IS NULL OR f.file_path IS NULL
              OR s.username NOT IN ('*',ref->>'actorUserId'))
        ELSE FALSE END
        FROM lattice_code_artifacts c JOIN lattice_code_realms r ON r.realm_url=c.realm_url
        WHERE ref->>'version'='1' AND c.realm_url=ref->>'realmURL' AND c.file_url=ref->>'fileURL'
          AND NOT c.dirty AND c.actor_user_id=ref->>'actorUserId' AND c.runtime_revision=ref->>'runtimeRevision'
          AND r.actor_user_id=c.actor_user_id AND r.runtime_revision=c.runtime_revision
          AND r.policy_revision=ref->>'policyRevision'
          AND c.receipt->>'version'='1' AND c.receipt->>'fileId'=c.file_url AND c.receipt->>'state'='analyzed'
          AND c.receipt->'exports'->(ref->>'exportName')->>'state'='requires-admission'
          AND c.receipt->'exports'->(ref->>'exportName')->>'runtimeRevision'=c.runtime_revision
          AND c.receipt->'exports'->(ref->>'exportName')->'root'->>'fileId'=c.file_url
          AND c.receipt->'exports'->(ref->>'exportName')->'root'->>'name'=ref->>'exportName'
          AND c.receipt->'exports'->(ref->>'exportName')->>'fingerprint'=ref->>'fingerprint'),FALSE)
      $$;

    CREATE FUNCTION lattice_owner_code_current(realm text, owner text, epoch text) RETURNS boolean
      LANGUAGE sql STABLE AS $$
      SELECT COALESCE((SELECT CASE WHEN NOT o.code_bound THEN o.definition_revision=epoch
        ELSE b.owner_url IS NOT NULL AND b.generation=o.published_generation AND lattice_code_reference_current(b.reference) END
        FROM lattice_owners o LEFT JOIN lattice_owner_code b ON b.realm_url=o.realm_url AND b.owner_url=o.owner_url
        WHERE o.realm_url=realm AND o.owner_url=owner),FALSE)
      $$;

    CREATE FUNCTION lattice_lock_code_reference(ref jsonb) RETURNS boolean
      LANGUAGE plpgsql AS $$
    DECLARE captured jsonb;
    BEGIN
      PERFORM 1 FROM lattice_code_realms r WHERE r.realm_url=ref->>'realmURL'
        AND r.actor_user_id=ref->>'actorUserId' AND r.runtime_revision=ref->>'runtimeRevision'
        AND r.policy_revision=ref->>'policyRevision' FOR SHARE;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      SELECT c.scope INTO captured FROM lattice_code_artifacts c
        WHERE c.realm_url=ref->>'realmURL' AND c.file_url=ref->>'fileURL';
      IF captured IS NULL OR jsonb_typeof(captured)<>'array' THEN RETURN FALSE; END IF;
      IF jsonb_array_length(captured) NOT BETWEEN 1 AND 128 THEN RETURN FALSE; END IF;
      PERFORM f.file_path FROM jsonb_to_recordset(captured)
        AS s(realm text,path text,username text,hash text,size bigint)
        JOIN realm_user_permissions p ON p.realm_url=s.realm AND p.username=s.username
        JOIN realm_metadata m ON m.url=s.realm
        JOIN realm_file_meta f ON f.realm_url=s.realm AND f.file_path=s.path
        ORDER BY f.realm_url,f.file_path FOR SHARE OF p,m,f;
      PERFORM 1 FROM lattice_code_artifacts c WHERE c.realm_url=ref->>'realmURL'
        AND c.file_url=ref->>'fileURL' AND c.scope=captured FOR SHARE;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      RETURN lattice_code_reference_current(ref);
    END; $$;

    CREATE FUNCTION lattice_code_file_key(realm text, path text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_array(realm,path)::text $$;

    CREATE FUNCTION lattice_enqueue_code_link(realm text, username text) RETURNS void
      LANGUAGE plpgsql AS $$
    DECLARE cg text := 'lattice-code:' || realm;
    BEGIN
      -- Same transaction/claim lock as acquireConcurrencyGroupLock. Never join
      -- an already reserved job: it may have captured an older obligation.
      PERFORM pg_advisory_xact_lock(hashtext(cg));
      INSERT INTO jobs (job_type,concurrency_group,priority,timeout,args)
        SELECT 'lattice-link-code',cg,7,120,
          jsonb_build_object('realmURL',realm,'realmUsername',username)
        WHERE NOT EXISTS (
          SELECT 1 FROM jobs j WHERE j.job_type='lattice-link-code'
            AND j.concurrency_group=cg AND j.status='unfulfilled'
            AND j.args->>'realmUsername'=username
            AND NOT EXISTS (SELECT 1 FROM job_reservations r WHERE r.job_id=j.id
              AND r.completed_at IS NULL AND r.locked_until>NOW())
        );
      NOTIFY jobs;
    END; $$;

    CREATE FUNCTION lattice_invalidate_code_keys(keys text[]) RETURNS void
      LANGUAGE plpgsql AS $$
    DECLARE target record;
    BEGIN
      FOR target IN
        WITH changed AS (
          UPDATE lattice_code_artifacts SET dirty=TRUE,work_version=work_version+1
            WHERE dependency_keys ?| keys RETURNING realm_url,realm_username
        ) SELECT DISTINCT realm_url,realm_username FROM changed ORDER BY realm_url,realm_username
      LOOP
        PERFORM lattice_enqueue_code_link(target.realm_url,target.realm_username);
      END LOOP;
    END; $$;


    CREATE TABLE lattice_work_failures (
      realm_url text NOT NULL,
      owner_url text NOT NULL,
      obligation bigint NOT NULL,
      definition_revision text NOT NULL,
      code_version text,
      attempts integer NOT NULL,
      reason text NOT NULL,
      PRIMARY KEY (realm_url, owner_url)
    );

    CREATE TABLE lattice_retained_bodies (
      realm_url text NOT NULL,
      digest text NOT NULL,
      kind text NOT NULL CHECK (kind = 'data'),
      document jsonb NOT NULL,
      PRIMARY KEY (realm_url, digest)
    );
    CREATE TABLE lattice_retained_snapshots (
      realm_url text NOT NULL,
      owner_url text NOT NULL,
      field_path text NOT NULL,
      source_realm_url text NOT NULL,
      source_url text NOT NULL,
      validated_through bigint NOT NULL CHECK (validated_through >= 0),
      digest text NOT NULL,
      definition_seal text NOT NULL,
      captured_at timestamptz NOT NULL,
      state_generation bigint NOT NULL CHECK (state_generation >= 0),
      status text NOT NULL CHECK (status IN ('live', 'unavailable', 'forbidden', 'incompatible')),
      since timestamptz,
      pinned boolean NOT NULL DEFAULT false,
      note text,
      PRIMARY KEY (realm_url, owner_url, field_path, source_realm_url, source_url, validated_through),
      FOREIGN KEY (realm_url, digest) REFERENCES lattice_retained_bodies (realm_url, digest),
      CHECK ((status = 'live') = (since IS NULL))
    );
    CREATE INDEX lattice_retained_snapshot_bodies ON lattice_retained_snapshots (realm_url, digest);

    ALTER TABLE boxel_index ADD COLUMN valid_until timestamptz;
    ALTER TABLE boxel_index_working ADD COLUMN valid_until timestamptz;
    CREATE INDEX boxel_index_valid_until ON boxel_index (realm_url, valid_until)
      WHERE valid_until IS NOT NULL;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX boxel_index_valid_until;
    ALTER TABLE boxel_index_working DROP COLUMN valid_until;
    ALTER TABLE boxel_index DROP COLUMN valid_until;
    DROP TABLE lattice_retained_snapshots;
    DROP TABLE lattice_retained_bodies;
    DROP TABLE lattice_work_failures;
    DROP FUNCTION lattice_invalidate_code_keys(text[]);
    DROP FUNCTION lattice_enqueue_code_link(text,text);
    DROP FUNCTION lattice_code_file_key(text,text);
    DROP FUNCTION lattice_lock_code_reference(jsonb);
    DROP FUNCTION lattice_owner_code_current(text,text,text);
    DROP FUNCTION lattice_code_reference_current(jsonb);
    DROP TABLE lattice_owner_code;
    DROP TABLE lattice_code_artifacts;
    DROP TABLE lattice_code_realms;
    DROP TABLE lattice_publication_deliveries;
    DROP TABLE lattice_publication_events;
    DROP TABLE lattice_input_artifacts;
    DROP TABLE lattice_index_events;
    DROP TABLE lattice_pending_generations;
    DROP TABLE lattice_query_watches;
    DROP TABLE lattice_owners;
  `);
};
