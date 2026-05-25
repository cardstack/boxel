exports.shorthands = undefined;

// Stamp the originating job's id on every working-table row so that a
// retry of the same job can identify (and skip) URLs already processed
// by an earlier attempt. The PK is (url, realm_url); job_id is metadata
// only. Nullable so legacy rows, copyFrom paths without JobInfo, and
// non-job test callers can still write.
exports.up = (pgm) => {
  pgm.addColumn('boxel_index_working', {
    job_id: { type: 'integer' },
  });
  pgm.createIndex('boxel_index_working', ['realm_url', 'job_id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('boxel_index_working', ['realm_url', 'job_id']);
  pgm.dropColumn('boxel_index_working', 'job_id');
};
