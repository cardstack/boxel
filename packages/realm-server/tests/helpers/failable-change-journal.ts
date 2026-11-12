import { PostgresChangeJournal } from '@cardstack/postgres';
import type {
  ChangeEventInput,
  ChangeJournal,
  Querier,
} from '@cardstack/runtime-common';

// The Postgres change journal behind a switch a test can throw, so a test can
// make one append fail without reaching into the code under test.
//
// The append fails inside Postgres, on the caller's transaction, the way a
// real journal insert fails. That aborts the transaction, so only the
// caller's savepoint keeps the rest of its work committable. A failure
// thrown before any SQL would leave the transaction healthy, and a caller
// with no savepoint would pass the test anyway.
export class FailableChangeJournal implements ChangeJournal {
  #inner = new PostgresChangeJournal();
  failNext = false;

  async append(querier: Querier, event: ChangeEventInput): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false;
      await querier([
        "DO $$ BEGIN RAISE EXCEPTION 'the change journal is unavailable'; END $$",
      ]);
    }
    return await this.#inner.append(querier, event);
  }
}
