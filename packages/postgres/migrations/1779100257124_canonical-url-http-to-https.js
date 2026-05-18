'use strict';

// Local realm-server flipped from http://localhost:42XX to
// https://localhost:42XX as the canonical scheme when the realm-server
// terminates HTTPS+HTTP/2. Every row that was indexed/persisted under
// the old canonical needs its URLs rewritten in place so URL-keyed
// lookups (PK matches, JSONB references, transpiled module imports,
// etc.) continue resolving without depending on the wire-level
// HTTP→HTTPS redirect.
//
// Strategy: auto-discover every text-like and JSONB column on every
// public table (except `modules`, which the realm-server truncates on
// startup, so any rewrite there would be immediately wiped), then
// REPLACE substrings of the two known localhost canonicals in place.
// The WHERE filter restricts to rows actually containing the old URL,
// so the migration is idempotent and a no-op in production (where the
// realm canonicals are real hostnames, never `http://localhost:42XX`).
//
// The text/JSONB scope covers anywhere a URL might appear, including:
//   - PK / FK columns (`url`, `realm_url`, `source_url`)
//   - JSONB documents (`pristine_doc`, `search_doc`, `error_doc`,
//     `deps`, `value`, `headers`, etc.)
//   - Rendered HTML/markdown payloads (`isolated_html`, `atom_html`,
//     `fitted_html`, `embedded_html`, `icon_html`, `head_html`,
//     `markdown`, `body`)
//   - Anything else a future column adds — the loop picks it up
//     automatically as long as its type is text/varchar/jsonb.
//
// Excluded:
//   - The `modules` table — truncated on every realm-server boot.
//   - `pgmigrations` / `migrations` (the migration tracker tables).
//   - Identity columns and timestamps fall outside text/varchar/jsonb,
//     so the type filter excludes them implicitly.

exports.shorthands = undefined;

// Cheap pre-check: realm_user_permissions is a small table seeded with
// the canonical localhost realm URLs by earlier migrations
// (1726671342065_backfill-realm-owners + siblings). If no row there
// matches the old localhost canonicals, no other table will either, so
// we exit before touching the larger tables. Avoids full-column scans
// on production/staging databases where the canonical realm URLs are
// real hostnames and `localhost` never appears. (We can't use
// realm_registry — it's populated by the realm-server's runtime
// bootstrap, not by migrations, so on a fresh install it's empty when
// this migration runs.)
// Build the in-place REPLACE block. `oldScheme` and `newScheme` flip
// between 'http' and 'https' depending on direction. The pre-check
// gates on `realm_user_permissions` containing rows that match the
// `oldScheme` localhost canonicals; production realms use real
// hostnames (never `localhost`) so the pre-check is always false there
// and the body is a no-op in either direction.
function rewriteBlock({ oldScheme, newScheme }) {
  return `
DO $$
DECLARE
  rec RECORD;
  patterns text[][] := ARRAY[
    ARRAY['${oldScheme}://localhost:4201', '${newScheme}://localhost:4201'],
    ARRAY['${oldScheme}://localhost:4202', '${newScheme}://localhost:4202'],
    ARRAY['${oldScheme}://localhost:4205', '${newScheme}://localhost:4205']
  ];
  i int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM realm_user_permissions
    WHERE realm_url LIKE '${oldScheme}://localhost:4201/%'
       OR realm_url LIKE '${oldScheme}://localhost:4202/%'
       OR realm_url LIKE '${oldScheme}://localhost:4205/%'
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name NOT IN ('modules', 'pgmigrations', 'migrations')
      AND is_generated = 'NEVER'
      AND (
        data_type IN ('text', 'character varying', 'character')
        OR udt_name = 'jsonb'
      )
  LOOP
    FOR i IN 1 .. array_length(patterns, 1) LOOP
      IF rec.udt_name = 'jsonb' THEN
        EXECUTE format(
          'UPDATE %I SET %I = REPLACE(%I::text, %L, %L)::jsonb WHERE %I::text LIKE %L',
          rec.table_name,
          rec.column_name,
          rec.column_name,
          patterns[i][1],
          patterns[i][2],
          rec.column_name,
          '%' || patterns[i][1] || '%'
        );
      ELSE
        EXECUTE format(
          'UPDATE %I SET %I = REPLACE(%I, %L, %L) WHERE %I LIKE %L',
          rec.table_name,
          rec.column_name,
          rec.column_name,
          patterns[i][1],
          patterns[i][2],
          rec.column_name,
          '%' || patterns[i][1] || '%'
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
`;
}

exports.up = (pgm) => {
  pgm.sql(rewriteBlock({ oldScheme: 'http', newScheme: 'https' }));
};

// Symmetric reverse: rewrite https://localhost:42XX → http://localhost:42XX
// for the same set of text/JSONB columns. Same `realm_user_permissions`
// pre-check (looking for https rows this time) means production is still
// a no-op — production realms never have `localhost` in their canonicals.
// Required for the Postgres Migration CI job, which validates that every
// migration is reversible (up → down → up).
exports.down = (pgm) => {
  pgm.sql(rewriteBlock({ oldScheme: 'https', newScheme: 'http' }));
};
