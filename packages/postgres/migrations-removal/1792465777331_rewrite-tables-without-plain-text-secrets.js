exports.shorthands = undefined;

// Dropping a column only marks it dropped: every row version written before
// the drop keeps the column's bytes in the table's pages until the row is
// rewritten. `VACUUM FULL` rewrites `proxy_endpoints` and `incoming_webhooks`
// without the dropped plain-text keys and signing secrets. Both tables hold a
// few dozen rows, so the exclusive lock it takes is brief. WAL archives and
// database snapshots taken before the rewrite keep the plain text until they
// expire.

exports.up = (pgm) => {
  // VACUUM can't run inside a transaction.
  pgm.noTransaction();
  pgm.sql(`VACUUM FULL proxy_endpoints, incoming_webhooks`);
};

// Nothing to restore: the rewrite changes how the rows are stored, not what
// they hold.
exports.down = () => {};
