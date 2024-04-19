exports.up = (pgm) => {
  pgm.createTable('indexed_cards', {
    card_url: { type: 'varchar', notNull: true },
    realm_version: { type: 'integer', notNull: true },
    realm_url: { type: 'varchar', notNull: true },
    pristine_doc: 'jsonb',
    search_doc: 'jsonb',
    error_doc: 'jsonb',
    deps: 'jsonb',
    types: 'jsonb',
    embedded_html: 'varchar',
    isolated_html: 'varchar',
    indexed_at: 'bigint',
    is_deleted: 'boolean',
  });
  pgm.sql('ALTER TABLE indexed_cards SET UNLOGGED');
  pgm.addConstraint('indexed_cards', 'indexed_cards_pkey', {
    primaryKey: ['card_url', 'realm_version'],
  });
  pgm.createIndex('indexed_cards', ['realm_version']);
  pgm.createIndex('indexed_cards', ['realm_url']);

  pgm.createTable('realm_versions', {
    realm_url: { type: 'varchar', notNull: true },
    current_version: { type: 'integer', notNull: true },
  });

  pgm.sql('ALTER TABLE realm_versions SET UNLOGGED');
  pgm.addConstraint('realm_versions', 'realm_versions_pkey', {
    primaryKey: ['realm_url'],
  });
  pgm.createIndex('realm_versions', ['current_version']);

  pgm.createType('job_statuses', ['unfulfilled', 'resolved', 'rejected']);
  pgm.createTable('jobs', {
    id: 'id', // shorthand for primary key that is an auto incremented id
    category: {
      type: 'varchar',
      notNull: true,
    },
    args: 'jsonb',
    status: {
      type: 'job_statuses',
      default: 'unfulfilled',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    finished_at: {
      type: 'timestamp',
    },
    queue: {
      type: 'varchar',
      notNull: true,
    },
    result: 'jsonb',
  });
  pgm.createType('queue_statuses', ['idle', 'working']);
  pgm.sql('ALTER TABLE jobs SET UNLOGGED');
  pgm.createTable('queues', {
    queue_name: {
      type: 'varchar',
      notNull: true,
    },
    category: {
      type: 'varchar',
      notNull: true,
    },
    status: {
      type: 'queue_statuses',
      default: 'idle',
      notNull: true,
    },
  });
  pgm.sql('ALTER TABLE queues SET UNLOGGED');
  pgm.addConstraint('queues', 'working_queues_pkey', {
    primaryKey: ['queue_name', 'category'],
  });

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
