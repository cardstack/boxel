// Grouping: which consecutive change events of one realm fold into one
// revision. The module is pure. The recorder hands it the open group and the
// next event, and it answers whether the group closes before the event, after
// it, or not at all. It never reads the clock: the recorder passes the time
// in, so the tests drive it with times of their own.
//
// A group is one writer's run of events. Its events share the author,
// channel, agent, room and push ID, and on the `ai-assistant` and `mcp`
// channels the tool call (`correlationId`), so each AI or MCP tool call is
// its own revision while an autosave burst coalesces into one. An event with
// an intent (a revert, a scan or a realm deletion) is always a revision of
// its own.
//
// Time closes a group at its deadline: the quiet period after its latest
// write or the maximum age after its earliest, whichever comes first. A push
// group (events with a push ID) has neither. Its deadline is the push timeout
// after its latest write, which ends a push the client abandoned, and it also
// closes after the push's final event or once it reaches the push group
// limit.
//
// An event at or after the deadline closes the group before it. That is
// measured by the events' own `occurred_at`, not by when they are read, so a
// backlog read after an outage groups as it would have live. The clock closes
// a group only when no later event is in hand, and at the same deadline. The
// time it is checked at must be one by which every event with an earlier
// `occurred_at` is in hand (see `closedByClock`). Given such a time, the clock
// never closes a group that the next event would have extended, so a group
// closes at the same event, and for the same reason, whether the clock or the
// next event closes it.
//
// Groups are contiguous in the realm's event order: each event either joins
// the open group or opens the next one.

import type { ChangeEvent, WriteChannel } from '@cardstack/runtime-common';

export interface GroupingLimits {
  // A group closes once this long has passed since its latest write.
  readonly quietPeriodMs: number;
  // A group closes once this long has passed since its earliest write.
  readonly maxAgeMs: number;
  // A push group closes once its events hold this many changes. An event is
  // never split, so the event that reaches the limit can take the group past
  // it.
  readonly pushGroupLimit: number;
  // A push group closes once this long has passed since its latest write.
  readonly pushTimeoutMs: number;
}

// The proposed limits. The push values are placeholders until they are
// measured under production load. Every function requires its limits as an
// argument, so a task can run with others, and a caller hands the same limits
// to each: the next event and the clock agree on a group's deadline only when
// they measure it with the same limits.
export const DEFAULT_GROUPING_LIMITS: GroupingLimits = {
  quietPeriodMs: 2_000,
  maxAgeMs: 30_000,
  pushGroupLimit: 1_000,
  pushTimeoutMs: 60_000,
};

// Why a group closed, for the revision's log line.
export type CloseReason =
  // Time: the group's deadline passed.
  | 'quiet-period'
  | 'max-age'
  | 'push-timeout'
  // The event, or the group, names its own revision.
  | 'intent'
  // The next event is another writer's.
  | 'author'
  | 'channel'
  | 'agent'
  | 'room'
  | 'push'
  | 'tool-call'
  // The push ended, or its group is full.
  | 'push-final'
  | 'push-limit';

// What grouping needs to know about the open group. The recorder keeps the
// group's events and captured objects itself.
export interface OpenGroup {
  // The group's first event. Every event in the group shares its writer.
  readonly first: ChangeEvent;
  // The earliest and latest `occurred_at` among the group's events, in
  // milliseconds since the epoch. `occurred_at` is when an event's
  // transaction started, and events are ordered by transaction ID, which a
  // transaction takes at its first write, so a later event can carry a
  // slightly earlier time.
  readonly earliestAt: number;
  readonly latestAt: number;
  // The number of changes the group's events hold.
  readonly changeCount: number;
}

// What happens to the open group when the next event arrives:
//
// * neither reason set: the event joins the open group, or opens a group
//   when none is open;
// * `closeBefore`: the open group closes, and the event opens the next one;
// * `closeAfter`: the group the event joined, or opened, closes after it;
// * both: the open group closes, and the event is a revision of its own.
export interface Decision {
  closeBefore?: CloseReason;
  closeAfter?: CloseReason;
}

export interface Deadline {
  // Milliseconds since the epoch.
  at: number;
  reason: CloseReason;
}

export function openGroup(event: ChangeEvent): OpenGroup {
  let at = timeOf(event);
  return {
    first: event,
    earliestAt: at,
    latestAt: at,
    changeCount: event.changes.length,
  };
}

export function extendGroup(group: OpenGroup, event: ChangeEvent): OpenGroup {
  let at = timeOf(event);
  return {
    first: group.first,
    earliestAt: Math.min(group.earliestAt, at),
    latestAt: Math.max(group.latestAt, at),
    changeCount: group.changeCount + event.changes.length,
  };
}

// Decides what `event`, the next event of the realm in its order, does to
// the open group. `group` is undefined when no group is open.
export function decide(
  group: OpenGroup | undefined,
  event: ChangeEvent,
  limits: GroupingLimits,
): Decision {
  let decision: Decision = {};
  let closeBefore = group ? closesBefore(group, event, limits) : undefined;
  if (closeBefore) {
    decision.closeBefore = closeBefore;
  }
  let joined =
    group && !closeBefore ? extendGroup(group, event) : openGroup(event);
  let closeAfter = closesAfter(joined, event, limits);
  if (closeAfter) {
    decision.closeAfter = closeAfter;
  }
  return decision;
}

// When time closes the group, and why. A recorder with no later event in
// hand schedules its check for this moment.
export function deadline(group: OpenGroup, limits: GroupingLimits): Deadline {
  if (isPush(group.first)) {
    return {
      at: group.latestAt + limits.pushTimeoutMs,
      reason: 'push-timeout',
    };
  }
  let quiet = group.latestAt + limits.quietPeriodMs;
  let aged = group.earliestAt + limits.maxAgeMs;
  return quiet <= aged
    ? { at: quiet, reason: 'quiet-period' }
    : { at: aged, reason: 'max-age' };
}

// Whether the clock closes the open group at `now`, with no later event in
// hand: it does once `now` reaches the group's deadline.
//
// `now` must be a time by which every event of the realm with an earlier
// `occurred_at` is in hand. The wall clock alone isn't one. `occurred_at` is
// when an event's transaction started, and the event reaches the recorder
// only once the transaction has committed and been read. An event that
// arrives after the wall clock has passed its group's deadline would then open
// a group of its own, where a backlog would have joined it to the group. A
// recorder can pass the wall clock less a grace period that covers that
// delay, or a time it derives from the visibility horizon.
export function closedByClock(
  group: OpenGroup,
  now: number,
  limits: GroupingLimits,
): CloseReason | undefined {
  let { at, reason } = deadline(group, limits);
  return now >= at ? reason : undefined;
}

const TOOL_CALL_CHANNELS: ReadonlySet<WriteChannel> = new Set([
  'ai-assistant',
  'mcp',
]);

// Time is checked first, so that the reason is the one the clock would have
// given had it closed the group before the event arrived.
function closesBefore(
  group: OpenGroup,
  event: ChangeEvent,
  limits: GroupingLimits,
): CloseReason | undefined {
  let due = deadline(group, limits);
  if (timeOf(event) >= due.at) {
    return due.reason;
  }
  if (group.first.intent || event.intent) {
    return 'intent';
  }
  return writerChange(group.first, event);
}

function closesAfter(
  group: OpenGroup,
  event: ChangeEvent,
  limits: GroupingLimits,
): CloseReason | undefined {
  if (event.intent) {
    return 'intent';
  }
  if (!isPush(event)) {
    return undefined;
  }
  if (event.pushFinal) {
    return 'push-final';
  }
  if (group.changeCount >= limits.pushGroupLimit) {
    return 'push-limit';
  }
  return undefined;
}

// How `next` is another writer's than `first`, or undefined when it is the
// same writer's. A value missing from both events counts as equal.
function writerChange(
  first: ChangeEvent,
  next: ChangeEvent,
): CloseReason | undefined {
  if (first.author !== next.author) {
    return 'author';
  }
  if (first.channel !== next.channel) {
    return 'channel';
  }
  if (first.agent !== next.agent) {
    return 'agent';
  }
  if (first.room !== next.room) {
    return 'room';
  }
  if (first.pushId !== next.pushId) {
    return 'push';
  }
  if (
    TOOL_CALL_CHANNELS.has(first.channel) &&
    first.correlationId !== next.correlationId
  ) {
    return 'tool-call';
  }
  return undefined;
}

function isPush(event: ChangeEvent): boolean {
  return event.pushId !== undefined;
}

function timeOf(event: ChangeEvent): number {
  let at = Date.parse(event.occurredAt);
  if (Number.isNaN(at)) {
    throw new Error(
      `event ${event.seq} has an invalid occurred_at ${JSON.stringify(event.occurredAt)}`,
    );
  }
  return at;
}
