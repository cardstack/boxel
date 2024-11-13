/* eslint-disable camelcase */

exports.shorthands = undefined;

// This migration may require us to scale ECS tasks to zero before applying the migration to avoid issues with database locks
exports.up = (pgm) => {
  pgm.dropTable('jobs');
  pgm.dropTable('queues');
  pgm.createTable('jobs', {
    id: 'id', // shorthand for primary key that is an auto incremented id
    job_type: {
      type: 'varchar',
      notNull: true,
    },
    args: 'jsonb',
    concurrency_group: { type: 'varchar' },
    timeout: { type: 'integer' },
    status: {
      type: 'job_statuses',
      default: 'unfulfilled',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    finished_at: {
      type: 'timestamp',
    },
    result: 'jsonb',
  });
  pgm.createTable('job_reservations', {
    id: 'id', // shorthand for primary key that is an auto incremented id
    job_id: { type: 'integer', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    locked_until: { type: 'timestamp', notNull: true },
    completed_at: { type: 'timestamp' },
    worker_id: { type: 'varchar' },
  });
  pgm.addConstraint('job_reservations', 'job_reservations_job_id_fkey', {
    foreignKeys: {
      columns: 'job_id',
      references: 'jobs(id)',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('job_reservations');
  pgm.dropTable('jobs');
  pgm.createTable('jobs', {
    id: 'id', // shorthand for primary key that is an auto incremented id
    category: {
      type: 'varchar',
      notNull: true,
    },
    args: 'jsonb',
    status: {
      type: 'job_statuses',
      default: 'unfulfilled',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    finished_at: {
      type: 'timestamp',
    },
    queue: {
      type: 'varchar',
      notNull: true,
    },
    result: 'jsonb',
  });
  pgm.sql('ALTER TABLE jobs SET UNLOGGED');
  pgm.createTable('queues', {
    queue_name: {
      type: 'varchar',
      notNull: true,
    },
    category: {
      type: 'varchar',
      notNull: true,
    },
    status: {
      type: 'queue_statuses',
      default: 'idle',
      notNull: true,
    },
  });
  pgm.sql('ALTER TABLE queues SET UNLOGGED');
  pgm.addConstraint('queues', 'working_queues_pkey', {
    primaryKey: ['queue_name', 'category'],
  });
};
