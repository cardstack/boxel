// Vectors record their space, and list items are keyed by a stable id.
//
// Every row of `boxel_index_vectors` now records the full space string of
// the vector it holds (vectorizer id with revision, provider and size; see
// runtime-common/vector-space.ts), so a `near` search compares only vectors
// of one space. A vector inside a `containsMany` item is keyed by the item's
// platform-assigned id (`item_id`), never by its position, so reordering
// items moves nothing; a single vector field has an empty `item_id`.
// `source_hash` is the hash of what the vector was made from, when known.
//
// A card's vectors are read from its sidecar (`<card>.vectors.jsonl`) when
// it has one. `boxel_index_vector_sidecars` remembers the hash and modified
// time of the sidecar each card's rows were loaded from: a sidecar whose
// time moved sends its card to be indexed again, and one whose hash is
// unchanged is not read into the table again. `errors` lists the lines that
// were left out (a wrong space, an unknown field), each an error on that
// vector rather than on the card.
//
// Like the table's own migration, this does nothing where pgvector (and so
// the table) is missing. Existing rows keep working until their card is
// indexed again: a plural vector's position becomes its `item_id`
// ('#<position>'), and a row with no space reads as unknown, which matches
// nothing until reindexing writes the space.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('boxel_index_vectors') IS NULL THEN
        RAISE NOTICE 'no vector table; nothing to change';
        RETURN;
      END IF;
      ALTER TABLE boxel_index_vectors
        ADD COLUMN IF NOT EXISTS item_id TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS space TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS source_hash TEXT;
      UPDATE boxel_index_vectors
        SET item_id = '#' || ordinal
        WHERE item_id = '' AND ordinal > 0;
      ALTER TABLE boxel_index_vectors
        DROP CONSTRAINT IF EXISTS boxel_index_vectors_pkey;
      ALTER TABLE boxel_index_vectors
        ADD CONSTRAINT boxel_index_vectors_pkey
          PRIMARY KEY (realm_url, url, type, field_path, item_id);
      CREATE INDEX IF NOT EXISTS boxel_index_vectors_space_idx
        ON boxel_index_vectors (realm_url, field_path, space);
      CREATE TABLE IF NOT EXISTS boxel_index_vector_sidecars (
        realm_url TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        sidecar_hash TEXT NOT NULL,
        sidecar_mtime BIGINT,
        errors JSONB NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT boxel_index_vector_sidecars_pkey
          PRIMARY KEY (realm_url, url, type)
      );
    END
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('boxel_index_vectors') IS NULL THEN
        RETURN;
      END IF;
      DROP TABLE IF EXISTS boxel_index_vector_sidecars;
      DELETE FROM boxel_index_vectors a USING boxel_index_vectors b
        WHERE a.ctid < b.ctid
          AND (a.realm_url, a.url, a.type, a.field_path, a.ordinal)
            = (b.realm_url, b.url, b.type, b.field_path, b.ordinal);
      ALTER TABLE boxel_index_vectors
        DROP CONSTRAINT IF EXISTS boxel_index_vectors_pkey;
      ALTER TABLE boxel_index_vectors
        ADD CONSTRAINT boxel_index_vectors_pkey
          PRIMARY KEY (realm_url, url, type, field_path, ordinal);
      DROP INDEX IF EXISTS boxel_index_vectors_space_idx;
      ALTER TABLE boxel_index_vectors
        DROP COLUMN IF EXISTS item_id,
        DROP COLUMN IF EXISTS space,
        DROP COLUMN IF EXISTS source_hash;
    END
    $$;
  `);
};
