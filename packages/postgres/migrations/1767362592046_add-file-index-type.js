exports.up = (pgm) => {
  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check: "type in ('instance','module','error','file')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check: "type in ('instance','module','error','file')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');
};
