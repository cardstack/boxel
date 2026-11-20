import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Connection } from '../src/security/oauth-provider-connections.ts';
import {
  accessLine,
  connectedLine,
  dayLabel,
  endsLine,
  groupByApp,
  hasEnded,
  lastUsedLine,
} from '../src/shell/connected-apps/format.ts';

// Times are in the test's own time zone, as the page reads them in the
// browser's: noon on 19 Nov 2026.
const NOW = new Date(2026, 10, 19, 12, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function at(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month, day, hour, minute).toISOString();
}

function ago(ms: number) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function later(ms: number) {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe('what a connection may do', () => {
  test("joins the registry's labels, the later ones in lower case", () => {
    assert.equal(accessLine(['Read']), 'Read');
    assert.equal(accessLine(['Read', 'Change']), 'Read and change');
    assert.equal(
      accessLine(['Read', 'Change', 'Publish']),
      'Read, change, and publish',
    );
  });
});

describe("a connection's dates", () => {
  test('a day is day first, with its year only when it is not this one', () => {
    assert.equal(dayLabel(at(2026, 9, 28), NOW), '28 Oct');
    assert.equal(dayLabel(at(2025, 9, 28), NOW), '28 Oct 2025');
  });

  test('last used: how long ago within the week, then the day', () => {
    assert.equal(lastUsedLine(null, NOW), 'Never used');
    assert.equal(lastUsedLine(ago(20 * 1000), NOW), 'Last used just now');
    assert.equal(lastUsedLine(ago(MINUTE), NOW), 'Last used 1 minute ago');
    assert.equal(
      lastUsedLine(ago(10 * MINUTE), NOW),
      'Last used 10 minutes ago',
    );
    assert.equal(lastUsedLine(ago(HOUR), NOW), 'Last used 1 hour ago');
    assert.equal(lastUsedLine(ago(2 * HOUR), NOW), 'Last used 2 hours ago');
    assert.equal(
      lastUsedLine(at(2026, 10, 18, 23, 30), NOW),
      'Last used yesterday',
    );
    assert.equal(lastUsedLine(at(2026, 10, 14), NOW), 'Last used 5 days ago');
    assert.equal(lastUsedLine(at(2026, 10, 12), NOW), 'Last used 12 Nov');
    // A clock a little ahead of the browser's is still "just now".
    assert.equal(lastUsedLine(later(MINUTE), NOW), 'Last used just now');
  });

  test('connected: today, yesterday, or the day', () => {
    assert.equal(connectedLine(at(2026, 10, 19, 0, 5), NOW), 'Connected today');
    assert.equal(
      connectedLine(at(2026, 10, 18, 23, 55), NOW),
      'Connected yesterday',
    );
    assert.equal(connectedLine(at(2026, 9, 30), NOW), 'Connected 30 Oct');
  });

  test('ends: minutes within the hour, then today, tomorrow, or the day', () => {
    assert.equal(endsLine(later(60 * MINUTE - 1), NOW), 'Ends in 60 min');
    assert.equal(endsLine(later(12 * MINUTE + 1), NOW), 'Ends in 13 min');
    assert.equal(endsLine(later(5 * 1000), NOW), 'Ends in 1 min');
    assert.equal(endsLine(at(2026, 10, 19, 20), NOW), 'Ends today');
    assert.equal(endsLine(at(2026, 10, 20, 9), NOW), 'Ends tomorrow');
    assert.equal(endsLine(at(2026, 11, 19), NOW), 'Ends 19 Dec');
    assert.equal(endsLine(at(2027, 0, 3), NOW), 'Ends 3 Jan 2027');
  });
});

function connection(
  id: string,
  app: Connection['app'],
  connectedAt: string,
  endsAt = later(30 * 24 * HOUR),
): Connection {
  return {
    id,
    app,
    resources: [{ id: 'r', name: 'Boxel workspaces', labels: ['Read'] }],
    connectedAt,
    lastUsedAt: null,
    endsAt,
    renewing: true,
  };
}

const CLAUDE = {
  kind: 'metadata-document',
  shown: 'claude.ai',
  verified: true,
} as const;
const AGENT = {
  kind: 'dynamic',
  shown: 'an app on this computer',
  verified: false,
  claimedName: 'My agent',
} as const;
const OTHER_AGENT = { ...AGENT, claimedName: 'Other agent' };

describe('grouping connections by app', () => {
  test("puts an app's connections together, newest app and newest connection first", () => {
    let groups = groupByApp([
      connection('claude-old', CLAUDE, at(2026, 9, 25)),
      connection('agent', AGENT, at(2026, 10, 2)),
      connection('claude-new', CLAUDE, at(2026, 9, 30)),
      connection('other', OTHER_AGENT, at(2026, 9, 1)),
    ]);
    assert.deepEqual(
      groups.map((g) => [
        g.app.claimedName ?? g.app.shown,
        g.connections.map((c) => c.id),
      ]),
      [
        ['My agent', ['agent']],
        ['claude.ai', ['claude-new', 'claude-old']],
        ['Other agent', ['other']],
      ],
    );
  });

  test('a connection whose end has passed has ended', () => {
    assert.equal(
      hasEnded(connection('a', CLAUDE, ago(HOUR), ago(1)), NOW),
      true,
    );
    assert.equal(
      hasEnded(connection('a', CLAUDE, ago(HOUR), later(1)), NOW),
      false,
    );
  });
});
