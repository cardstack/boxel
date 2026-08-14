// Pure SLA arithmetic for the ServiceDesk app. No card, template or Ember
// imports live here on purpose: this is the one piece of the app that has to be
// reasoned about (and eventually tested) without booting a realm.
//
// Division of labour, decided up front because it shapes every consumer:
//
//   * BUSINESS-HOURS maths (which wall-clock instant is 8 working hours from
//     now, given Mon-Fri 09:00-17:00 in Asia/Kuala_Lumpur with holidays) is
//     expensive and needs the SLA policy AND its linked Schedule. It runs
//     ONCE, in a command, at the moment a timer is started, paused or resumed,
//     and the answer is stored on the timer as `deadlineAt`.
//
//   * COUNTDOWN maths (how much of that is left, what colour is it) is cheap
//     and needs nothing but the timer's own fields. It runs constantly — in a
//     computed field at index time for the fitted snapshot, and once a second
//     in the live badge.
//
// Putting the calendar in the second group is what would make a queue of fifty
// rows recompute holiday tables every tick.

export type TimerState =
  | 'met'
  | 'paused'
  | 'healthy'
  | 'warning'
  | 'urgent'
  | 'breached';

export interface DayWindow {
  /** 0 = Sunday … 6 = Saturday, matching Date#getDay. */
  day: number;
  openMinutes: number;
  closeMinutes: number;
}

export interface BusinessSchedule {
  /** IANA zone, e.g. 'Asia/Kuala_Lumpur'. */
  timeZone: string;
  windows: DayWindow[];
  /** 'YYYY-MM-DD' dates on which the clock does not tick at all. */
  holidays: string[];
}

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** A schedule that never stops — the fallback when a policy links no Schedule. */
export const ALWAYS_ON: BusinessSchedule = {
  timeZone: 'UTC',
  windows: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    openMinutes: 0,
    closeMinutes: DAY_MINUTES,
  })),
  holidays: [],
};

// ---------------------------------------------------------------------------
// Timezone-aware wall clock
// ---------------------------------------------------------------------------

// Intl is the only timezone database available to us, so the wall-clock parts
// of an instant are read back out of a formatter rather than computed. Doing
// this with a fixed UTC offset instead would be wrong twice a year in every
// zone that observes DST — and an SLA that silently shifts by an hour each
// spring is worse than one with no business hours at all.
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutesOfDay: number;
  /** 'YYYY-MM-DD' in the schedule's zone, for holiday lookup. */
  isoDate: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, cached);
  }
  return cached;
}

export function zonedParts(at: Date, timeZone: string): ZonedParts {
  let parts: Record<string, string> = {};
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatterFor(timeZone);
  } catch {
    // An unknown or misspelled zone must not take the whole card down; UTC is
    // a wrong-but-usable answer and the schedule editor shows the zone, so a
    // bad value is visible to whoever set it.
    formatter = formatterFor('UTC');
  }
  for (let part of formatter.formatToParts(at)) {
    parts[part.type] = part.value;
  }
  // `24` is what en-US hour12:false emits for midnight; normalising it here
  // keeps every downstream comparison on a 0–1439 scale.
  let hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX[parts.weekday ?? 'Sun'] ?? 0,
    minutesOfDay: hour * 60 + Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function windowsFor(
  schedule: BusinessSchedule,
  parts: ZonedParts,
): DayWindow[] {
  if (schedule.holidays?.includes(parts.isoDate)) {
    return [];
  }
  return (schedule.windows ?? [])
    .filter((w) => w.day === parts.weekday && w.closeMinutes > w.openMinutes)
    .sort((a, b) => a.openMinutes - b.openMinutes);
}

function isAlwaysOn(schedule: BusinessSchedule): boolean {
  return (
    (schedule.holidays?.length ?? 0) === 0 &&
    (schedule.windows?.length ?? 0) === 7 &&
    schedule.windows.every(
      (w) => w.openMinutes <= 0 && w.closeMinutes >= DAY_MINUTES,
    )
  );
}

// ---------------------------------------------------------------------------
// The two expensive operations — called from commands, never from a template
// ---------------------------------------------------------------------------

/**
 * The wall-clock instant that is `minutes` of *working* time after `from`.
 *
 * Walks forward one day at a time rather than one minute at a time; a 72-hour
 * P4 resolution target against a 8h/day schedule is nine iterations, not
 * 4,320.
 */
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  schedule: BusinessSchedule = ALWAYS_ON,
): Date {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return new Date(from.getTime());
  }
  if (isAlwaysOn(schedule)) {
    return new Date(from.getTime() + minutes * MINUTE);
  }

  let remaining = minutes;
  let cursor = new Date(from.getTime());
  // A ticket raised on the Friday before a two-week shutdown still has to
  // resolve to a real date; 400 days is far past any sane target and stops a
  // misconfigured schedule (every window closed) from spinning forever.
  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    let parts = zonedParts(cursor, schedule.timeZone);
    let dayStart = cursor.getTime() - parts.minutesOfDay * MINUTE;
    for (let window of windowsFor(schedule, parts)) {
      // Only the part of the window that is still ahead of the cursor counts.
      let openAt = Math.max(window.openMinutes, parts.minutesOfDay);
      let available = window.closeMinutes - openAt;
      if (available <= 0) {
        continue;
      }
      if (available >= remaining) {
        return new Date(dayStart + (openAt + remaining) * MINUTE);
      }
      remaining -= available;
    }
    // Jump to the start of the next local day. Adding 25h and re-reading the
    // wall clock is DST-safe in a way that adding exactly 24h is not.
    cursor = new Date(dayStart + 25 * 60 * MINUTE);
    let next = zonedParts(cursor, schedule.timeZone);
    cursor = new Date(cursor.getTime() - next.minutesOfDay * MINUTE);
  }
  return new Date(cursor.getTime());
}

/** Working minutes elapsed between two instants. */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  schedule: BusinessSchedule = ALWAYS_ON,
): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }
  if (isAlwaysOn(schedule)) {
    return Math.round((to.getTime() - from.getTime()) / MINUTE);
  }

  let total = 0;
  let cursor = new Date(from.getTime());
  for (let guard = 0; guard < 400 && cursor.getTime() < to.getTime(); guard++) {
    let parts = zonedParts(cursor, schedule.timeZone);
    let dayStart = cursor.getTime() - parts.minutesOfDay * MINUTE;
    for (let window of windowsFor(schedule, parts)) {
      let openAt = Math.max(window.openMinutes, parts.minutesOfDay);
      let closeAt = Math.min(
        window.closeMinutes,
        Math.round((to.getTime() - dayStart) / MINUTE),
      );
      if (closeAt > openAt) {
        total += closeAt - openAt;
      }
    }
    cursor = new Date(dayStart + 25 * 60 * MINUTE);
    let next = zonedParts(cursor, schedule.timeZone);
    cursor = new Date(cursor.getTime() - next.minutesOfDay * MINUTE);
  }
  return total;
}

// ---------------------------------------------------------------------------
// The cheap operation — called from computed fields and once a second in the UI
// ---------------------------------------------------------------------------

export interface TimerFacts {
  targetMinutes?: number | null;
  startedAt?: Date | string | null;
  /** Wall-clock instant the target expires, already business-hours adjusted. */
  deadlineAt?: Date | string | null;
  satisfiedAt?: Date | string | null;
  /** Non-null while the clock is stopped. */
  pausedSince?: Date | string | null;
  breachedAt?: Date | string | null;
}

export interface TimerSnapshot {
  state: TimerState;
  /** Negative once breached. Null when there is nothing to count. */
  remainingMinutes: number | null;
  /** 0–100, clamped. Null when there is nothing to count. */
  percentRemaining: number | null;
  /** Short form for chips: '2h 34m', 'Met in 15m', '−12m'. */
  shortLabel: string;
  /** Long form for the workspace panel. */
  label: string;
}

function asDate(value?: Date | string | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  let d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/** '2h 34m', '45m', '3d 4h' — never '0h 154m'. */
export function formatMinutes(minutes: number): string {
  let m = Math.max(0, Math.round(Math.abs(minutes)));
  if (m < 60) {
    return `${m}m`;
  }
  let hours = Math.floor(m / 60);
  if (hours < 24) {
    let rem = m % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  let days = Math.floor(hours / 24);
  let remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

/**
 * Everything the UI needs about one timer, from its own fields plus `now`.
 *
 * `now` is a parameter rather than a `new Date()` inside so that the computed
 * field, the live badge and any future test all agree on what time it is.
 */
export function timerSnapshot(
  facts: TimerFacts,
  now: Date = new Date(),
): TimerSnapshot {
  let target = facts.targetMinutes ?? null;
  let deadline = asDate(facts.deadlineAt);
  let satisfied = asDate(facts.satisfiedAt);
  let started = asDate(facts.startedAt);
  let pausedSince = asDate(facts.pausedSince);

  // Met wins over everything: a resolution timer that was satisfied inside its
  // window stays green even after the deadline instant passes.
  if (satisfied) {
    let took = started
      ? Math.round((satisfied.getTime() - started.getTime()) / MINUTE)
      : null;
    return {
      state: 'met',
      remainingMinutes: null,
      percentRemaining: 100,
      shortLabel: took == null ? 'Met' : `Met in ${formatMinutes(took)}`,
      label:
        took == null
          ? 'Target met'
          : `Met in ${formatMinutes(took)}${
              target ? ` of ${formatMinutes(target)}` : ''
            }`,
    };
  }

  if (!deadline || !started) {
    return {
      state: 'paused',
      remainingMinutes: null,
      percentRemaining: null,
      shortLabel: 'No target',
      label: 'No SLA target applies',
    };
  }

  let remaining = Math.round((deadline.getTime() - now.getTime()) / MINUTE);
  let percent =
    target && target > 0
      ? Math.max(0, Math.min(100, Math.round((remaining / target) * 100)))
      : remaining > 0
        ? 100
        : 0;

  // A paused clock reports the time it had left when it stopped, which is what
  // `deadlineAt` already encodes — the resume command pushes the deadline out
  // by however long the pause lasted, so no separate arithmetic is needed here.
  if (pausedSince) {
    let held = Math.round(
      (deadline.getTime() - pausedSince.getTime()) / MINUTE,
    );
    // A clock can be stopped AFTER it has already run out — an agent moves a
    // breached ticket to Pending. `held` is then negative, and because
    // `formatMinutes` takes an absolute value the badge read "Paused with 12m
    // left" for a ticket that was twelve minutes overdue. Pausing does not
    // un-breach anything; it only stops the number getting worse.
    if (held <= 0) {
      return {
        state: 'breached',
        remainingMinutes: held,
        percentRemaining: 0,
        shortLabel: `−${formatMinutes(held)}`,
        label: `Breached ${formatMinutes(held)} ago, then paused`,
      };
    }
    return {
      state: 'paused',
      remainingMinutes: held,
      percentRemaining:
        target && target > 0
          ? Math.max(0, Math.min(100, Math.round((held / target) * 100)))
          : null,
      shortLabel: 'Paused',
      label: `Paused with ${formatMinutes(held)} left`,
    };
  }

  if (remaining <= 0) {
    return {
      state: 'breached',
      remainingMinutes: remaining,
      percentRemaining: 0,
      shortLabel: `−${formatMinutes(remaining)}`,
      label: `Breached ${formatMinutes(remaining)} ago`,
    };
  }

  // The three live bands from the spec. Ratio, not absolute time: 25% of a
  // 15-minute P1 target is a different kind of urgent from 25% of 72 hours,
  // but in both cases it means "three quarters of your budget is gone".
  let state: TimerState =
    percent > 50 ? 'healthy' : percent > 25 ? 'warning' : 'urgent';

  return {
    state,
    remainingMinutes: remaining,
    percentRemaining: percent,
    shortLabel: formatMinutes(remaining),
    label: `${formatMinutes(remaining)} remaining${
      target ? ` of ${formatMinutes(target)}` : ''
    }`,
  };
}

/** Ordering key for "nearest breach first". Breached sorts ahead of live. */
export function urgencyRank(snapshot: TimerSnapshot): number {
  switch (snapshot.state) {
    case 'breached':
      return -1_000_000 + (snapshot.remainingMinutes ?? 0);
    case 'urgent':
    case 'warning':
    case 'healthy':
      return snapshot.remainingMinutes ?? Number.MAX_SAFE_INTEGER;
    case 'paused':
      return Number.MAX_SAFE_INTEGER - 1;
    case 'met':
      return Number.MAX_SAFE_INTEGER;
  }
}

/** The one place the six states map to a hue name from `utils/index`. */
export const TIMER_HUE: Record<TimerState, string> = {
  met: 'green',
  healthy: 'green',
  warning: 'amber',
  urgent: 'orange',
  breached: 'red',
  paused: 'slate',
};
