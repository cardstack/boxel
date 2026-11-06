// Spill tables for large search-doc values (ADR 021).
//
// When a card's search doc is too large to stay inline in its row, the index
// writer replaces each large value (a vector, a long string, a long array)
// with a marker, `{ "$spilled": "<kind>", "ref": "<ref>" }`, and stores the
// original here, keyed by the marker's ref. The writer computes both while it
// stages the pass: `boxel_index_pending` keeps the full doc in `search_doc`
// (staged reads use it inline), the promoted form in `spilled_search_doc`,
// and the values in `spill_rows`. Promotion copies them into `boxel_index` and
// this table in the swap transaction.
//
// Readers resolve markers by ref:
// - `spill_unmark(v)` returns the spilled value for a marker and `v`
//   otherwise. `spill_text(v)` is its text, read the way `->>` reads a key.
// - `jsonb_tree` (the walk behind every plural-path filter) resolves markers
//   at its root and at every node, so a filter sees the original values.
//
// All of it is additive. A revision that predates this migration never reads
// a spilled doc, because no writer spills until BOXEL_SPILL_SEARCH_DOCS is set
// (ADR 021 §1.9).

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_index_spill (
      ref TEXT NOT NULL,
      realm_url TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      field_path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      value JSONB NOT NULL,
      CONSTRAINT boxel_index_spill_pkey PRIMARY KEY (ref)
    );
    CREATE INDEX IF NOT EXISTS boxel_index_spill_row_idx
      ON boxel_index_spill (realm_url, url, type);

    ALTER TABLE boxel_index_pending
      ADD COLUMN IF NOT EXISTS spilled_search_doc JSONB,
      ADD COLUMN IF NOT EXISTS spill_rows JSONB;

    CREATE OR REPLACE FUNCTION spill_unmark(v JSONB) RETURNS JSONB
      LANGUAGE sql STABLE PARALLEL SAFE AS $$
        SELECT CASE
          WHEN jsonb_typeof(v) = 'object' AND v ? '$spilled' AND v ? 'ref'
            THEN (SELECT s.value FROM boxel_index_spill s WHERE s.ref = v ->> 'ref')
          ELSE v
        END
      $$;

    CREATE OR REPLACE FUNCTION spill_text(v JSONB) RETURNS TEXT
      LANGUAGE sql STABLE PARALLEL SAFE AS $$
        SELECT spill_unmark(v) #>> '{}'
      $$;

    CREATE OR REPLACE FUNCTION jsonb_tree(data JSONB, root_path TEXT DEFAULT NULL)
    RETURNS TABLE (fullkey TEXT, jsonb_value JSONB, text_value TEXT, level INT) AS
    $$
    WITH RECURSIVE cte AS (
        SELECT
            (
              CASE
                WHEN root_path IS NULL THEN '$'
                ELSE root_path
              END
            ) AS current_key,
            spill_unmark(CASE
              WHEN root_path IS NULL THEN data
              ELSE data #> string_to_array(substring(root_path from 3), '.') -- trim off leading '$.'
            END) AS jsonb_value,
            null AS text_value,
            1 AS level

        UNION ALL

        (
          SELECT
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN c.current_key || '.' || key
                  WHEN c.jsonb_value IS JSON ARRAY THEN c.current_key || '[' || (index - 1)::TEXT || ']'
                  ELSE c.current_key
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN kvu.value
                  WHEN c.jsonb_value IS JSON ARRAY THEN aru.value
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN trim('"' from kvu.value::text)
                  WHEN c.jsonb_value IS JSON ARRAY THEN trim('"' from aru.value::text)
              END,
              c.level + 1
          FROM
              cte c
          CROSS JOIN LATERAL jsonb_each(
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN c.jsonb_value
                  ELSE '{"_":null}'::jsonb
              END
          ) AS kv (key, value)
          CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                  WHEN c.jsonb_value IS JSON ARRAY THEN c.jsonb_value
                  ELSE '[null]'::jsonb
              END
          ) WITH ORDINALITY arr(value, index)
          CROSS JOIN LATERAL (SELECT spill_unmark(kv.value) AS value) AS kvu
          CROSS JOIN LATERAL (SELECT spill_unmark(arr.value) AS value) AS aru
          WHERE
              c.jsonb_value IS JSON OBJECT OR c.jsonb_value IS JSON ARRAY
        )
    )
    SELECT * FROM cte
    $$
    LANGUAGE SQL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION jsonb_tree(data JSONB, root_path TEXT DEFAULT NULL)
    RETURNS TABLE (fullkey TEXT, jsonb_value JSONB, text_value TEXT, level INT) AS
    $$
    WITH RECURSIVE cte AS (
        SELECT
            (CASE WHEN root_path IS NULL THEN '$' ELSE root_path END) AS current_key,
            (CASE
              WHEN root_path IS NULL THEN data
              ELSE data #> string_to_array(substring(root_path from 3), '.')
            END) AS jsonb_value,
            null AS text_value,
            1 AS level
        UNION ALL
        (
          SELECT
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN c.current_key || '.' || key
                  WHEN c.jsonb_value IS JSON ARRAY THEN c.current_key || '[' || (index - 1)::TEXT || ']'
                  ELSE c.current_key
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN kv.value
                  WHEN c.jsonb_value IS JSON ARRAY THEN arr.value
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN trim('"' from kv.value::text)
                  WHEN c.jsonb_value IS JSON ARRAY THEN trim('"' from arr.value::text)
              END,
              c.level + 1
          FROM cte c
          CROSS JOIN LATERAL jsonb_each(
              CASE WHEN c.jsonb_value IS JSON OBJECT THEN c.jsonb_value ELSE '{"_":null}'::jsonb END
          ) AS kv (key, value)
          CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN c.jsonb_value IS JSON ARRAY THEN c.jsonb_value ELSE '[null]'::jsonb END
          ) WITH ORDINALITY arr(value, index)
          WHERE c.jsonb_value IS JSON OBJECT OR c.jsonb_value IS JSON ARRAY
        )
    )
    SELECT * FROM cte
    $$
    LANGUAGE SQL;
    DROP FUNCTION IF EXISTS spill_text(JSONB);
    DROP FUNCTION IF EXISTS spill_unmark(JSONB);
    ALTER TABLE boxel_index_pending
      DROP COLUMN IF EXISTS spill_rows,
      DROP COLUMN IF EXISTS spilled_search_doc;
    DROP TABLE IF EXISTS boxel_index_spill;
  `);
};
