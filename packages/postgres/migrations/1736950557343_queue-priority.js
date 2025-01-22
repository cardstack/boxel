exports.up = (pgm) => {
  pgm.sql('delete from job_reservations');
  pgm.sql('delete from jobs');

  pgm.addColumns('jobs', {
    priority: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.createIndex('jobs', 'priority');
};

exports.down = (pgm) => {
  pgm.dropIndex('jobs', 'priority');
  pgm.dropColumns('jobs', {
    priority: 'integer',
  });
};
