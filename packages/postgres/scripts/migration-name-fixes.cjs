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
  // Query V2 migrations, renumbered to sort after every migration on main
  // (earlier names: hand-picked timestamps, then the dates each was written).
  // The removal-phase drop was renamed too; it is idempotent, so it simply
  // runs again under the new name.
  [
    '1793990000000_add-boxel-index-search-tsv',
    '1794378932017_add-boxel-index-search-tsv',
  ],
  [
    '1793995000000_add-typo-words-and-pattern-text',
    '1794378946683_add-typo-words-and-pattern-text',
  ],
  [
    '1793999000000_add-boxel-index-rank-vector',
    '1794378976722_add-boxel-index-rank-vector',
  ],
  ['1794100000000_add-bm25-term-stats', '1794379023914_add-bm25-term-stats'],
  [
    '1794200000000_one-text-search-config',
    '1794379052401_one-text-search-config',
  ],
  [
    '1793759216000_add-boxel-index-vectors',
    '1794378752846_add-boxel-index-vectors',
  ],
  [
    '1793907414672_add-search-doc-title-trigram-indexes',
    '1794378772375_add-search-doc-title-trigram-indexes',
  ],
  [
    '1793914000599_add-boxel-index-passages',
    '1794378808630_add-boxel-index-passages',
  ],
  [
    '1793936584288_add-prerendered-markdown-tsv',
    '1794378861227_add-prerendered-markdown-tsv',
  ],
  [
    '1793976733526_add-boxel-index-spill',
    '1794378907852_add-boxel-index-spill',
  ],
  [
    '1794163311417_add-boxel-index-search-tsv',
    '1794378932017_add-boxel-index-search-tsv',
  ],
  [
    '1794163372420_add-typo-words-and-pattern-text',
    '1794378946683_add-typo-words-and-pattern-text',
  ],
  [
    '1794163433423_add-boxel-index-rank-vector',
    '1794378976722_add-boxel-index-rank-vector',
  ],
  ['1794163494426_add-bm25-term-stats', '1794379023914_add-bm25-term-stats'],
  [
    '1794163555429_one-text-search-config',
    '1794379052401_one-text-search-config',
  ],
  [
    '1794200000000_vector-spaces-and-sidecars',
    '1794379105860_vector-spaces-and-sidecars',
  ],
  [
    '1794250894335_index-prerendered-html-file-alias',
    '1794379110721_index-prerendered-html-file-alias',
  ],
  [
    '1794253807954_partition-boxel-index-vectors-by-space',
    '1794379157839_partition-boxel-index-vectors-by-space',
  ],
  [
    '1794254974149_vector-space-hnsw-indexes',
    '1794379184990_vector-space-hnsw-indexes',
  ],
  [
    '1794265333381_index-boxel-index-realm-order',
    '1794379231447_index-boxel-index-realm-order',
  ],
  [
    '1794268940628_index-prerendered-html-render-errors',
    '1794379233132_index-prerendered-html-render-errors',
  ],
  [
    '1794284429675_index-boxel-index-spill-field',
    '1794379283865_index-boxel-index-spill-field',
  ],
  [
    '1794351846317_add-boxel-index-title-sort',
    '1794379316236_add-boxel-index-title-sort',
  ],
  [
    '1794326957555_jsonb-tree-reads-strings-unescaped',
    '1794379367170_jsonb-tree-reads-strings-unescaped',
  ],
  [
    '1794348306985_jsonb-tree-is-stable-and-parallel-safe',
    '1794379413772_jsonb-tree-is-stable-and-parallel-safe',
  ],
  [
    '1794348725000_search-tables-vacuum-and-statistics',
    '1794379443002_search-tables-vacuum-and-statistics',
  ],
  ['1794341377555_add-boxel-log-lines', '1794379480500_add-boxel-log-lines'],
  [
    '1794352920901_add-boxel-index-facet-values',
    '1794379499980_add-boxel-index-facet-values',
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
