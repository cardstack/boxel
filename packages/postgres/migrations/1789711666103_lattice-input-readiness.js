exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Derived index facts, never authored card bodies. Owner state remains in
    -- lattice_owners; both relations change in the writer's transaction.
    CREATE UNLOGGED TABLE lattice_input_readiness (
      realm_url varchar NOT NULL,
      url varchar NOT NULL,
      generation bigint,
      has_error boolean,
      is_deleted boolean,
      types jsonb,
      search_doc jsonb,
      pristine_doc jsonb,
      PRIMARY KEY (realm_url,url)
    );
    CREATE INDEX lattice_input_readiness_types ON lattice_input_readiness USING gin(types);

    CREATE FUNCTION lattice_readiness_index_row(i_url text,i_realm_url text,i_generation bigint,i_has_error boolean,i_is_deleted boolean,i_types jsonb,i_search_doc jsonb,i_pristine_doc jsonb) RETURNS void
    LANGUAGE plpgsql AS $$
    DECLARE publication jsonb := i_pristine_doc->'meta'->'publication';
      projected jsonb; header jsonb;
    BEGIN
      SELECT coalesce(jsonb_object_agg(key,i_search_doc->key),'{}'::jsonb)
        INTO projected FROM jsonb_object_keys(CASE WHEN
          jsonb_typeof(publication->'sourceFields')='object'
          THEN publication->'sourceFields' ELSE '{}'::jsonb END) AS fields(key)
        WHERE i_search_doc ? key;
      SELECT CASE WHEN publication IS NULL THEN '{}'::jsonb ELSE
        jsonb_build_object('meta',jsonb_build_object('publication',jsonb_build_object(
          'version',publication->'version','state',publication->'state',
          'definitionRevision',publication->'definitionRevision',
          'computedFields',publication->'computedFields','queryFields',publication->'queryFields',
          'outputRevision',publication->'outputRevision','validatedThrough',publication->'validatedThrough',
          'sourceFields',publication->'sourceFields'))) END INTO header;
      INSERT INTO lattice_input_readiness AS r
        (realm_url,url,generation,has_error,is_deleted,types,search_doc,pristine_doc)
        VALUES(i_realm_url,i_url,i_generation,i_has_error,i_is_deleted,i_types,projected,header)
      ON CONFLICT(realm_url,url) DO UPDATE SET generation=EXCLUDED.generation,
        has_error=EXCLUDED.has_error,is_deleted=EXCLUDED.is_deleted,types=EXCLUDED.types,
        search_doc=EXCLUDED.search_doc,pristine_doc=EXCLUDED.pristine_doc
      WHERE (r.generation,r.has_error,r.is_deleted,r.types,r.search_doc,r.pristine_doc)
        IS DISTINCT FROM (EXCLUDED.generation,EXCLUDED.has_error,EXCLUDED.is_deleted,
          EXCLUDED.types,EXCLUDED.search_doc,EXCLUDED.pristine_doc);
    END; $$;

    CREATE FUNCTION lattice_readiness_index_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='TRUNCATE' THEN DELETE FROM lattice_input_readiness; RETURN NULL; END IF;
      IF TG_OP='DELETE' THEN
        IF OLD.type='instance' THEN DELETE FROM lattice_input_readiness
          WHERE realm_url=OLD.realm_url AND url=OLD.url; END IF;
        RETURN NULL;
      END IF;
      IF TG_OP='UPDATE' AND (OLD.realm_url,OLD.url,OLD.type)
        IS DISTINCT FROM (NEW.realm_url,NEW.url,NEW.type) THEN
        DELETE FROM lattice_input_readiness WHERE realm_url=OLD.realm_url AND url=OLD.url;
      END IF;
      IF NEW.type='instance' AND (
        NEW.pristine_doc->'meta'->'publication' IS NOT NULL OR
        EXISTS(SELECT 1 FROM lattice_owners WHERE realm_url=NEW.realm_url AND owner_url=NEW.url) OR
        EXISTS(SELECT 1 FROM lattice_input_readiness WHERE realm_url=NEW.realm_url AND url=NEW.url)) THEN
        PERFORM lattice_readiness_index_row(NEW.url,NEW.realm_url,NEW.generation,NEW.has_error,NEW.is_deleted,NEW.types,NEW.search_doc,NEW.pristine_doc);
      END IF;
      RETURN NULL;
    END; $$;
    CREATE TRIGGER lattice_readiness_index_changed AFTER INSERT OR UPDATE OR DELETE ON boxel_index
      FOR EACH ROW EXECUTE FUNCTION lattice_readiness_index_changed();
    CREATE TRIGGER lattice_readiness_index_truncated AFTER TRUNCATE ON boxel_index
      FOR EACH STATEMENT EXECUTE FUNCTION lattice_readiness_index_changed();

    -- Legacy/test registrations can predate publication metadata. Lock the index
    -- row before seeding so a concurrent primary update cannot be overwritten.
    CREATE FUNCTION lattice_readiness_owner_registered() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE indexed boxel_index;
    BEGIN
      SELECT * INTO indexed FROM boxel_index WHERE realm_url=NEW.realm_url
        AND url=NEW.owner_url AND type='instance' FOR SHARE;
      IF FOUND THEN PERFORM lattice_readiness_index_row(indexed.url,indexed.realm_url,indexed.generation,indexed.has_error,indexed.is_deleted,indexed.types,indexed.search_doc,indexed.pristine_doc); END IF;
      RETURN NULL;
    END; $$;
    CREATE TRIGGER lattice_readiness_owner_registered AFTER INSERT ON lattice_owners
      FOR EACH ROW EXECUTE FUNCTION lattice_readiness_owner_registered();

    -- Positive code proofs are shared by all cards using the same definition.
    -- NULL means revalidate using the original live proof, never assume current.
    -- Unlogged like the code artifacts/bindings: a crash cannot preserve a proof
    -- after losing the artifacts it certifies.
    CREATE UNLOGGED TABLE lattice_readiness_code (
      reference jsonb PRIMARY KEY,
      current boolean,
      dependency_keys text[] NOT NULL
    );
    CREATE INDEX lattice_readiness_code_dependencies ON lattice_readiness_code USING gin(dependency_keys);
    CREATE FUNCTION lattice_readiness_bind_code(ref jsonb) RETURNS void LANGUAGE plpgsql AS $$
    DECLARE scope jsonb; keys text[]; valid boolean;
    BEGIN
      IF EXISTS(SELECT 1 FROM lattice_readiness_code c WHERE c.reference=ref AND c.current IS TRUE) THEN RETURN; END IF;
      valid := lattice_lock_code_reference(ref);
      IF NOT valid THEN RETURN; END IF;
      SELECT c.scope INTO scope FROM lattice_code_artifacts c
        WHERE c.realm_url=ref->>'realmURL' AND c.file_url=ref->>'fileURL';
      SELECT array_agg(DISTINCT key) INTO keys FROM (
        SELECT jsonb_build_array('artifact',ref->>'realmURL',ref->>'fileURL')::text AS key
        UNION ALL SELECT jsonb_build_array('runtime',ref->>'realmURL')::text
        UNION ALL SELECT jsonb_build_array('file',s.realm,s.path)::text
          FROM jsonb_to_recordset(scope) AS s(realm text,path text)
        UNION ALL SELECT jsonb_build_array('permission',s.realm,s.username)::text
          FROM jsonb_to_recordset(scope) AS s(realm text,username text)
        UNION ALL SELECT jsonb_build_array('metadata',s.realm)::text
          FROM jsonb_to_recordset(scope) AS s(realm text)
      ) dependencies;
      INSERT INTO lattice_readiness_code(reference,current,dependency_keys) VALUES(ref,TRUE,keys)
        ON CONFLICT(reference) DO UPDATE SET current=TRUE,dependency_keys=EXCLUDED.dependency_keys;
    END; $$;
    CREATE FUNCTION lattice_readiness_code_bound() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM lattice_readiness_bind_code(NEW.reference); RETURN NULL; END; $$;
    CREATE TRIGGER lattice_readiness_code_bound AFTER INSERT OR UPDATE OF reference ON lattice_owner_code
      FOR EACH ROW EXECUTE FUNCTION lattice_readiness_code_bound();

    CREATE FUNCTION lattice_readiness_code_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE old_row jsonb; new_row jsonb; row_data jsonb; keys text[] := '{}'; key text;
    BEGIN
      IF TG_OP='TRUNCATE' THEN UPDATE lattice_readiness_code SET current=NULL WHERE current IS TRUE; RETURN NULL; END IF;
      IF TG_OP<>'INSERT' THEN old_row := to_jsonb(OLD); END IF;
      IF TG_OP<>'DELETE' THEN new_row := to_jsonb(NEW); END IF;
      IF TG_TABLE_NAME='realm_file_meta' AND TG_OP='UPDATE' AND
        (old_row->'realm_url',old_row->'file_path',old_row->'content_hash',old_row->'content_size') IS NOT DISTINCT FROM
        (new_row->'realm_url',new_row->'file_path',new_row->'content_hash',new_row->'content_size') THEN RETURN NULL; END IF;
      IF TG_TABLE_NAME='realm_metadata' AND TG_OP='UPDATE' AND
        (old_row->'url',old_row->'archived_at') IS NOT DISTINCT FROM
        (new_row->'url',new_row->'archived_at') THEN RETURN NULL; END IF;
      IF TG_TABLE_NAME='realm_user_permissions' AND TG_OP='UPDATE' AND
        (old_row->'realm_url',old_row->'username',old_row->'read') IS NOT DISTINCT FROM
        (new_row->'realm_url',new_row->'username',new_row->'read') THEN RETURN NULL; END IF;
      IF TG_TABLE_NAME='lattice_code_realms' AND TG_OP='UPDATE' AND
        (old_row->'realm_url',old_row->'actor_user_id',old_row->'runtime_revision',old_row->'policy_revision') IS NOT DISTINCT FROM
        (new_row->'realm_url',new_row->'actor_user_id',new_row->'runtime_revision',new_row->'policy_revision') THEN RETURN NULL; END IF;
      FOR row_data IN SELECT value FROM jsonb_array_elements(jsonb_build_array(old_row,new_row)) WHERE value<>'null'::jsonb LOOP
        key := CASE TG_TABLE_NAME
          WHEN 'realm_file_meta' THEN jsonb_build_array('file',row_data->>'realm_url',row_data->>'file_path')::text
          WHEN 'realm_user_permissions' THEN jsonb_build_array('permission',row_data->>'realm_url',row_data->>'username')::text
          WHEN 'realm_metadata' THEN jsonb_build_array('metadata',row_data->>'url')::text
          WHEN 'lattice_code_artifacts' THEN jsonb_build_array('artifact',row_data->>'realm_url',row_data->>'file_url')::text
          WHEN 'lattice_code_realms' THEN jsonb_build_array('runtime',row_data->>'realm_url')::text END;
        keys := array_append(keys,key);
      END LOOP;
      UPDATE lattice_readiness_code SET current=NULL WHERE current IS TRUE AND dependency_keys && keys;
      RETURN NULL;
    END; $$;
  `);
  for (const table of [
    'realm_file_meta',
    'realm_user_permissions',
    'realm_metadata',
    'lattice_code_artifacts',
    'lattice_code_realms',
  ]) {
    pgm.sql(`CREATE TRIGGER lattice_readiness_code_changed AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION lattice_readiness_code_changed();
      CREATE TRIGGER lattice_readiness_code_truncated AFTER TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION lattice_readiness_code_changed();`);
  }
  pgm.sql(`
    SELECT lattice_readiness_index_row(i.url,i.realm_url,i.generation,i.has_error,i.is_deleted,i.types,i.search_doc,i.pristine_doc) FROM boxel_index i WHERE i.type='instance'
      AND (i.pristine_doc->'meta'->'publication' IS NOT NULL OR EXISTS
        (SELECT 1 FROM lattice_owners o WHERE o.realm_url=i.realm_url AND o.owner_url=i.url));
    SELECT lattice_readiness_bind_code(reference) FROM (SELECT DISTINCT reference FROM lattice_owner_code) bindings;
  `);
};

exports.down = (pgm) => {
  for (const table of [
    'realm_file_meta',
    'realm_user_permissions',
    'realm_metadata',
    'lattice_code_artifacts',
    'lattice_code_realms',
  ]) {
    pgm.sql(`DROP TRIGGER lattice_readiness_code_changed ON ${table};
      DROP TRIGGER lattice_readiness_code_truncated ON ${table};`);
  }
  pgm.sql(`
    DROP TRIGGER lattice_readiness_code_bound ON lattice_owner_code;
    DROP FUNCTION lattice_readiness_code_bound();
    DROP FUNCTION lattice_readiness_code_changed();
    DROP FUNCTION lattice_readiness_bind_code(jsonb);
    DROP TABLE lattice_readiness_code;
    DROP TRIGGER lattice_readiness_owner_registered ON lattice_owners;
    DROP FUNCTION lattice_readiness_owner_registered();
    DROP TRIGGER lattice_readiness_index_changed ON boxel_index;
    DROP TRIGGER lattice_readiness_index_truncated ON boxel_index;
    DROP FUNCTION lattice_readiness_index_changed();
    DROP FUNCTION lattice_readiness_index_row(text,text,bigint,boolean,boolean,jsonb,jsonb,jsonb);
    DROP TABLE lattice_input_readiness;
  `);
};
