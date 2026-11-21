// `jsonb_tree` gave a string's text as its JSON text with the outer quotes
// trimmed, which leaves JSON's escapes in: a value holding a quote, a
// backslash or a newline read as `say \"hi\"` with its backslashes, so a
// comparison with the value as written never matched it. A list filter that
// walks the tree (a `not` over a list, a range or a substring in one) then
// answered as if the element were not there. A string's text is now the
// string itself. Every other kind of value reads as before.
//
// It was also declared with Postgres's defaults, VOLATILE and PARALLEL
// UNSAFE, though it only reads its arguments. A volatile function is never
// inlined, and a parallel-unsafe one keeps the whole statement off parallel
// workers, so every list filter that walks the tree ran as an opaque function
// scan on one process. It is now STABLE (IMMUTABLE would also hold, but
// STABLE is what the plans were measured with) and PARALLEL SAFE. `down`
// restores main's body and its default markings.

exports.up = (pgm) => {
  pgm.sql(`
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
            (CASE
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
                  WHEN c.jsonb_value IS JSON OBJECT THEN kv.value
                  WHEN c.jsonb_value IS JSON ARRAY THEN arr.value
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN
                    CASE WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}' ELSE trim('"' from kv.value::text) END
                  WHEN c.jsonb_value IS JSON ARRAY THEN
                    CASE WHEN jsonb_typeof(arr.value) = 'string' THEN arr.value #>> '{}' ELSE trim('"' from arr.value::text) END
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
          WHERE
              c.jsonb_value IS JSON OBJECT OR c.jsonb_value IS JSON ARRAY
        )
    )
    SELECT * FROM cte
    $$
    LANGUAGE SQL STABLE PARALLEL SAFE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
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
            (CASE
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
                  WHEN c.jsonb_value IS JSON OBJECT THEN kv.value
                  WHEN c.jsonb_value IS JSON ARRAY THEN arr.value
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN trim('"' from kv.value::text)
                  WHEN c.jsonb_value IS JSON ARRAY THEN trim('"' from arr.value::text)
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
          WHERE
              c.jsonb_value IS JSON OBJECT OR c.jsonb_value IS JSON ARRAY
        )
    )
    SELECT * FROM cte
    $$
    LANGUAGE SQL;
  `);
};
