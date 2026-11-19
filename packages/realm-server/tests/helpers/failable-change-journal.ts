import { PostgresChangeJournal } from '@cardstack/postgres';
import type {
  ChangeEventInput,
  ChangeJournal,
  Querier,
} from '@cardstack/runtime-common';

const UNAVAILABLE = [
  "DO $$ BEGIN RAISE EXCEPTION 'the change journal is unavailable'; END $$",
];

// The Postgres change journal behind switches a test can throw, so a test can
// make one append go wrong without reaching into the code under test. Each
// switch applies to the next append only.
//
// Every failure happens inside Postgres, on the caller's transaction, the way
// a real one does. A failure thrown before any SQL would leave the transaction
// healthy, and a caller that mishandled it would pass the test anyway.
export class FailableChangeJournal implements ChangeJournal {
  #inner = new PostgresChangeJournal();

  // The append fails. That aborts the caller's transaction, so only the
  // caller's savepoint keeps the rest of its work committable.
  failNext = false;

  // The append succeeds, and the caller's transaction then fails to commit:
  // a deferred unique constraint is checked only at COMMIT, so the duplicate
  // below lets every statement before it succeed.
  failCommitNext = false;

  // The append ends the caller's transaction and then fails, so rolling back
  // to the caller's savepoint fails too.
  failRollbackNext = false;

  reset(): void {
    this.failNext = false;
    this.failCommitNext = false;
    this.failRollbackNext = false;
  }

  async append(querier: Querier, event: ChangeEventInput): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false;
      await querier(UNAVAILABLE);
    }
    if (this.failRollbackNext) {
      this.failRollbackNext = false;
      await querier(['ROLLBACK']);
      await querier(UNAVAILABLE);
    }
    let written = await this.#inner.append(querier, event);
    if (this.failCommitNext) {
      this.failCommitNext = false;
      await querier([
        'CREATE TEMP TABLE commit_refused (id int UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP',
      ]);
      await querier(['INSERT INTO commit_refused VALUES (1), (1)']);
    }
    return written;
  }
}
