/* eslint-env node */
'use strict';

const migrationRenames = [
  [
    '1759000000000_add-completed-at-to-ai-bot-event-processing',
    '1759935305936_add-completed-at-to-ai-bot-event-processing',
  ],
  ['1759420000000_create-session-rooms', '1760453998517_create-session-rooms'],
  ['1762000000000_add-head-html', '1764614956082_add-head-html'],
  ['1767000000000_add-file-index-type', '1767362592046_add-file-index-type'],
  ['1768000000000_add-type-to-index-pk', '1767624996365_add-type-to-index-pk'],
  [
    '1768000000001_update-index-error-types',
    '1767624996375_update-index-error-types',
  ],
  [
    '1769000000000_add-content-hash-to-realm-file-meta',
    '1767896102015_add-content-hash-to-realm-file-meta',
  ],
  [
    '1769100000000_add-boxel-homepage-realm-permissions',
    '1768241034385_add-boxel-homepage-realm-permissions',
  ],
  [
    '1769200000000_add-has-error-to-index',
    '1769004232071_add-has-error-to-index',
  ],
];

function buildUpdateMigrationSql(mapping) {
  if (!mapping.length) {
    return 'SELECT 1';
  }

  const values = mapping
    .map(([oldName, newName]) => `('${oldName}', '${newName}')`)
    .join(',\n        ');

  return `
    WITH mapping(old_name, new_name) AS (
      VALUES
        ${values}
    ),
    existing AS (
      SELECT
        m.old_name,
        m.new_name,
        o.id AS old_id,
        o.run_on AS old_run_on,
        n.id AS new_id,
        n.run_on AS new_run_on
      FROM mapping m
      LEFT JOIN migrations o ON o.name = m.old_name
      LEFT JOIN migrations n ON n.name = m.new_name
    ),
    merged AS (
      UPDATE migrations n
      SET run_on = LEAST(n.run_on, e.old_run_on)
      FROM existing e
      WHERE n.id = e.new_id AND e.old_id IS NOT NULL
      RETURNING n.id
    ),
    renamed AS (
      UPDATE migrations o
      SET name = e.new_name
      FROM existing e
      WHERE o.id = e.old_id AND e.new_id IS NULL
      RETURNING o.id
    )
    DELETE FROM migrations o
    USING existing e
    WHERE o.id = e.old_id AND e.new_id IS NOT NULL;
  `;
}

module.exports = {
  migrationRenames,
  buildUpdateMigrationSql,
};
