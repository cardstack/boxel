/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('incoming_webhooks', {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
    },
    username: {
      type: 'text',
      notNull: true,
    },
    webhook_path: {
      type: 'text',
      notNull: true,
      unique: true,
    },
    verification_type: {
      type: 'text',
      notNull: true,
    },
    verification_config: {
      type: 'jsonb',
      notNull: true,
    },
    signing_secret: {
      type: 'text',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  pgm.createIndex('incoming_webhooks', 'username');
  pgm.createIndex('incoming_webhooks', 'webhook_path', { unique: true });

  pgm.createTable('webhook_commands', {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
    },
    incoming_webhook_id: {
      type: 'uuid',
      notNull: true,
      references: 'incoming_webhooks(id)',
      onDelete: 'CASCADE',
    },
    command: {
      type: 'text',
      notNull: true,
    },
    command_filter: {
      type: 'jsonb',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  pgm.createIndex('webhook_commands', ['incoming_webhook_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('webhook_commands', ['incoming_webhook_id', 'created_at']);
  pgm.dropTable('webhook_commands');
  pgm.dropIndex('incoming_webhooks', 'webhook_path');
  pgm.dropIndex('incoming_webhooks', 'username');
  pgm.dropTable('incoming_webhooks');
};
