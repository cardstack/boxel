exports.shorthands = undefined;

// DEMO ONLY — remove this file. Intentionally placed in migrations/ (the
// additive phase) with a DROP in up() to show the "Guard removal-phase
// migrations" CI check failing. A destructive migration belongs in
// migrations-removal/.

exports.up = (pgm) => {
  pgm.dropColumn('boxel_index', 'demo_wrong_directory', { ifExists: true });
};

exports.down = (pgm) => {
  pgm.addColumn(
    'boxel_index',
    { demo_wrong_directory: { type: 'text' } },
    { ifNotExists: true },
  );
};
