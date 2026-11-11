// Facet values: the values of every field a card type declares
// `search: { facet: true }` (docs/search.md, Facets), one row per card,
// facet path and distinct value. Facets are counted from this table alone:
// a facet's counts, ranges, date buckets, statistics and measures read the
// matched cards' rows here, joined to `boxel_index` on the card's key, and
// never the search doc. The built-in facets (card type, realm, created,
// modified) read `boxel_index`'s own columns and keep no rows here.
//
// The index writer replaces a card's rows when it promotes a pass
// (`#syncFacetIndex` in runtime-common's index-writer), from the staged
// doc's declared facet fields (`_searchText.facets`), so a card's rows and its
// `boxel_index` row change in one transaction. A card that is deleted keeps
// none; a deleted realm's rows go with it (realm-destruction-utils).
//
// `txt` is the value as text (a link's linked card id), `num` the value when
// it is a JSON number, `ts` its UTC instant when the field is a date or
// date-time and the value reads as one. A value longer than 1,024 characters
// is not kept: no facet counts by a paragraph, and a btree entry has a size
// limit.
//
// Postgres only (excluded from the SQLite schema): the browser index refuses
// facets with `needs-postgres`.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_index_facet_values (
      realm_url TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      field_path TEXT NOT NULL,
      txt TEXT NOT NULL,
      num NUMERIC,
      ts TIMESTAMPTZ,
      CONSTRAINT boxel_index_facet_values_pkey
        PRIMARY KEY (realm_url, url, type, field_path, txt)
    );
    CREATE INDEX IF NOT EXISTS boxel_index_facet_values_txt_idx
      ON boxel_index_facet_values (realm_url, field_path, txt, url);
    CREATE INDEX IF NOT EXISTS boxel_index_facet_values_num_idx
      ON boxel_index_facet_values (realm_url, field_path, num, url)
      WHERE num IS NOT NULL;
    CREATE INDEX IF NOT EXISTS boxel_index_facet_values_ts_idx
      ON boxel_index_facet_values (realm_url, field_path, ts, url)
      WHERE ts IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS boxel_index_facet_values`);
};
