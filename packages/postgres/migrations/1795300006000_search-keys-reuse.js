// A staged row reuses its live row's `search_keys` when the doc they were
// projected from is the one being staged, instead of projecting it again.
//
// Projecting a doc (`search_keys_of`) is most of what staging a row costs
// beyond main: on a 12,084-card realm it is 3.3 s of the pass, single-threaded
// inside the staging inserts. A reindex whose docs did not change (a module
// change re-renders every card without changing its data) projects every doc
// to the same keys it already has.
//
// The reuse is keyed so that it can never answer differently from projecting:
// - `boxel_index.search_keys_fp` is `search_keys_fp_of(doc)`, the md5 of the
//   projection's version and the exact staged doc (render search text
//   included) the row's keys were projected from. Promotion writes it.
// - `search_keys_version()` names the projection: the md5 of the sources of
//   `search_keys_of` and `search_keys_project`. A test holds it to those
//   sources, so a migration that changes either function must change the
//   version, and every stored fingerprint then misses and the keys are
//   projected again.
// - The staging trigger reuses the live row's keys only when that row's
//   fingerprint equals the staged doc's; a missing or different fingerprint
//   projects the doc, as before.
//
// Nullable, no default, no backfill: a row gains its fingerprint the next time
// it is promoted, and until then its keys are projected as before.

exports.shorthands = undefined;

const SEARCH_KEYS_VERSION = '355a20271f7c8b5676cebc1df24c54f6';
exports.SEARCH_KEYS_VERSION = SEARCH_KEYS_VERSION;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_keys_fp TEXT;

    CREATE OR REPLACE FUNCTION search_keys_version() RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$ SELECT '${SEARCH_KEYS_VERSION}'::text $$;

    CREATE OR REPLACE FUNCTION search_keys_fp_of(doc jsonb) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$ SELECT CASE WHEN doc IS NULL THEN NULL
                   ELSE md5(search_keys_version() || ':' || doc::text) END $$;

    CREATE OR REPLACE FUNCTION boxel_index_pending_fill_search_keys()
      RETURNS trigger LANGUAGE plpgsql AS $function$
    DECLARE
      live jsonb;
    BEGIN
      -- When the keys are filled is as boxel_index_fill_search_keys has it.
      IF NEW.search_keys IS NULL
         OR (TG_OP = 'UPDATE'
             AND NEW.search_keys IS NOT DISTINCT FROM OLD.search_keys
             AND NEW.search_doc IS DISTINCT FROM OLD.search_doc) THEN
        live := NULL;
        IF NEW.search_doc IS NOT NULL THEN
          SELECT i.search_keys INTO live
            FROM boxel_index AS i
           WHERE i.url = NEW.url
             AND i.realm_url = NEW.realm_url
             AND i.type = NEW.type
             AND i.search_keys IS NOT NULL
             AND i.search_keys_fp = search_keys_fp_of(NEW.search_doc);
        END IF;
        NEW.search_keys := COALESCE(live, search_keys_of(NEW.search_doc));
      END IF;
      RETURN NEW;
    END
    $function$;

    DROP TRIGGER IF EXISTS boxel_index_pending_fill_search_keys ON boxel_index_pending;
    CREATE TRIGGER boxel_index_pending_fill_search_keys
      BEFORE INSERT OR UPDATE OF search_doc ON boxel_index_pending
      FOR EACH ROW EXECUTE FUNCTION boxel_index_pending_fill_search_keys();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS boxel_index_pending_fill_search_keys ON boxel_index_pending;
    CREATE TRIGGER boxel_index_pending_fill_search_keys
      BEFORE INSERT OR UPDATE OF search_doc ON boxel_index_pending
      FOR EACH ROW EXECUTE FUNCTION boxel_index_fill_search_keys();
    DROP FUNCTION IF EXISTS boxel_index_pending_fill_search_keys();
    DROP FUNCTION IF EXISTS search_keys_fp_of(jsonb);
    DROP FUNCTION IF EXISTS search_keys_version();
    ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_keys_fp;
  `);
};
