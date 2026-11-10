import QUnit from 'qunit';
const { module, test } = QUnit;
import type { ChangeEvent } from '@cardstack/runtime-common';
import {
  DEFAULT_GROUPING_LIMITS,
  closedByClock,
  deadline,
  decide,
  extendGroup,
  openGroup,
  type CloseReason,
  type GroupingLimits,
  type OpenGroup,
} from '../src/grouper.ts';

const T0 = Date.parse('2026-11-10T12:00:00.000Z');
const ALICE = '@alice:localhost';
const BOB = '@bob:localhost';
const CAROL = '@carol:localhost';
const OUTAGE_MS = 20 * 60_000;

// The time `seconds` after T0, in milliseconds since the epoch.
function at(seconds: number): number {
  return T0 + Math.round(seconds * 1000);
}

interface ClosedGroup {
  seqs: number[];
  reason: CloseReason;
}

// Groups `events` the way a recorder does, and returns the groups in the
// order they closed, each with the seqs of its events and why it closed.
//
// `live` hands each event over at its own `occurred_at`, with the clock
// ticking every 100 ms from the first event and checked on every tick.
// `backlog` hands every event over at once, as a task catching up after an
// outage does, and checks the clock only after the last, 20 minutes on.
function runGrouper(
  events: ChangeEvent[],
  mode: 'live' | 'backlog',
  limits: GroupingLimits = DEFAULT_GROUPING_LIMITS,
): ClosedGroup[] {
  let closed: ClosedGroup[] = [];
  let open: { group: OpenGroup; seqs: number[] } | undefined;

  function close(reason: CloseReason) {
    closed.push({ seqs: open!.seqs, reason });
    open = undefined;
  }

  function hand(event: ChangeEvent) {
    let { closeBefore, closeAfter } = decide(open?.group, event, limits);
    if (open && closeBefore) {
      close(closeBefore);
    }
    open = open
      ? {
          group: extendGroup(open.group, event),
          seqs: [...open.seqs, event.seq],
        }
      : { group: openGroup(event), seqs: [event.seq] };
    if (closeAfter) {
      close(closeAfter);
    }
  }

  function tick(now: number) {
    if (open) {
      let reason = closedByClock(open.group, now, limits);
      if (reason) {
        close(reason);
      }
    }
  }

  let times = events.map((event) => Date.parse(event.occurredAt));
  let end = Math.max(...times) + OUTAGE_MS;
  if (mode === 'backlog') {
    events.forEach(hand);
    tick(end);
  } else {
    let next = 0;
    for (let now = times[0]; now <= end; now += 100) {
      while (next < events.length && times[next] <= now) {
        hand(events[next++]);
      }
      tick(now);
    }
  }
  if (open) {
    throw new Error(`group ${open.seqs.join(',')} never closed`);
  }
  return closed;
}

function seqsOf(groups: ClosedGroup[]): number[][] {
  return groups.map((group) => group.seqs);
}

// The seqs from `from` to `to`, inclusive.
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

module('grouper', (hooks) => {
  let seq: number;

  hooks.beforeEach(() => {
    seq = 0;
  });

  // An event `seconds` after T0: by default Alice saving one card in the
  // host.
  function event(
    seconds: number,
    overrides: Partial<ChangeEvent> = {},
  ): ChangeEvent {
    seq++;
    return {
      seq,
      xid: String(1000 + seq),
      realmId: '0b7c3a1e-6d2f-4a5b-9c8d-1e2f3a4b5c6d',
      realmURL: 'http://localhost:4201/test-user/test-realm/',
      occurredAt: new Date(at(seconds)).toISOString(),
      author: ALICE,
      channel: 'host',
      changes: [
        {
          path: 'Author/jane.json',
          status: 'M',
          contentHash: 'fingerprint',
          size: 100,
        },
      ],
      ...overrides,
    };
  }

  // A push event by Bob from boxel-cli, changing `files` files.
  function pushEvent(
    seconds: number,
    pushId: string,
    { files = 10, final = false }: { files?: number; final?: boolean } = {},
  ): ChangeEvent {
    return event(seconds, {
      author: BOB,
      channel: 'boxel-cli',
      pushId,
      ...(final ? { pushFinal: true } : {}),
      changes: Array.from({ length: files }, (_, index) => ({
        path: `cards/${seq + 1}-${index}.json`,
        status: 'A' as const,
        contentHash: 'fingerprint',
        size: 100,
      })),
    });
  }

  // The group the events form when each joins the last.
  function groupOf(...events: ChangeEvent[]): OpenGroup {
    let [first, ...rest] = events;
    return rest.reduce(
      (group, next) => extendGroup(group, next),
      openGroup(first),
    );
  }

  // Events one second apart, from `from` to `to` seconds after T0.
  function burst(
    from: number,
    to: number,
    overrides: Partial<ChangeEvent> = {},
  ): ChangeEvent[] {
    return range(from, to).map((seconds) => event(seconds, overrides));
  }

  module('the open group', () => {
    test('tracks its first event, its earliest and latest writes and its changes', (assert) => {
      let first = event(5);
      let group = groupOf(
        first,
        event(7),
        event(4.5, {
          changes: [
            { path: 'a.json', status: 'A', contentHash: 'x', size: 1 },
            { path: 'b.json', status: 'D' },
          ],
        }),
      );
      assert.strictEqual(group.first, first);
      assert.strictEqual(group.earliestAt, at(4.5), 'earliest, not first');
      assert.strictEqual(group.latestAt, at(7), 'latest, not last');
      assert.strictEqual(group.changeCount, 4);
    });

    test('an event with no open group opens one', (assert) => {
      assert.deepEqual(decide(undefined, event(0)), {});
    });

    test('an event with an invalid occurred_at is refused', (assert) => {
      assert.throws(
        () => openGroup(event(0, { occurredAt: 'yesterday' })),
        /event 1 has an invalid occurred_at "yesterday"/,
      );
    });
  });

  module('quiet period', () => {
    test('an event within the quiet period of the latest write joins the group', (assert) => {
      let group = groupOf(event(0), event(1));
      assert.deepEqual(decide(group, event(2.9)), {});
    });

    test('an event at the end of the quiet period closes the group before it', (assert) => {
      let group = groupOf(event(0), event(1));
      assert.deepEqual(decide(group, event(3)), {
        closeBefore: 'quiet-period',
      });
    });

    test('the clock closes the group once the quiet period has passed since its latest write', (assert) => {
      let group = groupOf(event(0), event(1));
      assert.deepEqual(deadline(group), { at: at(3), reason: 'quiet-period' });
      assert.strictEqual(closedByClock(group, at(2.999)), undefined);
      assert.strictEqual(closedByClock(group, at(3)), 'quiet-period');
    });

    test('a write carrying an earlier time than the latest does not shorten the quiet period', (assert) => {
      let group = groupOf(event(0), event(1), event(0.5));
      assert.strictEqual(deadline(group).at, at(3));
    });
  });

  module('maximum age', () => {
    test('a run of writes with no pause closes at the maximum age after its earliest write', (assert) => {
      assert.deepEqual(decide(groupOf(...burst(0, 28)), event(29)), {});
      assert.deepEqual(decide(groupOf(...burst(0, 29)), event(30)), {
        closeBefore: 'max-age',
      });
    });

    test('the clock closes the group at the maximum age while the writes continue', (assert) => {
      let group = groupOf(...burst(0, 29));
      assert.deepEqual(deadline(group), { at: at(30), reason: 'max-age' });
      assert.strictEqual(closedByClock(group, at(29.999)), undefined);
      assert.strictEqual(closedByClock(group, at(30)), 'max-age');
    });

    test('a write carrying an earlier time than the first moves the maximum age earlier', (assert) => {
      let group = groupOf(...burst(10, 39), event(9.5));
      assert.deepEqual(deadline(group), { at: at(39.5), reason: 'max-age' });
    });
  });

  module('writer', () => {
    test("another author's event closes the group", (assert) => {
      assert.deepEqual(decide(groupOf(event(0)), event(1, { author: BOB })), {
        closeBefore: 'author',
      });
    });

    test('an event on another channel closes the group', (assert) => {
      assert.deepEqual(
        decide(groupOf(event(0)), event(1, { channel: 'boxel-cli' })),
        { closeBefore: 'channel' },
      );
    });

    test("another agent's event closes the group", (assert) => {
      let ai = { channel: 'ai-assistant', room: '!room:localhost' } as const;
      let group = groupOf(event(0, { ...ai, agent: 'model-a' }));
      assert.deepEqual(decide(group, event(1, { ...ai, agent: 'model-b' })), {
        closeBefore: 'agent',
      });
    });

    test('an event from another room closes the group, even with the same agent', (assert) => {
      let ai = { channel: 'ai-assistant', agent: 'model-a' } as const;
      let group = groupOf(event(0, { ...ai, room: '!one:localhost' }));
      assert.deepEqual(
        decide(group, event(1, { ...ai, room: '!two:localhost' })),
        { closeBefore: 'room' },
      );
    });

    test('events of the same writer join the group', (assert) => {
      let ai = {
        channel: 'ai-assistant',
        agent: 'model-a',
        room: '!room:localhost',
        correlationId: 'tool-call-1',
      } as const;
      assert.deepEqual(decide(groupOf(event(0, ai)), event(1, ai)), {});
    });

    for (let channel of ['ai-assistant', 'mcp'] as const) {
      test(`on ${channel}, another tool call's event closes the group`, (assert) => {
        let group = groupOf(event(0, { channel, correlationId: 'call-1' }));
        assert.deepEqual(
          decide(group, event(0.1, { channel, correlationId: 'call-2' })),
          { closeBefore: 'tool-call' },
        );
        assert.deepEqual(
          decide(group, event(0.1, { channel, correlationId: 'call-1' })),
          {},
          'the same tool call joins',
        );
      });
    }

    test('on ai-assistant, events with no tool call join the group', (assert) => {
      let group = groupOf(event(0, { channel: 'ai-assistant' }));
      assert.deepEqual(
        decide(group, event(1, { channel: 'ai-assistant' })),
        {},
      );
    });

    test('on other channels, events with different correlation ids join the group', (assert) => {
      for (let channel of ['host', 'boxel-cli', 'api'] as const) {
        let group = groupOf(event(0, { channel, correlationId: 'request-1' }));
        assert.deepEqual(
          decide(group, event(1, { channel, correlationId: 'request-2' })),
          {},
          channel,
        );
      }
    });

    test("groups stay contiguous: one writer's events either side of another's are two groups", (assert) => {
      let events = [
        event(0),
        event(0.5),
        event(1, { author: BOB }),
        event(1.5),
        event(2),
      ];
      assert.deepEqual(runGrouper(events, 'live'), [
        { seqs: [1, 2], reason: 'author' },
        { seqs: [3], reason: 'author' },
        { seqs: [4, 5], reason: 'quiet-period' },
      ]);
    });
  });

  module('intent', () => {
    let intents = [
      {
        kind: 'revert',
        revision: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        path: 'Author/',
        forced: false,
      },
      { kind: 'scan', source: 'cardstack/boxel', commit: 'abc1234' },
      { kind: 'delete-realm' },
    ] as const;

    for (let intent of intents) {
      test(`a ${intent.kind} event closes the open group before and after it`, (assert) => {
        let group = groupOf(event(0), event(0.5));
        assert.deepEqual(decide(group, event(1, { intent })), {
          closeBefore: 'intent',
          closeAfter: 'intent',
        });
      });

      test(`a ${intent.kind} event with no open group is a group of its own`, (assert) => {
        assert.deepEqual(decide(undefined, event(0, { intent })), {
          closeAfter: 'intent',
        });
      });
    }

    test("the same writer's events around an intent event are three groups", (assert) => {
      let revert = {
        kind: 'revert',
        revision: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        path: 'Author/',
        forced: false,
      } as const;
      let events = [event(0), event(0.5, { intent: revert }), event(1)];
      assert.deepEqual(runGrouper(events, 'live'), [
        { seqs: [1], reason: 'intent' },
        { seqs: [2], reason: 'intent' },
        { seqs: [3], reason: 'quiet-period' },
      ]);
    });

    test('a group opened by an intent event takes no other event', (assert) => {
      let group = openGroup(event(0, { intent: { kind: 'delete-realm' } }));
      assert.deepEqual(decide(group, event(0.5)), { closeBefore: 'intent' });
    });
  });

  module('push', () => {
    test('neither the quiet period nor the maximum age closes a push group', (assert) => {
      let events = range(0, 29).map((step) => pushEvent(step * 3, 'P'));
      let group = groupOf(...events.slice(0, -1));
      assert.deepEqual(decide(group, events[29]), {}, 'a 3 s gap, 87 s in');
      let whole = groupOf(...events);
      assert.deepEqual(deadline(whole), {
        at: at(87 + 60),
        reason: 'push-timeout',
      });
      assert.strictEqual(closedByClock(whole, at(87 + 59.999)), undefined);
    });

    test("the push's final event closes its group after it", (assert) => {
      let group = groupOf(pushEvent(0, 'P'), pushEvent(3, 'P'));
      assert.deepEqual(decide(group, pushEvent(6, 'P', { final: true })), {
        closeAfter: 'push-final',
      });
    });

    test('a final event with no open group is a group of its own', (assert) => {
      assert.deepEqual(decide(undefined, pushEvent(0, 'P', { final: true })), {
        closeAfter: 'push-final',
      });
    });

    test('a final mark on an event with no push ID is ignored', (assert) => {
      assert.deepEqual(
        decide(groupOf(event(0)), event(1, { pushFinal: true })),
        {},
      );
    });

    test('an abandoned push closes at the push timeout after its latest write', (assert) => {
      let group = groupOf(pushEvent(0, 'P'), pushEvent(3, 'P'));
      assert.strictEqual(closedByClock(group, at(62.999)), undefined);
      assert.strictEqual(closedByClock(group, at(63)), 'push-timeout');
      assert.deepEqual(
        decide(group, pushEvent(63, 'P')),
        { closeBefore: 'push-timeout' },
        'the push resuming after the timeout opens a further group',
      );
    });

    test('a push group closes after the event that reaches the push group limit', (assert) => {
      let limits = { ...DEFAULT_GROUPING_LIMITS, pushGroupLimit: 25 };
      let events = [
        pushEvent(0, 'P'),
        pushEvent(3, 'P'),
        pushEvent(6, 'P'),
        pushEvent(9, 'P'),
        pushEvent(12, 'P', { files: 5, final: true }),
      ];
      assert.deepEqual(decide(groupOf(events[0]), events[1], limits), {});
      assert.deepEqual(
        decide(groupOf(events[0], events[1]), events[2], limits),
        { closeAfter: 'push-limit' },
        '30 changes reach the limit of 25',
      );
      assert.deepEqual(runGrouper(events, 'live', limits), [
        { seqs: [1, 2, 3], reason: 'push-limit' },
        { seqs: [4, 5], reason: 'push-final' },
      ]);
    });

    test('a push starting or ending closes the open group', (assert) => {
      let write = groupOf(event(0, { author: BOB, channel: 'boxel-cli' }));
      assert.deepEqual(decide(write, pushEvent(0.5, 'P')), {
        closeBefore: 'push',
      });
      assert.deepEqual(
        decide(groupOf(pushEvent(0, 'P')), pushEvent(0.5, 'Q')),
        { closeBefore: 'push' },
        'another push',
      );
      assert.deepEqual(
        decide(
          groupOf(pushEvent(0, 'P')),
          event(0.5, { author: BOB, channel: 'boxel-cli' }),
        ),
        { closeBefore: 'push' },
        'a write outside the push',
      );
    });

    test("another writer's event splits a push into two groups with the push ID around its own", (assert) => {
      // Bob pushes 300 files in 30 requests over 90 s, and Carol saves a
      // card in the host while his 12th request is in flight.
      let events = [
        ...range(0, 10).map((step) => pushEvent(step * 3, 'P')),
        event(32, { author: CAROL }),
        ...range(11, 29).map((step) =>
          pushEvent(step * 3, 'P', { final: step === 29 }),
        ),
      ];
      let groups = runGrouper(events, 'live');
      assert.deepEqual(groups, [
        { seqs: range(1, 11), reason: 'author' },
        { seqs: [12], reason: 'author' },
        { seqs: range(13, 31), reason: 'push-final' },
      ]);
      let pushIds = groups.map(
        (group) => events[group.seqs[0] - 1].pushId ?? null,
      );
      assert.deepEqual(pushIds, ['P', null, 'P']);
      assert.deepEqual(
        groups.map((group) =>
          group.seqs.reduce(
            (count, s) => count + events[s - 1].changes.length,
            0,
          ),
        ),
        [110, 1, 190],
      );
    });
  });

  module('autosave', () => {
    test('a burst of saves 1 s apart is one group, closed 2 s after the last save', (assert) => {
      let events = burst(0, 7);
      assert.deepEqual(runGrouper(events, 'live'), [
        { seqs: range(1, 8), reason: 'quiet-period' },
      ]);
      assert.strictEqual(
        closedByClock(groupOf(...events), at(8.999)),
        undefined,
      );
      assert.strictEqual(
        closedByClock(groupOf(...events), at(9)),
        'quiet-period',
      );
    });

    test('two minutes of saves with no 2 s pause split at the maximum age', (assert) => {
      let events = burst(0, 119);
      assert.deepEqual(runGrouper(events, 'live'), [
        { seqs: range(1, 30), reason: 'max-age' },
        { seqs: range(31, 60), reason: 'max-age' },
        { seqs: range(61, 90), reason: 'max-age' },
        { seqs: range(91, 120), reason: 'max-age' },
      ]);
    });
  });

  module('limits', () => {
    test('every limit can be overridden', (assert) => {
      let limits: GroupingLimits = {
        quietPeriodMs: 5_000,
        maxAgeMs: 10_000,
        pushGroupLimit: 2,
        pushTimeoutMs: 1_000,
      };
      assert.deepEqual(decide(groupOf(event(0)), event(4), limits), {});
      assert.deepEqual(decide(groupOf(...burst(0, 9)), event(10), limits), {
        closeBefore: 'max-age',
      });
      assert.deepEqual(
        decide(undefined, pushEvent(0, 'P', { files: 2 }), limits),
        { closeAfter: 'push-limit' },
      );
      let oneFile = { files: 1 };
      assert.deepEqual(
        decide(
          groupOf(pushEvent(0, 'P', oneFile)),
          pushEvent(1, 'P', oneFile),
          limits,
        ),
        { closeBefore: 'push-timeout' },
      );
    });
  });

  module('backlog', () => {
    test('a backlog read after an outage groups exactly as it would have live', (assert) => {
      let revert = {
        kind: 'revert',
        revision: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        path: 'Author/',
        forced: false,
      } as const;
      let ai = {
        channel: 'ai-assistant',
        agent: 'model-a',
        room: '!room:localhost',
      } as const;
      let events = [
        // Alice's autosave burst, then the AI assistant's two tool calls in
        // her room, the first 300 ms after her last save.
        ...burst(0, 7),
        event(7.3, { ...ai, correlationId: 'call-1' }),
        event(7.6, { ...ai, correlationId: 'call-1' }),
        event(8, { ...ai, correlationId: 'call-2' }),
        // Bob's push, which Carol interrupts.
        pushEvent(20, 'P'),
        pushEvent(23, 'P'),
        event(24, { author: CAROL }),
        pushEvent(26, 'P'),
        pushEvent(29, 'P', { final: true }),
        // A revert between two of Alice's saves.
        event(40),
        event(40.5, { intent: revert }),
        event(41),
        // Two minutes of saves with no pause.
        ...burst(50, 169),
        // A push the client abandons, and one that resumes after the
        // timeout.
        pushEvent(200, 'Q'),
        pushEvent(203, 'Q'),
        pushEvent(300, 'Q', { final: true }),
      ];
      let live = runGrouper(events, 'live');
      assert.deepEqual(runGrouper(events, 'backlog'), live);
      assert.deepEqual(seqsOf(live), [
        range(1, 8),
        [9, 10],
        [11],
        [12, 13],
        [14],
        [15, 16],
        [17],
        [18],
        [19],
        range(20, 49),
        range(50, 79),
        range(80, 109),
        range(110, 139),
        [140, 141],
        [142],
      ]);
    });
  });
});
