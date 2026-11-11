# ADR give-every-query-evaluator-the-databases-semantics remediation

Places where the code does not meet [ADR give-every-query-evaluator-the-databases-semantics](../proposed-give-every-query-evaluator-the-databases-semantics.md)
yet (ADR 001 §1.6).

- `packages/runtime-common/serializers/datetime.ts` (`queryableValue`)
  breaks §1.3. It writes a date-time's queryable value with date-fns
  `format(date, "yyyy-MM-dd'T'HH:mm")`, which formats in the local zone of
  the process that evaluates the card: the prerender's browser for the
  server index, the user's browser for the SQLite index and the client
  matcher. The engine reads that zoneless text as UTC, so the same instant
  is stored, and matched, differently by zone. Format in UTC; the change
  alters stored values, so it needs a reindex and a compatibility note
  ([ADR keep-a-saved-querys-answer-and-read-the-older-spelling-as-it-always-was](../proposed-keep-a-saved-querys-answer-and-read-the-older-spelling-as-it-always-was.md) §1.1).
