exports.up = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');

  pgm.sql(`
    UPDATE boxel_index
    SET type = CASE
      WHEN url LIKE '%.json' THEN 'instance-error'
      ELSE 'module-error'
    END
    WHERE type = 'error'
  `);

  pgm.sql(`
    UPDATE boxel_index_working
    SET type = CASE
      WHEN url LIKE '%.json' THEN 'instance-error'
      ELSE 'module-error'
    END
    WHERE type = 'error'
  `);

  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check:
      "type in ('instance','module','file','instance-error','module-error','file-error')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check:
      "type in ('instance','module','file','instance-error','module-error','file-error')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('boxel_index', 'boxel_index_type_check');
  pgm.dropConstraint('boxel_index_working', 'boxel_index_working_type_check');

  pgm.sql(`
    UPDATE boxel_index
    SET type = 'error'
    WHERE type IN ('instance-error', 'module-error', 'file-error')
  `);

  pgm.sql(`
    UPDATE boxel_index_working
    SET type = 'error'
    WHERE type IN ('instance-error', 'module-error', 'file-error')
  `);

  pgm.addConstraint('boxel_index', 'boxel_index_type_check', {
    check: "type in ('instance','module','error','file')",
  });
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_type_check', {
    check: "type in ('instance','module','error','file')",
  });
};
