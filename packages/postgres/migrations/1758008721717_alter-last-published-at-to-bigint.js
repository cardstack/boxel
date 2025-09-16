exports.shorthands = undefined;

exports.up = (pgm) => {
  // First, add a temporary column to store the converted values
  pgm.addColumn('published_realms', {
    last_published_at_temp: {
      type: 'bigint',
    },
  });

  // Convert existing timestamp values to bigint (milliseconds since epoch) in the temp column
  pgm.sql(`
    UPDATE published_realms 
    SET last_published_at_temp = EXTRACT(EPOCH FROM last_published_at) * 1000
    WHERE last_published_at IS NOT NULL;
  `);

  // Drop the original column
  pgm.dropColumn('published_realms', 'last_published_at');

  // Rename the temp column to the original name
  pgm.renameColumn(
    'published_realms',
    'last_published_at_temp',
    'last_published_at',
  );
};

exports.down = (pgm) => {
  // Add a temporary column to store the converted timestamp values
  pgm.addColumn('published_realms', {
    last_published_at_temp: {
      type: 'timestamp',
    },
  });

  // Convert bigint values back to timestamp in the temp column
  pgm.sql(`
    UPDATE published_realms 
    SET last_published_at_temp = TO_TIMESTAMP(last_published_at / 1000)
    WHERE last_published_at IS NOT NULL;
  `);

  // Drop the bigint column
  pgm.dropColumn('published_realms', 'last_published_at');

  // Rename the temp column back to the original name
  pgm.renameColumn(
    'published_realms',
    'last_published_at_temp',
    'last_published_at',
  );
};
