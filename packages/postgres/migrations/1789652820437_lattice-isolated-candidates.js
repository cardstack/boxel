exports.shorthands = undefined;

exports.up = (pgm) => {
  // A replacement reservation gets a new batch id. An expired attempt cannot
  // overwrite its candidates or the primary indexer's resumable working rows.
  pgm.sql(`CREATE UNLOGGED TABLE lattice_index_candidates
    (LIKE boxel_index_working INCLUDING DEFAULTS);
    ALTER TABLE lattice_index_candidates
      ADD COLUMN batch_id uuid NOT NULL,
      ADD COLUMN staged_at timestamptz NOT NULL DEFAULT now(),
      ADD PRIMARY KEY (batch_id, url, realm_url, type);
    CREATE INDEX lattice_index_candidates_cleanup ON lattice_index_candidates (realm_url, staged_at);`);
};

exports.down = (pgm) => {
  pgm.dropTable('lattice_index_candidates');
};
