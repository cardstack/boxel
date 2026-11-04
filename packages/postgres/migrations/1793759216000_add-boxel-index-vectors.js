// Vector (embedding) fields, indexed for nearest-neighbour search.
//
// A card's VectorField values land in its search doc as marked strings
// ("vec:[…]"). When an index batch is promoted, the index writer copies each
// one into `boxel_index_vectors`, one row per (card, field path, position),
// as a pgvector `vector`. A `near` sort joins that table and orders by cosine
// distance (`<=>`).
//
// The table needs the pgvector extension, which Boxel's Postgres images do not
// all ship yet (and which is not a trusted extension, so creating it needs a
// superuser, or rds_superuser on RDS). This migration therefore creates the
// extension and table only where pgvector is available and creatable, and
// otherwise does nothing: the index writer then skips the vector copy, and a
// `near` sort is refused with a message that names the missing extension. To
// enable vectors on such a database later, install pgvector and run the SQL
// in `up` again by hand (every statement is idempotent), then reindex the
// realms whose cards carry vectors.
//
// No HNSW index is built. Exact search reads ~205k 256-d vectors in ~45 ms,
// and an HNSW index costs minutes to build at that size and slows every
// index write, while giving approximate, filter-hostile results. A realm that
// grows past a few million vectors can add a partial expression index per
// dimension, e.g.
//   CREATE INDEX CONCURRENTLY … ON boxel_index_vectors
//     USING hnsw ((embedding::vector(256)) vector_cosine_ops) WHERE dims = 256;

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
        CONSTRAINT boxel_index_vectors_pkey
          PRIMARY KEY (realm_url, url, type, field_path, ordinal)
      );
      CREATE INDEX IF NOT EXISTS boxel_index_vectors_field_idx
        ON boxel_index_vectors (realm_url, field_path, dims);
    END
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS boxel_index_vectors`);
};
