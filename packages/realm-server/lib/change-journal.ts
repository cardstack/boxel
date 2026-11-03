// The Postgres change journal: one `realm_change_events` row per write, with
// its paths in `realm_change_event_paths`, written on the write's own
// transaction so the event commits with the write's `realm_file_meta` update
// or not at all.
//
// Whether a realm records history is read in that same transaction. One
// statement looks the realm up by URL in `realm_registry`, takes it only when
// it is not published and `realm_history_state.enabled` is true, inserts the
// event from that row, and inserts the path rows from the event's `seq`. A
// realm the statement doesn't take gets no row, so there is no per-realm flag
// to cache or to refresh. The insert then notifies `realm_change_events`,
// which Postgres delivers when the transaction commits, so realm-historian
// wakes for an event it can already see.

import {
  param,
  type Expression,
  type Querier,
  type ChangeEventInput,
  type ChangeJournal,
  REALM_CHANGE_EVENTS_CHANNEL,
} from '@cardstack/runtime-common';

export class PostgresChangeJournal implements ChangeJournal {
  async append(querier: Querier, event: ChangeEventInput): Promise<boolean> {
    let paths = event.changes.map((change) => change.path);
    let expression: Expression = [
      'WITH recording AS (',
      'SELECT registry.id AS realm_id FROM realm_registry registry',
      'JOIN realm_history_state state ON state.realm_id = registry.id',
      'WHERE registry.url =',
      param(event.realmURL),
      "AND registry.kind <> 'published' AND state.enabled",
      '), event AS (',
      'INSERT INTO realm_change_events',
      '(realm_id, realm_url, author, channel, agent, room, operation_id,',
      'correlation_id, partial, push_id, push_final, intent, changes)',
      'SELECT recording.realm_id,',
      param(event.realmURL),
      ',',
      param(event.author),
      ',',
      param(event.channel),
      ',',
      param(event.agent ?? null),
      ',',
      param(event.room ?? null),
      ',',
      param(event.operationId ?? null),
      ',',
      param(event.correlationId ?? null),
      ',',
      param(event.partial ?? false),
      ',',
      param(event.pushId ?? null),
      ',',
      param(event.pushFinal ?? false),
      ',',
      param(event.intent === undefined ? null : JSON.stringify(event.intent)),
      '::jsonb,',
      param(JSON.stringify(event.changes)),
      '::jsonb',
      'FROM recording RETURNING seq, realm_id',
      '), event_paths AS (',
      'INSERT INTO realm_change_event_paths (realm_id, path, seq)',
      'SELECT event.realm_id, changed.path, event.seq',
      'FROM event, jsonb_array_elements_text(',
      param(JSON.stringify(paths)),
      '::jsonb) AS changed(path)',
      // A write may name one path twice, such as a batch that deletes a path
      // it also wrote. The event keeps every change; the path table holds
      // each path once per event.
      'ON CONFLICT (realm_id, path, seq) DO NOTHING',
      ')',
      'SELECT seq, pg_notify(',
      param(REALM_CHANGE_EVENTS_CHANNEL),
      ", '') FROM event",
    ];
    let rows = await querier(expression);
    return rows.length > 0;
  }
}
