// The vector table and its spaces (pgvector).
//
// One migration for this structure: the steps below are the migrations it
// was built from, in their order, each kept whole with its own
// notes. Each step's up runs in order and its down in reverse. A step that
// builds an index CONCURRENTLY calls noTransaction(), so the migration runs
// outside one transaction, as those steps did on their own.

exports.shorthands = undefined;

// ---- 1794378752846_add-boxel-index-vectors.js ----
const step1 = (() => {
  const exports = {};
  // Vector (embedding) fields, indexed for nearest-neighbour search.
  //
  // A card's VectorField values land in its search doc as marked strings
  // ("vec:[…]"), or in its sidecar (`<card>.vectors.jsonl`) when it has one.
  // When an index batch is promoted, the index writer copies each one into
  // `boxel_index_vectors` as a pgvector `vector`. A `near` sort joins that
  // table and orders by cosine distance (`<=>`).
  //
  // Every row records the full space string of its vector (vectorizer id with
  // revision, provider and size; see runtime-common/vector-space.ts), so a
  // `near` search compares only vectors of one space. A vector inside a
  // `containsMany` item is keyed by the item's platform-assigned id
  // (`item_id`), never by its position, so reordering items moves nothing; a
  // single vector field has an empty `item_id`. `source_hash` is the hash of
  // what the vector was made from, when known.
  //
  // The table is partitioned by space, as Elasticsearch and OpenSearch keep
  // one index per embedding model, so vectors of different models and realms
  // do not share pages. The primary key includes `space`, as a partitioned
  // table's unique key must include its partition key. `boxel_vector_spaces`
  // records each space's partition (a readable prefix and a hash of the space,
  // since a space is free text) and its size. The engine creates a space's
  // partition, with an HNSW index over a half-precision copy of its vectors,
  // the first time it writes a vector in it (runtime-common/vector-store-pg.ts,
  // under an advisory lock). Rows of a space with no partition yet land in the
  // DEFAULT partition, which the engine empties into the space's partition
  // when it creates it.
  //
  // `boxel_index_vector_sidecars` remembers the hash and modified time of the
  // sidecar each card's rows were loaded from: a sidecar whose time moved sends
  // its card to be indexed again, and one whose hash is unchanged is not read
  // into the table again. `errors` lists the lines that were left out (a wrong
  // space, an unknown field), each an error on that vector, not on the card.
  //
  // The tables need the pgvector extension, which Boxel's Postgres images do
  // not all ship yet (and which is not a trusted extension, so creating it
  // needs a superuser, or rds_superuser on RDS). This migration therefore
  // creates the extension and tables only where pgvector is available and
  // creatable, and otherwise does nothing: the index writer then skips the
  // vector copy, and a `near` sort is refused with a message that names the
  // missing extension. To enable vectors on such a database later, install
  // pgvector and run the SQL in `up` again by hand (every statement is
  // idempotent), then reindex the realms whose cards carry vectors.

  exports.up = (pgm) => {
    pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        RAISE NOTICE 'pgvector is not installed; vector search stays disabled';
        RETURN;
      END IF;
      BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'not allowed to create the vector extension; vector search stays disabled';
        RETURN;
      END;
      CREATE TABLE IF NOT EXISTS boxel_index_vectors (
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
        CONSTRAINT boxel_index_vectors_pkey
          PRIMARY KEY (realm_url, url, type, field_path, item_id, space)
      ) PARTITION BY LIST (space);
      CREATE TABLE IF NOT EXISTS boxel_index_vectors_default
        PARTITION OF boxel_index_vectors DEFAULT;
      CREATE INDEX IF NOT EXISTS boxel_index_vectors_field_idx
        ON boxel_index_vectors (realm_url, field_path, dims);
      CREATE INDEX IF NOT EXISTS boxel_index_vectors_space_idx
        ON boxel_index_vectors (realm_url, field_path, space);
      CREATE TABLE IF NOT EXISTS boxel_vector_spaces (
        space TEXT PRIMARY KEY,
        partition_name TEXT NOT NULL UNIQUE,
        dims INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
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
    pgm.sql(`DROP TABLE IF EXISTS boxel_index_vector_sidecars`);
    pgm.sql(`DROP TABLE IF EXISTS boxel_vector_spaces`);
    pgm.sql(`DROP TABLE IF EXISTS boxel_index_vectors`);
  };
  return exports;
})();

const steps = [step1];

exports.up = async (pgm) => {
  for (let step of steps) await step.up(pgm);
};

exports.down = async (pgm) => {
  for (let step of [...steps].reverse()) await step.down(pgm);
};
