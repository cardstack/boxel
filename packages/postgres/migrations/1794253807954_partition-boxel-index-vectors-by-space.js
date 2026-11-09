// `boxel_index_vectors` is partitioned by space.
//
// A near search compares a target only with vectors of its own space (the
// vectorizer with its revision, the provider and the size; see
// runtime-common/vector-space.ts), so space is a safe partition key: one
// partition per space, as Elasticsearch and OpenSearch keep one index per
// embedding model. Vectors of different fields' models and of other realms
// then stop sharing pages: an exact top-10 over OnTube's segments read all
// 54,289 pages of the table (2.5 s) because 198,532 of its vectors were
// interleaved with everyone else's.
//
// `boxel_vector_spaces` records each space's partition (a readable prefix
// and a hash of the space, since a space is free text) and its size. The
// engine creates a space's partition the first time it writes a vector in it
// (runtime-common/vector-store-pg.ts, under an advisory lock). Rows of a
// space with no partition yet land in the DEFAULT partition, which the
// engine empties into the space's partition when it creates it, so a
// revision that does not create partitions (the previous one, mid-rollout)
// still writes and reads correctly.
//
// The primary key includes `space`, as a partitioned table's unique key must
// include its partition key. The index writer deletes a card's rows before it
// writes them again, so a field whose space changes moves its rows: they
// leave the old space's partition and land in the new one.
//
// Postgres cannot partition a table in place, so `up` builds the partitioned
// table beside the old one, copies the rows across and swaps the names. The
// old table is held in SHARE mode while it is copied: searches keep reading
// it, and writes wait for the swap (about 250k rows on the largest stack, a
// few seconds). The swap keeps the table's name, columns and index names, so
// the previous revision's statements still work against it, and the old
// table is dropped in the same transaction. The per-field look-alike indexes
// (`boxel_index_vectors_nb_*`) go with it: an index on a partitioned table is
// built per partition, and a later migration builds one per space.
//
// check-removal-phase: allow the swap keeps the table's name, columns and index names, so the previous revision's reads and writes still work
//
// Like the table's own migration, this does nothing where pgvector (and so
// the table) is missing, and it does nothing to a table that is already
// partitioned, so it can run again. `down` copies the rows back into one
// table (keeping one row per old key) and drops the catalog.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      r record;
      part text;
    BEGIN
      IF to_regclass('boxel_index_vectors') IS NULL THEN
        RAISE NOTICE 'no vector table; nothing to partition';
        RETURN;
      END IF;
      CREATE TABLE IF NOT EXISTS boxel_vector_spaces (
        space TEXT PRIMARY KEY,
        partition_name TEXT NOT NULL UNIQUE,
        dims INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      IF EXISTS (
        SELECT 1 FROM pg_partitioned_table
         WHERE partrelid = 'boxel_index_vectors'::regclass
      ) THEN
        RAISE NOTICE 'boxel_index_vectors is already partitioned';
        RETURN;
      END IF;

      LOCK TABLE boxel_index_vectors IN SHARE MODE;

      DROP TABLE IF EXISTS boxel_index_vectors_by_space;
      CREATE TABLE boxel_index_vectors_by_space (
        realm_url TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        field_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        dims INTEGER NOT NULL,
        embedding vector NOT NULL,
        item_id TEXT NOT NULL DEFAULT '',
        space TEXT NOT NULL DEFAULT '',
        source_hash TEXT,
        CONSTRAINT boxel_index_vectors_by_space_pkey
          PRIMARY KEY (realm_url, url, type, field_path, item_id, space)
      ) PARTITION BY LIST (space);
      CREATE TABLE boxel_index_vectors_default
        PARTITION OF boxel_index_vectors_by_space DEFAULT;

      DELETE FROM boxel_vector_spaces;
      FOR r IN
        SELECT space, max(dims) AS dims FROM boxel_index_vectors GROUP BY space
      LOOP
        -- the same name runtime-common/vector-store-pg.ts gives a new space
        part := 'boxel_index_vectors_'
          || left(coalesce(nullif(trim(both '_' FROM regexp_replace(
               lower(split_part(split_part(r.space, '@', 1), ' ', 1)),
               '[^a-z0-9]+', '_', 'g')), ''), 'space'), 18)
          || '_' || r.dims || '_' || left(md5(r.space), 8);
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF boxel_index_vectors_by_space FOR VALUES IN (%L)',
          part, r.space
        );
        INSERT INTO boxel_vector_spaces (space, partition_name, dims)
          VALUES (r.space, part, r.dims);
      END LOOP;

      INSERT INTO boxel_index_vectors_by_space
          (realm_url, url, type, field_path, ordinal, dims, embedding,
           item_id, space, source_hash)
        SELECT realm_url, url, type, field_path, ordinal, dims, embedding,
               item_id, space, source_hash
          FROM boxel_index_vectors;
      CREATE INDEX boxel_index_vectors_by_space_field_idx
        ON boxel_index_vectors_by_space (realm_url, field_path, dims);
      CREATE INDEX boxel_index_vectors_by_space_space_idx
        ON boxel_index_vectors_by_space (realm_url, field_path, space);

      DROP TABLE boxel_index_vectors;
      ALTER TABLE boxel_index_vectors_by_space RENAME TO boxel_index_vectors;
      ALTER TABLE boxel_index_vectors
        RENAME CONSTRAINT boxel_index_vectors_by_space_pkey
        TO boxel_index_vectors_pkey;
      ALTER INDEX boxel_index_vectors_by_space_field_idx
        RENAME TO boxel_index_vectors_field_idx;
      ALTER INDEX boxel_index_vectors_by_space_space_idx
        RENAME TO boxel_index_vectors_space_idx;
      ANALYZE boxel_index_vectors;
    END
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('boxel_index_vectors') IS NULL THEN
        DROP TABLE IF EXISTS boxel_vector_spaces;
        RETURN;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_partitioned_table
         WHERE partrelid = 'boxel_index_vectors'::regclass
      ) THEN
        DROP TABLE IF EXISTS boxel_vector_spaces;
        RETURN;
      END IF;

      LOCK TABLE boxel_index_vectors IN SHARE MODE;

      DROP TABLE IF EXISTS boxel_index_vectors_flat;
      CREATE TABLE boxel_index_vectors_flat (
        realm_url TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        field_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        dims INTEGER NOT NULL,
        embedding vector NOT NULL,
        item_id TEXT NOT NULL DEFAULT '',
        space TEXT NOT NULL DEFAULT '',
        source_hash TEXT,
        CONSTRAINT boxel_index_vectors_flat_pkey
          PRIMARY KEY (realm_url, url, type, field_path, item_id)
      );
      -- One row per old key: the writer never keeps two spaces of one item,
      -- but the partitioned key allows it.
      INSERT INTO boxel_index_vectors_flat
          (realm_url, url, type, field_path, ordinal, dims, embedding,
           item_id, space, source_hash)
        SELECT DISTINCT ON (realm_url, url, type, field_path, item_id)
               realm_url, url, type, field_path, ordinal, dims, embedding,
               item_id, space, source_hash
          FROM boxel_index_vectors
         ORDER BY realm_url, url, type, field_path, item_id, space;
      CREATE INDEX boxel_index_vectors_flat_field_idx
        ON boxel_index_vectors_flat (realm_url, field_path, dims);
      CREATE INDEX boxel_index_vectors_flat_space_idx
        ON boxel_index_vectors_flat (realm_url, field_path, space);

      DROP TABLE boxel_index_vectors;
      ALTER TABLE boxel_index_vectors_flat RENAME TO boxel_index_vectors;
      ALTER TABLE boxel_index_vectors
        RENAME CONSTRAINT boxel_index_vectors_flat_pkey
        TO boxel_index_vectors_pkey;
      ALTER INDEX boxel_index_vectors_flat_field_idx
        RENAME TO boxel_index_vectors_field_idx;
      ALTER INDEX boxel_index_vectors_flat_space_idx
        RENAME TO boxel_index_vectors_space_idx;
      DROP TABLE IF EXISTS boxel_vector_spaces;
    END
    $$;
  `);
};
