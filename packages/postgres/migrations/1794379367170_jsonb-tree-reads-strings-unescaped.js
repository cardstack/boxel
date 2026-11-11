// `jsonb_tree` gave a string's text as its JSON text with the outer quotes
// trimmed, which leaves JSON's escapes in: a value holding a quote, a
// backslash or a newline read as `say \"hi\"` with its backslashes, so a comparison with the
// value as written never matched it. A list filter that walks the tree (a
// `not` over a list, a range or a substring in one) then answered as if the
// element were not there. A string's text is now the string itself. Every
// other kind of value reads as before.

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
                  WHEN c.jsonb_value IS JSON OBJECT THEN
                    CASE WHEN jsonb_typeof(kvu.value) = 'string' THEN kvu.value #>> '{}' ELSE trim('"' from kvu.value::text) END
                  WHEN c.jsonb_value IS JSON ARRAY THEN
                    CASE WHEN jsonb_typeof(aru.value) = 'string' THEN aru.value #>> '{}' ELSE trim('"' from aru.value::text) END
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
