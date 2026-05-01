exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('modules', {
    timing_diagnostics: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('modules', ['timing_diagnostics']);
};
