'use strict';

// Keep aligned with ERROR_DOC_MAX_BYTES in
// packages/runtime-common/error.ts. Any future change there should be
// mirrored here in tandem (or with a fresh migration), since this is
// a one-shot scrub anchored to that exact threshold.
const ERROR_DOC_MAX_BYTES = 8 * 1024 * 1024;

// Legacy `error_doc` rows can predate the persist-side clamp
// (clampSerializedError, called from IndexWriter.normalizeErrorDoc).
// Those rows can be hundreds of megabytes and block every subsequent
// reindex of the same realm:
//
//   IndexBackedDependencyErrors.appendIndexBackedDependencyErrors
//   BFS-walks the dep graph and pulls those legacy blobs into the
//   worker child. JSON-parse expands the jsonb into a JS object tree
//   ~3-5x the byte size, an instance with a handful of oversized
//   neighbours blows past the worker task's cgroup limit, and the
//   kernel SIGKILLs the highest-RSS process (the indexing child).
//   The manager survives and respawns, so children never live long
//   enough to commit a fresh (clamped) replacement row, and the realm
//   loops forever on the same trigger file.
//
// One-shot scrub: where octet_length(error_doc::text) >
// ERROR_DOC_MAX_BYTES, replace error_doc with a minimal
// SerializedError-shaped placeholder. has_error stays true so the
// row's error semantics are preserved, but the body is small enough
// to read without OOM. Once a row is touched by a regular indexing
// cycle thereafter, the normal write-path clamp keeps things bounded.
//
// Both tables get the same scrub:
//   - boxel_index         : committed table the dep walk reads
//   - boxel_index_working : staged-but-uncommitted table that an
//                           in-flight job might read from
//
// One-way: there is no `down`. The original oversized payload is not
// preserved anywhere recoverable, and a rollback to "make rows
// oversized again" would re-create the thrash this fixes.

exports.shorthands = undefined;

exports.up = (pgm) => {
  for (const table of ['boxel_index', 'boxel_index_working']) {
    pgm.sql(`
      UPDATE ${table}
      SET error_doc = jsonb_build_object(
        'id', url,
        'status', 500,
        'title', 'Errors omitted',
        'message', 'error_doc body exceeded the ${ERROR_DOC_MAX_BYTES}-byte budget and was replaced by a data migration. The row remains marked has_error = true; the original additionalErrors chain is not preserved.',
        'additionalErrors', NULL
      )
      WHERE error_doc IS NOT NULL
        AND octet_length(error_doc::text) > ${ERROR_DOC_MAX_BYTES};
    `);
  }
};

exports.down = (_pgm) => {
  // No-op: the original oversized payload is not recoverable.
};
