exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('boxel_index', {
    timing_diagnostics: { type: 'jsonb' },
  });
  pgm.addColumns('boxel_index_working', {
    timing_diagnostics: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('boxel_index', ['timing_diagnostics']);
  pgm.dropColumns('boxel_index_working', ['timing_diagnostics']);
};
