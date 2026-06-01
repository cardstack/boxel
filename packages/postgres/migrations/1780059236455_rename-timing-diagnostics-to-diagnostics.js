exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.renameColumn('boxel_index', 'timing_diagnostics', 'diagnostics');
  pgm.renameColumn('boxel_index_working', 'timing_diagnostics', 'diagnostics');
  pgm.renameColumn('modules', 'timing_diagnostics', 'diagnostics');
};

exports.down = (pgm) => {
  pgm.renameColumn('boxel_index', 'diagnostics', 'timing_diagnostics');
  pgm.renameColumn('boxel_index_working', 'diagnostics', 'timing_diagnostics');
  pgm.renameColumn('modules', 'diagnostics', 'timing_diagnostics');
};
