exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    WITH period_map AS (
      SELECT
        sc.id AS subscription_cycle_id,
        sc.period_start AS current_period_start,
        sc.period_end   AS current_period_end,
        li.period_start AS new_period_start,
        li.period_end   AS new_period_end
      FROM stripe_events se
      JOIN subscriptions s
        ON s.stripe_subscription_id = se.event_data->'object'->>'subscription'
      JOIN subscription_cycles sc
        ON sc.subscription_id = s.id
       AND sc.period_start = (se.event_data->'object'->>'period_start')::int
       AND sc.period_end   = (se.event_data->'object'->>'period_end')::int
      JOIN LATERAL (
        SELECT
          (line->'period'->>'start')::int AS period_start,
          (line->'period'->>'end')::int   AS period_end
        FROM jsonb_array_elements(se.event_data->'object'->'lines'->'data') AS line
        WHERE (line->>'amount')::int >= 0
          AND line->>'type' = 'subscription'
          AND COALESCE((line->>'proration')::boolean, false) = false
          AND line->'period' ? 'start'
          AND line->'period' ? 'end'
        LIMIT 1
      ) li ON true
    )
    UPDATE subscription_cycles sc
    SET
      period_start = pm.new_period_start,
      period_end   = pm.new_period_end
    FROM period_map pm
    WHERE sc.id = pm.subscription_cycle_id
      AND (
        pm.current_period_start <> pm.new_period_start
        OR pm.current_period_end   <> pm.new_period_end
      );
  `);
};

exports.down = (pgm) => {};
