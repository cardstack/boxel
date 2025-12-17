exports.shorthands = undefined;

exports.up = (pgm) => {
  // Existing rows may contain Matrix event ids (e.g. $abc:domain) which cannot be
  // converted to room ids (e.g. !room:domain) without additional context. Force a
  // manual cleanup/backfill so we do not silently persist invalid room ids.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM ai_bot_event_processing) THEN
        RAISE EXCEPTION 'ai_bot_event_processing contains existing rows; truncate or backfill with actual Matrix room ids (e.g. !room:domain) before rerunning migration 1765785229000_room-scoped-ai-bot-locks';
      END IF;
    END;
    $$;
  `);

  pgm.addColumn('ai_bot_event_processing', {
    room_id: {
      type: 'varchar',
      notNull: false,
    },
  });

  pgm.alterColumn('ai_bot_event_processing', 'room_id', { notNull: true });

  pgm.dropConstraint(
    'ai_bot_event_processing',
    'ai_bot_event_processing_pkey',
    { ifExists: true },
  );
  pgm.addConstraint(
    'ai_bot_event_processing',
    'ai_bot_event_processing_pkey',
    'PRIMARY KEY(room_id)',
  );

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

  pgm.dropConstraint(
    'ai_bot_event_processing',
    'ai_bot_event_processing_pkey',
    { ifExists: true },
  );
  pgm.addConstraint(
    'ai_bot_event_processing',
    'ai_bot_event_processing_pkey',
    'PRIMARY KEY(event_id_being_processed)',
  );

  pgm.dropColumn('ai_bot_event_processing', 'room_id');
};
