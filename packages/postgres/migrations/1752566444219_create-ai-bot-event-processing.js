exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('ai_bot_event_processing', {
    event_id_being_processed: {
      type: 'varchar',
      notNull: true,
      primaryKey: true,
    },
    ai_bot_instance_id: {
      type: 'varchar',
      notNull: true,
    },
    processing_started_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('ai_bot_event_processing', 'ai_bot_instance_id');

  pgm.sql(`
    CREATE OR REPLACE FUNCTION delete_old_ai_bot_event_processing()
    RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM ai_bot_event_processing
      WHERE processing_started_at < NOW() - INTERVAL '30 minutes';
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // It is the app's responsibility to clean up these rows but in case of a hard crash,
  // this is a secondary safety net to prevent the table from growing indefinitely
  pgm.createTrigger(
    'ai_bot_event_processing',
    'delete_old_ai_bot_event_processing_trigger',
    {
      when: 'AFTER',
      operation: 'INSERT',
      function: 'delete_old_ai_bot_event_processing',
      level: 'STATEMENT',
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTrigger(
    'ai_bot_event_processing',
    'delete_old_ai_bot_event_processing_trigger',
  );

  pgm.sql('DROP FUNCTION IF EXISTS delete_old_ai_bot_event_processing();');

  pgm.dropIndex('ai_bot_event_processing', 'ai_bot_instance_id');

  pgm.dropTable('ai_bot_event_processing');
};
