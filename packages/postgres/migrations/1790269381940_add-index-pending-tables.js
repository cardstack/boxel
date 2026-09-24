exports.shorthands = undefined;

// Pass-private staging for the index writer. An index pass stages the rows it
// writes in `boxel_index_pending`, and a pass that writes HTML stages those in
// `prerendered_html_pending`; its commit promotes them into `boxel_index` /
// `prerendered_html` and then deletes them. A pass reads and promotes only the
// rows under its own `staging_id`, so two passes of one realm can stage at
// once without reading or promoting each other's uncommitted rows.
//
// `staging_id` is `job:<id>` for a pass that runs as a queue job, and every
// attempt of that job shares it, so a retry finds (and resumes) what an earlier
// attempt staged. A batch that runs outside a job stages under
// `adhoc:<pass id>`, which nothing else shares. `job_id` is kept alongside it
// so rows left behind by a job that has finished can be found and removed.
//
// Each table is its production table's columns plus those two, created with
// `LIKE` so the column set matches at creation. A column added to a production
// table later has to be added to its pending table too: a commit copies every
// production column out of the pending row. UNLOGGED because the rows are
// transient; a crash that loses them costs a retry its resume, not data.
const TABLES = [
  ['boxel_index_pending', 'boxel_index'],
  ['prerendered_html_pending', 'prerendered_html'],
];

exports.up = (pgm) => {
  for (let [pending, production] of TABLES) {
    pgm.sql(
      `CREATE UNLOGGED TABLE ${pending} (LIKE ${production} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
    );
    pgm.addColumns(pending, {
      job_id: { type: 'integer' },
      staging_id: { type: 'varchar', notNull: true },
    });
    pgm.addConstraint(pending, `${pending}_pkey`, {
      primaryKey: ['realm_url', 'staging_id', 'url', 'type'],
    });
  }
};

exports.down = (pgm) => {
  for (let [pending] of TABLES) {
    pgm.dropTable(pending);
  }
};
