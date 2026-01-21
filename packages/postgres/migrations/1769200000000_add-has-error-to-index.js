exports.up = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');

  pgm.addColumn('boxel_index', {
    has_error: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addColumn('boxel_index_working', {
    has_error: { type: 'boolean', notNull: true, default: false },
  });

  pgm.sql(`
    WITH normalized AS (
      SELECT
        ctid,
        url,
        realm_url,
        CASE
          WHEN type LIKE '%-error' THEN replace(type, '-error', '')
          ELSE type
        END AS normalized_type,
        indexed_at,
        last_modified
      FROM boxel_index
    ),
    ranked AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          PARTITION BY url, realm_url, normalized_type
          ORDER BY COALESCE(indexed_at, last_modified, 0) DESC, ctid DESC
        ) AS row_number
      FROM normalized
    )
    DELETE FROM boxel_index
    WHERE ctid IN (SELECT ctid FROM ranked WHERE row_number > 1);
  `);

  pgm.sql(`
    UPDATE boxel_index
    SET
      has_error = (type LIKE '%-error') OR (error_doc IS NOT NULL),
      type = CASE
        WHEN type LIKE '%-error' THEN replace(type, '-error', '')
        ELSE type
      END;
  `);

  pgm.sql(`
    WITH normalized AS (
      SELECT
        ctid,
        url,
        realm_url,
        CASE
          WHEN type LIKE '%-error' THEN replace(type, '-error', '')
          ELSE type
        END AS normalized_type,
        indexed_at,
        last_modified
      FROM boxel_index_working
    ),
    ranked AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          PARTITION BY url, realm_url, normalized_type
          ORDER BY COALESCE(indexed_at, last_modified, 0) DESC, ctid DESC
        ) AS row_number
      FROM normalized
    )
    DELETE FROM boxel_index_working
    WHERE ctid IN (SELECT ctid FROM ranked WHERE row_number > 1);
  `);

  pgm.sql(`
    UPDATE boxel_index_working
    SET
      has_error = (type LIKE '%-error') OR (error_doc IS NOT NULL),
      type = CASE
        WHEN type LIKE '%-error' THEN replace(type, '-error', '')
        ELSE type
      END;
  `);

  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check: "type in ('instance','module','file')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check: "type in ('instance','module','file')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');

  pgm.sql(`
    UPDATE boxel_index
    SET type = type || '-error'
    WHERE has_error = TRUE;
  `);

  pgm.sql(`
    UPDATE boxel_index_working
    SET type = type || '-error'
    WHERE has_error = TRUE;
  `);

  pgm.dropColumn('boxel_index', 'has_error');
  pgm.dropColumn('boxel_index_working', 'has_error');

  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check: "type in ('instance','module','file','instance-error','module-error','file-error')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check: "type in ('instance','module','file','instance-error','module-error','file-error')",
  });
};
