// Which session drives which write block.
//
// A block that pins a `username` takes that credential row wherever it sits in
// the file; the rest take sessions in file order, which is what the harness did
// before blocks existed. This is the step that makes "writer A on realm R,
// writer B on realm R, A ≠ B" a property of the workload rather than of how the
// CSV happens to be sorted.
//
// It lives here, apart from the driver, because it is pure given its three
// inputs and the driver is a script that starts a run on import — logic reached
// only by running the thing it is part of cannot be checked. The refusals below
// are returned rather than exited on, so the same function answers a test and
// the command line.

import type { Session } from './auth.ts';
import type { WriteSpec } from './workload.ts';

export interface WriterAssignment {
  session: Session;
  write: WriteSpec;
}

export type AssignmentResult =
  | { assignments: WriterAssignment[]; readerSessions: Session[] }
  | { error: string };

export function isAssignmentError(
  result: AssignmentResult,
): result is { error: string } {
  return 'error' in result;
}

export function assignWriters({
  writes,
  sessions,
  writerCount,
  requestedWriters,
  requestedReaders,
}: {
  writes: readonly WriteSpec[];
  sessions: readonly Session[];
  writerCount: number;
  requestedWriters: number;
  requestedReaders: number;
}): AssignmentResult {
  let byUsername = new Map(sessions.map((s) => [s.username, s]));
  let taken = new Set<Session>();
  let slots: (WriterAssignment | undefined)[] = Array.from({
    length: writerCount,
  });
  let blockFor = (i: number) => writes[i % writes.length]!;

  // Pinned blocks first, so an unpinned one cannot take the session a pinned
  // one needs and leave it unsatisfiable.
  let pinnedSlots = new Map<string, number>();
  for (let i = 0; i < writerCount; i++) {
    let write = blockFor(i);
    if (!write.username) {
      continue;
    }
    // `blockFor` cycles when there are more slots than blocks, and an unpinned
    // block simply takes another session each time round. A pinned one cannot:
    // it would put a second loop on the same identity writing the same block,
    // doubling that block's cadence while the summary still called it one
    // writer. Two blocks pinned to one username is a different thing and stays
    // allowed — that is self-contention, which has its own bucket.
    let alreadyAt = pinnedSlots.get(write.label);
    if (alreadyAt !== undefined) {
      return {
        error:
          `Write block "${write.label}" is pinned to ${write.username}, so only ` +
          `one writer can drive it —\n` +
          `  but --writers ${requestedWriters} against ${writes.length} ` +
          `block${writes.length === 1 ? '' : 's'} assigns it to slots ` +
          `${alreadyAt} and ${i}.\n` +
          `  Pass --writers ${writes.length}, or drop the "username" from that ` +
          `block so the\n  extra slots can take sessions of their own.`,
      };
    }
    pinnedSlots.set(write.label, i);
    let session = byUsername.get(write.username);
    if (!session) {
      return {
        error:
          `Write block "${write.label}" is pinned to username ` +
          `"${write.username}", which has no authenticated session.\n` +
          `  The credential file's rows in use are: ` +
          `${sessions.map((s) => s.username).join(', ')}.\n` +
          `  Either that row is missing from the CSV, its login failed, or it\n` +
          `  sits past --readers + --writers rows and was never read.`,
      };
    }
    slots[i] = { session, write };
    taken.add(session);
  }

  let free = sessions.filter((s) => !taken.has(s));
  for (let i = 0; i < writerCount; i++) {
    if (slots[i]) {
      continue;
    }
    let session = free.shift();
    if (!session) {
      return {
        error:
          `Not enough sessions to fill ${writerCount} writer slots once the ` +
          `pinned blocks took theirs.`,
      };
    }
    slots[i] = { session, write: blockFor(i) };
    taken.add(session);
  }

  // Readers are whatever the writers did not take, in file order — but never
  // MORE than were asked for. Two blocks pinned to one identity leave a spare
  // session behind, and handing it to a reader would put a quarter more search
  // load on the realm than `--readers` named. Reader count is what the rest of
  // the summary is read against, so a run that quietly grew one is not
  // comparable to a run that did not.
  let readerSessions = sessions
    .filter((s) => !taken.has(s))
    .slice(0, requestedReaders);
  return { assignments: slots as WriterAssignment[], readerSessions };
}

// Sessions that ended up driving nothing: authenticated, counted against the
// credential file, and then left out because a pinned block freed one up. Named
// so the banner can say so rather than leaving the arithmetic unexplained.
export function idleSessions(
  sessions: readonly Session[],
  result: { assignments: WriterAssignment[]; readerSessions: Session[] },
): Session[] {
  let used = new Set<Session>([
    ...result.assignments.map((a) => a.session),
    ...result.readerSessions,
  ]);
  return sessions.filter((s) => !used.has(s));
}
