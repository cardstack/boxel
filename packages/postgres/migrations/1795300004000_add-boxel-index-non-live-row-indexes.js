// Partial indexes over the rows a counts-only html search must find without
// reading the index's heap: the instance rows that are not live cards, so
// the value store does not hold them (value-store.ts, `LIVE_CARD`), while an
// html search lists them, as error cards.
//
// An instance row is not live when it has an error, or when a prerendered
// render error from its generation or later stands against it (its types
// are always a list: the index writer writes an instance's types as one).
// The first kind is `boxel_index_non_live_rows_idx`. The second is found
// from `prerendered_html_instance_errors_idx`, every instance render error
// of a realm, a stale or kept-last-good one too, so a superset. Keyed by
// realm, so "does this realm hold any" is an index-only read and the rows
// are one index range. The engine repeats each predicate word for word
// (`nonLiveRow`, `instanceRenderError` in query-engine/non-live-rows.ts).
// Postgres only.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS boxel_index_non_live_rows_idx
      ON boxel_index (realm_url, url)
      WHERE type = 'instance' AND is_deleted IS NOT TRUE AND has_error;
    CREATE INDEX IF NOT EXISTS prerendered_html_instance_errors_idx
      ON prerendered_html (realm_url, url)
      WHERE type = 'instance' AND error_doc IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS boxel_index_non_live_rows_idx;
    DROP INDEX IF EXISTS prerendered_html_instance_errors_idx;
  `);
};
