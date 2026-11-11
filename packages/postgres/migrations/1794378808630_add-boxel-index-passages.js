// Passages: the items of a card's PassageField lists, searchable one by one.
//
// A card can hold a long text as a list of passages (a talk's transcript
// segments, a book's chapters) instead of one card per passage. When an index
// pass promotes its rows, the index writer copies each passage of every card
// it touched into this table: one row per (card, field, position), with the
// passage's start, end and text, and the text's english tsvector. A
// `matches` filter with `within: '<field>'` asks this table's GIN index which
// cards have a matching passage, and a search reports the passages that
// matched (`meta.passages`).
//
// `tsv` is computed by the writer's INSERT rather than by an expression index
// so ranking can read it back.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_index_passages (
      realm_url TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      field_path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      start_at DOUBLE PRECISION,
      end_at DOUBLE PRECISION,
      body TEXT NOT NULL,
      tsv TSVECTOR NOT NULL,
      CONSTRAINT boxel_index_passages_pkey
        PRIMARY KEY (realm_url, url, type, field_path, ordinal)
    );
    CREATE INDEX IF NOT EXISTS boxel_index_passages_tsv_idx
      ON boxel_index_passages USING GIN (tsv);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS boxel_index_passages`);
};
