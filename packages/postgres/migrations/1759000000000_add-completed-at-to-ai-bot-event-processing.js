exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('ai_bot_event_processing', {
    completed_at: {
      type: 'timestamp with time zone',
      notNull: false,
    },
  });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION delete_old_ai_bot_event_processing()
    RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM ai_bot_event_processing
      WHERE (completed_at IS NOT NULL AND completed_at < NOW() - INTERVAL '30 minutes')
         OR (completed_at IS NULL AND processing_started_at < NOW() - INTERVAL '30 minutes');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
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

  pgm.dropColumn('ai_bot_event_processing', 'completed_at');
};
