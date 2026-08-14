import type { Ticket } from '../ticket';
import { statusIsTerminal } from '../ticket-taxonomy';
import { timerSnapshot, urgencyRank } from './sla';
import { slaClock } from './sla-clock';

/**
 * The six questions an agent asks the queue.
 *
 * They live here, not in a component, because two surfaces now ask them: the
 * rail that shows the counts and the list that shows the rows. If each owned
 * its own copy of the predicate, a rail reading "2 breached" beside a list
 * showing three rows is a bug nobody can see the cause of — the reader assumes
 * the data is wrong when it is the definition that drifted.
 */
export type Lens =
  | 'open'
  | 'at-risk'
  | 'breached'
  | 'unassigned'
  | 'waiting'
  | 'resolved';

export interface LensSpec {
  key: Lens;
  label: string;
  /** What the count means when it is not zero, for the rail's title text. */
  hint: string;
  tone?: 'bad' | 'warn' | 'ok' | 'hold';
}

export const LENSES: LensSpec[] = [
  {
    key: 'open',
    label: 'In progress',
    hint: 'Everything still being worked.',
  },
  {
    key: 'at-risk',
    label: 'At risk',
    hint: 'The clock is close enough to matter.',
    tone: 'warn',
  },
  {
    key: 'breached',
    label: 'Overdue',
    hint: 'Already past what was promised.',
    tone: 'bad',
  },
  {
    key: 'unassigned',
    label: 'Unclaimed',
    hint: 'Nobody has picked these up.',
  },
  {
    key: 'waiting',
    label: 'On customer',
    hint: 'Waiting on a reply, clock paused.',
    tone: 'hold',
  },
  {
    key: 'resolved',
    label: 'Resolved',
    hint: 'Done, kept visible for the day.',
    tone: 'ok',
  },
];

/**
 * The governing timer's state, computed NOW.
 *
 * These predicates used to read `ticket.slaState`, which is a computed field:
 * it is evaluated when the card is loaded or indexed and has no tracked
 * dependency on the clock, so it holds whatever was true at load time. The
 * row badges meanwhile compute live off `slaClock`. The two therefore
 * disagreed on screen — a ticket would breach while the console was open, its
 * badge would turn red, and the rail's "Overdue" count would stay at 0 with
 * the filter rendering "Nothing matches these filters" over the very row that
 * was showing red.
 *
 * Reading `slaClock.now` also subscribes the caller's render to the tick, so
 * the counts move for the same reason the badges do.
 */
function liveSlaState(ticket: Ticket, now: Date): string {
  let timers = (ticket.timers ?? []).filter(Boolean);
  if (!timers.length) {
    return '';
  }
  let snapshots = timers.map((timer) => timerSnapshot(timer, now));
  let governing = [...snapshots].sort(
    (a, b) => urgencyRank(a) - urgencyRank(b),
  )[0];
  return governing?.state ?? '';
}

export function matchesLens(
  ticket: Ticket,
  lens: Lens,
  now: Date = slaClock.now,
): boolean {
  let state = liveSlaState(ticket, now);
  switch (lens) {
    case 'open':
      return !statusIsTerminal(ticket.status) && ticket.status !== 'Resolved';
    case 'at-risk':
      return state === 'warning' || state === 'urgent';
    case 'breached':
      return state === 'breached';
    case 'unassigned':
      return !ticket.assigneeName && !statusIsTerminal(ticket.status);
    case 'waiting':
      return ticket.status === 'Pending' || ticket.status === 'On Hold';
    case 'resolved':
      return ticket.status === 'Resolved' || ticket.status === 'Closed';
  }
}

/** Live work only — a queue's headline number is what is still open in it. */
export function isLiveWork(ticket: Ticket): boolean {
  return !statusIsTerminal(ticket.status) && ticket.status !== 'Resolved';
}
