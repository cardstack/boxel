import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type Koa from 'koa';

import type { PgAdapter } from '@cardstack/postgres';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  hasWarning,
  SEARCH_TOTAL_CAP,
} from '@cardstack/runtime-common/query-v2/search-bounds';
import {
  runLogQuery,
  type LogQuery,
} from '@cardstack/runtime-common/log-query';
import { syncLogFile } from '@cardstack/runtime-common/log-line-index';

import { respondToLogSearch } from '../handlers/log-search.ts';
import { logAnswer, memoryLogHost } from './helpers/case-table-log.ts';
import { setupDB } from './helpers/index.ts';

// Correctness cases for a search over a log's lines (`from: { log }`, see
// docs/search.md, "Searching a log"). Every expectation is worked out here,
// in plain JavaScript over the fixture's lines, and never read back from the
// engine.
//
// The rules the oracle applies, and where each comes from:
//
// - A line is `{ line, at, actor, entry }`; a `what` written as a JSON string
//   is decoded (docs).
// - A value that is absent and a value that is JSON `null` are both "no
//   value" (hand-reasoned: a row shows both as null, so a filter, a group key
//   and a count cannot tell them apart either).
// - Missing values follow the SQL rule, as in a card query: a comparison
//   with no value (`eq`, `in`, `range`, `contains`, on an entry path or a
//   column) is neither true nor false, and `not`, `every` and `any` carry
//   that through. So a line with no value at a path is dropped by the filter
//   and by its `not` alike; `eq: { path: null }` finds it.
// - Sort: ties keep file order (docs). A line with no value for the key
//   sorts last in both directions (pins current behavior; rule not yet
//   decided).
// - Paging: `total` modes per docs/search.md, "Pagination".

const realmURL = 'http://log-cases-test/realm/';
const ENGAGEMENT = 'Feed/engagement.jsonl';
const IMPRESSIONS = 'Feed/impressions.jsonl';
const EMPTY = 'Feed/empty.jsonl';
const AUDIT = 'Feed/audit.log';
const BIG = 'Feed/big.jsonl';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// How long before the fixture's clock each line was written. Every relative
// bound a test uses (1h, 90m, 1d, 1w, 30d, 1y) has at least 15 minutes
// between it and the nearest newer line, and the nearest older line can only
// move further away as the suite runs, so the clock ticking between seeding
// and a query changes no answer. 27d/33d and 360d/370d also sit clear of a
// calendar month or year, whichever way `M` and `y` are read.
const AGES = [
  10 * MIN,
  20 * MIN,
  30 * MIN,
  45 * MIN,
  70 * MIN,
  2 * HOUR,
  5 * HOUR,
  12 * HOUR,
  20 * HOUR,
  28 * HOUR,
  2 * DAY,
  4 * DAY,
  6 * DAY,
  8 * DAY,
  14 * DAY,
  27 * DAY,
  33 * DAY,
  60 * DAY,
  360 * DAY,
  370 * DAY,
];

const ACTORS = ['@ada:test', '@bo:test', '@cy:test', '@dee:test'];
const ACTIONS = ['like', 'save', 'skip', 'hide', 'share'];
const TOPICS = ['art', 'birds', 'cooking'];
const SYSTEMS = ['ios', 'android', 'web'];
const SURFACES = ['home', 'search', 'profile'];
const UNICODE_NOTE = 'Zoë ☕ 日本語 — naïve';

type Row = Record<string, any>;

// One line of a log as the oracle sees it.
interface Line {
  line: number;
  at: string | null;
  actor: string | null;
  entry: Row;
}

interface Fixture {
  content: string;
  lines: Line[];
}

const iso = (ms: number) => new Date(ms).toISOString();
// `yyyy-mm-dd hh:mm:ss`, the form `record` writes, in UTC.
const plainTime = (ms: number) => iso(ms).slice(0, 19).replace('T', ' ');

class LogBuilder {
  raw: string[] = [];
  lines: Line[] = [];

  // A JSON line: `written` is what the file holds, `entry` what the docs say
  // the line reads as.
  json(written: Row, at: number | null, actor: string | null, entry?: Row) {
    this.raw.push(JSON.stringify(written));
    this.lines.push({
      line: this.raw.length,
      at: at === null ? null : iso(at),
      actor,
      entry: entry ?? written,
    });
  }

  text(raw: string, at: number | null, actor: string | null, entry: Row) {
    this.raw.push(raw);
    this.lines.push({
      line: this.raw.length,
      at: at === null ? null : iso(at),
      actor,
      entry,
    });
  }

  done(): Fixture {
    return {
      content: this.raw.map((l) => `${l}\n`).join(''),
      lines: this.lines,
    };
  }
}

// 46 lines: 30 regular ones, then the edge cases, each named in a comment.
function engagementLog(t0: number): Fixture {
  let log = new LogBuilder();
  for (let i = 0; i < 30; i++) {
    let at = t0 - AGES[i % 20];
    let what: Row = {
      action: ACTIONS[(i * 3) % 5],
      postUri: `p${(i % 7) + 1}`,
      atMs: at,
      score: [-2, 0, 0.5, 3, 10][i % 5],
      meta: {
        device: { os: SYSTEMS[i % 3] },
        tags: i % 2 ? ['a', 'b'] : ['a'],
      },
    };
    if (i % 6 !== 5) {
      what.dwellMs = 100 * ((i * 7) % 11);
    }
    if (i % 9 === 0) {
      what.pinned = true;
    }
    if (i % 4 !== 3) {
      what.topic = TOPICS[i % 3];
    }
    let written = {
      at: i % 3 === 0 ? plainTime(at) : iso(at),
      actor: ACTORS[i % 4],
      // Every other line carries `what` the way `record` writes it.
      what: i % 2 === 0 ? JSON.stringify(what) : what,
    };
    log.json(written, at, ACTORS[i % 4], { ...written, what });
  }

  // 31: no actor at all, and a topic that is JSON null.
  let at31 = t0 - 30 * MIN;
  log.json(
    {
      at: iso(at31),
      what: {
        action: 'like',
        postUri: 'p1',
        atMs: at31,
        dwellMs: 250,
        score: 1,
        topic: null,
        meta: { device: { os: 'web' }, tags: [] },
      },
    },
    at31,
    null,
  );
  // 32: a null actor, a null topic, and a `meta` that is only its device.
  let at32 = t0 - 5 * HOUR;
  log.json(
    {
      at: iso(at32),
      actor: null,
      what: {
        action: 'save',
        postUri: 'p2',
        atMs: at32,
        score: 4,
        topic: null,
        meta: { device: { os: 'web' } },
      },
    },
    at32,
    null,
  );
  // 33: no time at all.
  log.json(
    {
      actor: '@ada:test',
      what: {
        action: 'like',
        postUri: 'p3',
        dwellMs: 50,
        score: 2,
        topic: 'art',
      },
    },
    null,
    '@ada:test',
  );
  // 34: a null time.
  log.json(
    {
      at: null,
      actor: '@bo:test',
      what: { action: 'hide', postUri: 'p3', score: 7 },
    },
    null,
    '@bo:test',
  );
  // 35: a time that is not one.
  log.json(
    {
      at: 'not a time',
      actor: '@cy:test',
      what: { action: 'skip', postUri: 'p4', dwellMs: 0, score: -1 },
    },
    null,
    '@cy:test',
  );
  // 36: a `what` that is plain words, not JSON: it stays the string it was.
  let at36 = t0 - 2 * HOUR;
  log.json(
    { at: iso(at36), actor: '@dee:test', what: 'just some words' },
    at36,
    '@dee:test',
  );
  // 37: no `what`.
  let at37 = t0 - 12 * HOUR;
  log.json(
    { at: iso(at37), actor: '@ada:test', remark: 'nothing happened' },
    at37,
    '@ada:test',
  );
  // 38: unicode in values, inside a `what` written as a JSON string.
  let at38 = t0 - 20 * MIN;
  let what38 = {
    action: 'share',
    postUri: 'p5',
    atMs: at38,
    dwellMs: 1200,
    score: 0.25,
    topic: 'café',
    note: UNICODE_NOTE,
    size: 'large',
    meta: { device: { os: 'ios' }, tags: ['ünï', 'a'] },
  };
  log.json(
    { at: iso(at38), actor: '@cy:test', what: JSON.stringify(what38) },
    at38,
    '@cy:test',
    { at: iso(at38), actor: '@cy:test', what: what38 },
  );
  // 39, 40, 41: the same line three times.
  let at39 = t0 - 4 * DAY;
  for (let n = 0; n < 3; n++) {
    log.json(
      {
        at: iso(at39),
        actor: '@bo:test',
        what: {
          action: 'like',
          postUri: 'p6',
          atMs: at39,
          dwellMs: 300,
          score: 3,
          topic: 'birds',
          meta: { device: { os: 'android' }, tags: ['a'] },
        },
      },
      at39,
      '@bo:test',
    );
  }
  // 42: written two hours ahead of the clock.
  let at42 = t0 + 2 * HOUR;
  log.json(
    {
      at: iso(at42),
      actor: '@cy:test',
      what: {
        action: 'save',
        postUri: 'p7',
        atMs: at42,
        dwellMs: 700,
        score: 5,
        topic: 'art',
      },
    },
    at42,
    '@cy:test',
  );
  // 43: not JSON. Read as its text, with no time and no actor
  // (log-line-index.ts; the docs do not say).
  log.text('this line is not json', null, null, {
    text: 'this line is not json',
  });
  // 44: a numeric `size`, and the characters a LIKE pattern treats specially.
  let at44 = t0 - 8 * DAY;
  log.json(
    {
      at: iso(at44),
      actor: '@dee:test',
      what: {
        action: 'share',
        postUri: 'p1',
        atMs: at44,
        dwellMs: 900,
        score: 1.5,
        size: 12,
        note: '100% a_b \\ done',
      },
    },
    at44,
    '@dee:test',
  );
  // 45: another numeric `size`, and a note `a_b` must not match as a pattern.
  let at45 = t0 - 14 * DAY;
  log.json(
    {
      at: iso(at45),
      actor: '@ada:test',
      what: {
        action: 'skip',
        postUri: 'p2',
        atMs: at45,
        dwellMs: 400,
        score: 6,
        size: 40,
        note: 'axb 100 percent DONE',
      },
    },
    at45,
    '@ada:test',
  );
  // 46: a `size` that is the text "12", not the number.
  let at46 = t0 - 60 * DAY;
  log.json(
    {
      at: iso(at46),
      actor: '@bo:test',
      what: { action: 'hide', postUri: 'p4', atMs: at46, score: 2, size: '12' },
    },
    at46,
    '@bo:test',
  );
  return log.done();
}

// 48 lines, every `what` a JSON string, times out of file order.
function impressionsLog(t0: number): Fixture {
  let log = new LogBuilder();
  for (let i = 0; i < 48; i++) {
    let at = t0 - AGES[(i * 3) % 20];
    let what: Row = {
      action: 'impression',
      postUri: `p${(i % 8) + 1}`,
      atMs: at,
      surface: SURFACES[i % 3],
    };
    if (i % 10 !== 9) {
      what.position = (i * 5) % 12;
    }
    let written = {
      at: iso(at),
      actor: ACTORS[i % 4],
      what: JSON.stringify(what),
    };
    log.json(written, at, ACTORS[i % 4], { ...written, what });
  }
  return log.done();
}

// A `.log` file: `yyyy-mm-dd hh:mm:ss <actor> <text>` per line (docs).
function auditLog(t0: number): Fixture {
  let log = new LogBuilder();
  let add = (age: number, actor: string, text: string) =>
    log.text(`${plainTime(t0 - age)} ${actor} ${text}`, t0 - age, actor, {
      text,
    });
  add(2 * DAY, '@ada:test', 'opened the feed');
  add(5 * HOUR, '@bo:test', 'muted a topic');
  log.text('a line with no time or actor', null, null, {
    text: 'a line with no time or actor',
  });
  add(30 * MIN, '@ada:test', 'closed the Feed');
  return log.done();
}

// More lines than one page may hold.
function bigLog(t0: number): Fixture {
  let log = new LogBuilder();
  for (let i = 1; i <= 1003; i++) {
    log.json(
      {
        at: iso(t0 - DAY),
        actor: '@ada:test',
        what: { key: `k${String(i).padStart(4, '0')}`, n: i },
      },
      t0 - DAY,
      '@ada:test',
    );
  }
  return log.done();
}

// ---------------------------------------------------------------------------
// The oracle.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// A path's value on a line; `undefined` when there is none.
function valueAt(line: Line, path: string): unknown {
  if (path === 'at') {
    return line.at ?? undefined;
  }
  if (path === 'actor') {
    return line.actor ?? undefined;
  }
  if (path === 'line') {
    return line.line;
  }
  let current: unknown = line.entry;
  for (let segment of path.split('.')) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current === null ? undefined : current;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => same(item, b[i]))
    );
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) {
      return false;
    }
    let keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && same(a[key], b[key]))
    );
  }
  return a === b;
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: MIN,
  h: HOUR,
  d: DAY,
  w: 7 * DAY,
};

// A time bound in milliseconds, relative ones against the fixture's clock,
// by the card grammar's rule (docs/search.md, "Relative dates"): moved by
// whole units, months and years by the calendar, then rounded down in UTC to
// the start of a unit, a week starting on Monday. A time with no zone is UTC.
function timeOf(bound: unknown, t0: number): number {
  if (typeof bound === 'number') {
    return bound;
  }
  let text = String(bound);
  let relative = /^now(?:([+-])(\d+)([smhdwMy]))?(?:\/([smhdwMy]))?$/.exec(
    text,
  );
  if (relative) {
    let [, sign, amount, unit, round] = relative;
    let d = new Date(t0);
    if (sign) {
      let n = Number(amount) * (sign === '-' ? -1 : 1);
      if (unit === 'M') d.setUTCMonth(d.getUTCMonth() + n);
      else if (unit === 'y') d.setUTCFullYear(d.getUTCFullYear() + n);
      else d = new Date(t0 + n * UNIT_MS[unit]);
    }
    if (round) {
      let [y, mo, day, h, mi, sec] = [
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
      ];
      if (round === 's') return Date.UTC(y, mo, day, h, mi, sec);
      if (round === 'm') return Date.UTC(y, mo, day, h, mi);
      if (round === 'h') return Date.UTC(y, mo, day, h);
      if (round === 'd') return Date.UTC(y, mo, day);
      if (round === 'w') {
        let sinceMonday = (d.getUTCDay() + 6) % 7;
        return Date.UTC(y, mo, day - sinceMonday);
      }
      if (round === 'M') return Date.UTC(y, mo, 1);
      return Date.UTC(y, 0, 1);
    }
    return d.getTime();
  }
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}Z`);
  }
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(text)) {
    return Date.parse(`${text}Z`);
  }
  return Date.parse(text);
}

type Tri = boolean | null;

function compare(a: number | string, op: string, b: number | string): boolean {
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    default:
      throw new Error(`oracle: unknown bound ${op}`);
  }
}

function every(parts: Tri[]): Tri {
  if (parts.includes(false)) {
    return false;
  }
  return parts.includes(null) ? null : true;
}

function any(parts: Tri[]): Tri {
  if (parts.includes(true)) {
    return true;
  }
  return parts.includes(null) ? null : false;
}

function eqOne(line: Line, path: string, wanted: unknown, t0: number): Tri {
  let value = valueAt(line, path);
  if (path === 'line') {
    return value === wanted;
  }
  if (wanted === null) {
    return value === undefined;
  }
  if (path === 'at') {
    return value === undefined
      ? null
      : Date.parse(value as string) === timeOf(wanted, t0);
  }
  if (path === 'actor') {
    return value === undefined ? null : value === wanted;
  }
  // An entry path: unknown with no value, and strict about type. As on a
  // card's list field, a list matches a scalar or an object when some item
  // equals it; a list value is compared whole (docs/search.md).
  if (value === undefined) return null;
  if (Array.isArray(value) && !Array.isArray(wanted)) {
    return value.some((item) => same(item, wanted));
  }
  return same(value, wanted);
}

// true, false, or null for "unknown" (see the rules at the top).
function evaluate(filter: Row, line: Line, t0: number): Tri {
  if ('every' in filter) {
    return every(filter.every.map((f: Row) => evaluate(f, line, t0)));
  }
  if ('any' in filter) {
    return any(filter.any.map((f: Row) => evaluate(f, line, t0)));
  }
  if ('not' in filter) {
    let inner = evaluate(filter.not, line, t0);
    return inner === null ? null : !inner;
  }
  if ('exists' in filter) {
    return valueAt(line, filter.exists) !== undefined;
  }
  if ('eq' in filter) {
    return every(
      Object.entries(filter.eq).map(([path, wanted]) =>
        eqOne(line, path, wanted, t0),
      ),
    );
  }
  if ('in' in filter) {
    return every(
      Object.entries(filter.in).map(([path, wanted]) =>
        any((wanted as unknown[]).map((w) => eqOne(line, path, w, t0))),
      ),
    );
  }
  if ('contains' in filter) {
    return every(
      Object.entries(filter.contains).map(([path, needle]) => {
        let value = valueAt(line, path);
        if (typeof value !== 'string') {
          return null;
        }
        return value.toLowerCase().includes(String(needle).toLowerCase());
      }),
    );
  }
  if ('range' in filter) {
    return every(
      Object.entries(filter.range).flatMap(([path, bounds]) =>
        Object.entries(bounds as Row).map(([op, bound]): Tri => {
          let value = valueAt(line, path);
          if (path === 'at') {
            return value === undefined
              ? null
              : compare(Date.parse(value as string), op, timeOf(bound, t0));
          }
          if (typeof bound === 'number') {
            // A number bound compares numbers only.
            return typeof value === 'number' ? compare(value, op, bound) : null;
          }
          return typeof value === 'string'
            ? compare(value, op, String(bound))
            : null;
        }),
      ),
    );
  }
  throw new Error(`oracle: unknown filter ${JSON.stringify(filter)}`);
}

function keep(lines: Line[], filter: Row | undefined, t0: number): Line[] {
  return filter
    ? lines.filter((line) => evaluate(filter, line, t0) === true)
    : lines;
}

// Numbers by size, times by instant, text by code unit (every text key a
// test sorts by is lowercase ASCII, so no collation orders it otherwise).
function compareValues(a: unknown, b: unknown, path: string): number {
  if (path === 'at') {
    return Date.parse(a as string) - Date.parse(b as string);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  let [x, y] = [String(a), String(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

type Sort = { by: string; direction?: 'asc' | 'desc' }[];

function sorted(lines: Line[], sort: Sort = []): Line[] {
  return [...lines].sort((a, b) => {
    for (let { by, direction } of sort) {
      let [x, y] = [valueAt(a, by), valueAt(b, by)];
      if (x === undefined || y === undefined) {
        if (x === y) {
          continue;
        }
        // No value sorts last, whichever way the key runs.
        return x === undefined ? 1 : -1;
      }
      let order = compareValues(x, y, by);
      if (order !== 0) {
        return direction === 'desc' ? -order : order;
      }
    }
    // Ties keep file order.
    return a.line - b.line;
  });
}

const lineNumbers = (rows: { line?: unknown }[]) => rows.map((r) => r.line);

function fullRow(line: Line): Row {
  return {
    line: line.line,
    at: line.at,
    actor: line.actor,
    entry: line.entry,
  };
}

function numbersAt(lines: Line[], path: string): number[] {
  return lines
    .map((l) => valueAt(l, path))
    .filter((v): v is number => typeof v === 'number');
}

function extreme(lines: Line[], path: string, pick: 'min' | 'max'): unknown {
  let values = lines
    .map((l) => valueAt(l, path))
    .filter((v) => v !== undefined);
  if (values.length === 0) {
    return null;
  }
  let ordered = [...values].sort((a, b) => compareValues(a, b, path));
  return pick === 'min' ? ordered[0] : ordered[ordered.length - 1];
}

function aggregate(lines: Line[], spec: Row): unknown {
  let [[op, path]] = Object.entries(spec) as [string, any][];
  switch (op) {
    case 'count':
      return path === true
        ? lines.length
        : lines.filter((l) => valueAt(l, path) !== undefined).length;
    case 'min':
    case 'max':
      return extreme(lines, path, op);
    case 'sum': {
      let numbers = numbersAt(lines, path);
      return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
    }
    case 'avg': {
      let numbers = numbersAt(lines, path);
      return numbers.length
        ? numbers.reduce((a, b) => a + b, 0) / numbers.length
        : null;
    }
    case 'distinct': {
      let seen = new Map<string, unknown>();
      for (let l of lines) {
        let value = valueAt(l, path);
        if (value !== undefined) {
          seen.set(JSON.stringify(value), value);
        }
      }
      return [...seen.values()];
    }
    case 'latest': {
      // The newest line: the latest time, and of two lines written at the
      // same instant the one further down the file. A line with no time is
      // older than any line with one.
      let newest = [...lines].sort((a, b) => {
        if (a.at === null || b.at === null) {
          if (a.at !== b.at) {
            return a.at === null ? 1 : -1;
          }
        } else if (a.at !== b.at) {
          return Date.parse(b.at) - Date.parse(a.at);
        }
        return b.line - a.line;
      })[0];
      return valueAt(newest, path) ?? null;
    }
    default:
      throw new Error(`oracle: unknown aggregate ${op}`);
  }
}

// One row per distinct value of the group paths, in no particular order. A
// line with no value for a path groups under null.
function grouped(
  lines: Line[],
  by: string[],
  aggregates: Record<string, Row> = {},
): Row[] {
  let groups = new Map<string, { key: Row; lines: Line[] }>();
  for (let line of lines) {
    let key: Row = {};
    for (let path of by) {
      key[path] = valueAt(line, path) ?? null;
    }
    let id = JSON.stringify(by.map((path) => key[path]));
    if (!groups.has(id)) {
      groups.set(id, { key, lines: [] });
    }
    groups.get(id)!.lines.push(line);
  }
  return [...groups.values()].map(({ key, lines: members }) => {
    let row: Row = { group: key };
    for (let [name, spec] of Object.entries(aggregates)) {
      row[name] = aggregate(members, spec);
    }
    return row;
  });
}

// Rows made comparable: a list in no promised order is sorted, and a
// fraction is rounded where the database and JavaScript keep different
// numbers of digits.
function normal(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Number(value.toFixed(9));
  }
  if (Array.isArray(value)) {
    return value
      .map(normal)
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normal(v)]),
    );
  }
  return value;
}

// Rows as a set: each normalized, the whole in one canonical order.
function asSet(rows: Row[]): string[] {
  return rows
    .map((row) => {
      let n = normal(row) as Row;
      return JSON.stringify(
        Object.keys(n)
          .sort()
          .map((k) => [k, n[k]]),
      );
    })
    .sort();
}

function facetCounts(lines: Line[], value: (line: Line) => unknown) {
  let counts = new Map<string, { value: unknown; count: number }>();
  for (let line of lines) {
    let v = value(line);
    if (v === undefined) {
      continue;
    }
    let id = JSON.stringify(v);
    if (!counts.has(id)) {
      counts.set(id, { value: v, count: 0 });
    }
    counts.get(id)!.count++;
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

// Where a case shows only a rule the card engine owns (B1: one validator,
// one ORDER BY, one total rule, one projection, one facet path), one row here
// shows that a log reaches it; the card tests named beside a dropped row hold
// the rule itself.

module(basename(import.meta.filename), function () {
  module('log query cases (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let t0: number;
    let engagement: Fixture;
    let impressions: Fixture;
    let audit: Fixture;
    let big: Fixture;

    setupDB(hooks, {
      before: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        // Whole seconds, so `yyyy-mm-dd hh:mm:ss` loses nothing.
        t0 = Math.floor(Date.now() / 1000) * 1000;
        engagement = engagementLog(t0);
        impressions = impressionsLog(t0);
        audit = auditLog(t0);
        big = bigLog(t0);
        let files = new Map<string, string>([
          [`${realmURL}${ENGAGEMENT}`, engagement.content],
          [`${realmURL}${IMPRESSIONS}`, impressions.content],
          [`${realmURL}${AUDIT}`, audit.content],
          [`${realmURL}${BIG}`, big.content],
          [`${realmURL}${EMPTY}`, ''],
        ]);
        let host = memoryLogHost(dbAdapter, realmURL, files);
        for (let url of files.keys()) {
          await syncLogFile(host, url);
        }
      },
    });

    function search(log: string, rest: Row = {}) {
      return runLogQuery(dbAdapter, realmURL, {
        from: { log },
        ...rest,
      } as LogQuery);
    }

    // Everything a filter keeps, in file order.
    async function matching(log: string, filter: Row): Promise<unknown[]> {
      let result = await search(log, {
        filter,
        page: { size: 1000, total: 'exact' },
      });
      return lineNumbers(result.data);
    }

    const fixtureOf = (log: string) =>
      log === ENGAGEMENT
        ? engagement
        : log === IMPRESSIONS
          ? impressions
          : audit;

    // -----------------------------------------------------------------------
    // What a line reads as
    // -----------------------------------------------------------------------

    test('every line comes back as { line, at, actor, entry }, a JSON-string `what` decoded, unicode intact, duplicates kept', async function (assert) {
      let result = await search(ENGAGEMENT, { page: { size: 1000 } });
      assert.strictEqual(engagement.lines.length, 46, 'the fixture');
      assert.deepEqual(result.data, engagement.lines.map(fullRow));
      let unicode = result.data[37].entry as Row;
      assert.strictEqual(typeof unicode.what, 'object', '`what` is decoded');
      assert.strictEqual(unicode.what.note, UNICODE_NOTE);
      assert.deepEqual(
        result.data.slice(38, 41).map((r) => r.entry),
        [
          engagement.lines[38].entry,
          engagement.lines[38].entry,
          engagement.lines[38].entry,
        ],
        'three identical lines are three rows',
      );
      assert.strictEqual(
        (result.data[35].entry as Row).what,
        'just some words',
        'a `what` that is not JSON stays text',
      );
      let whole = await search(IMPRESSIONS, { page: { size: 1000 } });
      assert.deepEqual(
        whole.data,
        impressions.lines.map(fullRow),
        'a log written entirely through JSON-string `what` reads back whole',
      );
    });

    test('a .log line is { text } with its time and actor read from the line', async function (assert) {
      let result = await search(AUDIT);
      assert.deepEqual(result.data, audit.lines.map(fullRow));
      assert.deepEqual(
        await matching(AUDIT, { eq: { actor: '@ada:test' } }),
        [1, 4],
        'by actor',
      );
      assert.deepEqual(
        await matching(AUDIT, { contains: { text: 'FEED' } }),
        [1, 4],
        'contains, ignoring case',
      );
      assert.deepEqual(
        await matching(AUDIT, { range: { at: { gte: 'now-1d' } } }),
        [2, 4],
        'the last day; the line with no time is not in it',
      );
    });

    test('one log never answers with the lines of another', async function (assert) {
      assert.deepEqual(
        await matching(ENGAGEMENT, { eq: { 'what.action': 'impression' } }),
        [],
      );
      assert.strictEqual(
        (await matching(IMPRESSIONS, { eq: { 'what.action': 'impression' } }))
          .length,
        48,
      );
      assert.deepEqual(
        await matching(IMPRESSIONS, { eq: { 'what.action': 'like' } }),
        [],
      );
    });

    // -----------------------------------------------------------------------
    // Filters: each row against the oracle
    // -----------------------------------------------------------------------

    // Each row: the rule, the filter (or one built from the clock), and the
    // hand checks: `lines` the whole count, `with` lines the oracle must
    // keep, `without` lines it must drop. Missing values follow the SQL rule,
    // as in a card query: a line with no value at a path is dropped by the
    // filter and by its `not` alike; `eq: null` finds it.
    const NO_ACTION = [36, 37, 43];
    const NO_ACTOR = [31, 32, 43];
    const NO_TIME = [33, 34, 35, 43];
    const NO_DWELL = [6, 12, 18, 24, 30, 32, 34, 36, 37, 43, 46];
    const AT_4D = (t0: number) => iso(t0 - 4 * DAY);
    const notLike = { not: { eq: { 'what.action': 'like' } } };
    type Check = {
      lines?: number[];
      with?: number[];
      without?: number[];
      log?: string;
    };
    const filterCases: [string, Row | ((t0: number) => Row), Check?][] = [
      ['eq on an entry path', { eq: { 'what.action': 'save' } }],
      ['eq on a deeper path', { eq: { 'what.meta.device.os': 'web' } }],
      // The generated line 6 (i = 5: like, p6) and the three duplicates.
      [
        'eq on two paths keeps the lines matching both',
        { eq: { 'what.action': 'like', 'what.postUri': 'p6' } },
        { lines: [6, 39, 40, 41] },
      ],
      // Line 46 holds the text "12".
      [
        'eq on a number is strict about type',
        { eq: { 'what.size': 12 } },
        { lines: [44] },
      ],
      [
        'eq on text like a number is strict too',
        { eq: { 'what.size': '12' } },
        { lines: [46] },
      ],
      [
        'eq on a boolean',
        { eq: { 'what.pinned': true } },
        { lines: [1, 10, 19, 28] },
      ],
      ['eq on zero does not match no value', { eq: { 'what.dwellMs': 0 } }],
      [
        'eq on a unicode value',
        { eq: { 'what.topic': 'café' } },
        { lines: [38] },
      ],
      ['eq with a list value is equality', { eq: { 'what.meta.tags': ['a'] } }],
      // Only line 32's `meta` is exactly its device.
      [
        'eq with an object value is equality, not "holds these members"',
        { eq: { 'what.meta': { device: { os: 'web' } } } },
        { lines: [32] },
      ],
      ['eq on actor', { eq: { actor: '@cy:test' } }],
      ['eq null on actor', { eq: { actor: null } }, { lines: NO_ACTOR }],
      ['eq on line', { eq: { line: 17 } }, { lines: [17] }],
      // The generated line with age 4d and the three duplicates.
      [
        'eq on at keeps every line written at that instant',
        (t0) => ({ eq: { at: AT_4D(t0) } }),
        { lines: [12, 39, 40, 41] },
      ],
      [
        'eq null on a path',
        { eq: { 'what.dwellMs': null } },
        { lines: NO_DWELL },
      ],
      // Lines 31 and 32 hold `topic: null`.
      [
        'eq null keeps a JSON null',
        { eq: { 'what.topic': null } },
        { with: [31, 32] },
      ],
      // `what` is absent or not an object.
      [
        'eq null under a `what` that is no object',
        { eq: { 'what.action': null } },
        { lines: NO_ACTION },
      ],
      [
        'in keeps a line matching any value',
        { in: { 'what.action': ['save', 'hide'] } },
      ],
      ['exists keeps the lines with a value', { exists: 'what.dwellMs' }],
      [
        'exists does not keep a JSON null',
        { exists: 'what.topic' },
        { without: [31, 32] },
      ],
      [
        'exists and eq null split the log',
        { exists: 'what.action' },
        { without: NO_ACTION },
      ],
      [
        'exists on at: no readable time',
        { not: { exists: 'at' } },
        { lines: NO_TIME },
      ],
      [
        'range on an entry number',
        { range: { 'what.dwellMs': { gte: 300, lt: 900 } } },
      ],
      // Line 46 holds the text "12".
      [
        'a number range skips text',
        { range: { 'what.size': { gte: 1 } } },
        { lines: [44, 45] },
      ],
      [
        'range on text compares text',
        { range: { 'what.surface': { gte: 'p' } } },
        { log: IMPRESSIONS },
      ],
      [
        'range on line',
        { range: { line: { gt: 40, lte: 44 } } },
        { lines: [41, 42, 43, 44] },
      ],
      [
        'range on at with ISO bounds',
        (t0) => ({
          range: { at: { gte: iso(t0 - 3 * DAY), lt: iso(t0 - 90 * MIN) } },
        }),
      ],
      [
        'range on at takes `yyyy-mm-dd hh:mm:ss` as UTC',
        (t0) => ({ range: { at: { gte: plainTime(t0 - 3 * HOUR) } } }),
      ],
      [
        'range on at takes milliseconds since the epoch',
        (t0) => ({ range: { at: { lt: t0 - 100 * DAY } } }),
      ],
      [
        'a bound on at: gte and lte inclusive, gt and lt exclusive',
        (t0) => ({
          every: [
            { range: { at: { gte: AT_4D(t0) } } },
            { range: { at: { lte: AT_4D(t0) } } },
            { not: { range: { at: { gt: AT_4D(t0) } } } },
            { not: { range: { at: { lt: AT_4D(t0) } } } },
          ],
        }),
        { lines: [12, 39, 40, 41] },
      ],
      [
        'contains ignores case',
        { contains: { 'what.note': 'done' } },
        { lines: [44, 45] },
      ],
      [
        'contains matches unicode',
        { contains: { 'what.note': '日本' } },
        { lines: [38] },
      ],
      [
        'contains reads `_` as itself',
        { contains: { 'what.note': 'a_b' } },
        { lines: [44] },
      ],
      ['contains on actor', { contains: { actor: 'ADA' } }],
      [
        'contains on a text `what`',
        { contains: { what: 'some words' } },
        { lines: [36] },
      ],
      [
        'not inside any inside every',
        {
          every: [
            {
              any: [
                { not: { in: { 'what.action': ['like', 'skip'] } } },
                { eq: { 'what.postUri': 'p3' } },
              ],
            },
            { range: { line: { lte: 40 } } },
          ],
        },
      ],
      ['not eq drops no value', notLike, { without: NO_ACTION }],
      [
        'eq null beside not eq brings them back',
        { any: [{ eq: { 'what.action': null } }, notLike] },
        { with: NO_ACTION },
      ],
      [
        'not in drops no value',
        { not: { in: { 'what.action': ['like', 'save', 'skip'] } } },
        { without: NO_ACTION },
      ],
      // Pins current behavior; rule not yet decided.
      [
        'not eq on actor drops no actor',
        { not: { eq: { actor: '@ada:test' } } },
        { without: NO_ACTOR },
      ],
      [
        'a number range drops no number',
        { range: { 'what.dwellMs': { gte: 500 } } },
        { without: NO_DWELL },
      ],
      // Pins current behavior; rule not yet decided.
      [
        'and so does its not',
        { not: { range: { 'what.dwellMs': { gte: 500 } } } },
        { without: NO_DWELL },
      ],
      // Only line 38 has a note without "done". Pins current behavior; rule
      // not yet decided.
      [
        'not contains drops no value',
        { not: { contains: { 'what.note': 'done' } } },
        { lines: [38] },
      ],
      [
        'not of a time range drops no time',
        { not: { range: { at: { gte: 'now-1d' } } } },
        { without: NO_TIME },
      ],
    ];

    test('filter: each row keeps exactly the lines the oracle keeps', async function (assert) {
      for (let [rule, filter, check = {}] of filterCases) {
        let log = check.log ?? ENGAGEMENT;
        let resolved = typeof filter === 'function' ? filter(t0) : filter;
        let expected = keep(fixtureOf(log).lines, resolved, t0).map(
          (l) => l.line,
        );
        if (check.lines) {
          assert.deepEqual(expected, check.lines, `${rule}: the hand count`);
        }
        for (let line of check.without ?? []) {
          assert.false(expected.includes(line), `${rule}: drops ${line}`);
        }
        for (let line of check.with ?? []) {
          assert.true(expected.includes(line), `${rule}: keeps ${line}`);
        }
        assert.true(expected.length > 0, `${rule}: keeps some line`);
        assert.deepEqual(await matching(log, resolved), expected, rule);
      }
    });

    // -----------------------------------------------------------------------
    // Relative times on `at` (the card grammar's resolution, held in
    // log-query-parity's "relative times are the card grammar's")
    // -----------------------------------------------------------------------

    const relativeCases: [rule: string, range: Row, log?: string][] = [
      ['the last hour', { gte: 'now-1h' }],
      ['the last day', { gte: 'now-1d' }],
      ['the last week', { gte: 'now-1w' }],
      ['the last month', { gte: 'now-1M' }],
      ['the last year', { gte: 'now-1y' }],
      ['older than a day', { lt: 'now-1d' }],
      ['older than a year', { lte: 'now-1y' }],
      ['up to now leaves out a line from the future', { lte: 'now' }],
      ['after now is only the line from the future', { gt: 'now' }],
      ['between a week ago and a day ago', { gte: 'now-1w', lt: 'now-1d' }],
      [
        'between a month ago and an hour ago in the impressions log',
        { gt: 'now-1M', lte: 'now-1h' },
        IMPRESSIONS,
      ],
    ];

    test('relative time: each bound keeps the lines the oracle keeps', async function (assert) {
      // By hand: ages 10m, 20m, 30m and 45m, plus the line from the future.
      assert.deepEqual(
        engagement.lines
          .filter((l) => l.at !== null && Date.parse(l.at) > t0 - 50 * MIN)
          .map((l) => l.line),
        [1, 2, 3, 4, 21, 22, 23, 24, 31, 38, 42],
        'the lines under an hour old',
      );
      for (let [rule, range, log = ENGAGEMENT] of relativeCases) {
        let all = fixtureOf(log).lines;
        let filter = { range: { at: range } };
        let expected = keep(all, filter, t0).map((l) => l.line);
        assert.true(expected.length > 0, `${rule}: some line is inside`);
        assert.true(expected.length < all.length, `${rule}: some is outside`);
        assert.deepEqual(await matching(log, filter), expected, rule);
      }
    });

    // -----------------------------------------------------------------------
    // Sort: a line's columns and entry paths through the one ORDER BY
    // -----------------------------------------------------------------------

    const sortCases: {
      rule: string;
      log?: string;
      sort: Sort;
      filter?: Row | ((t0: number) => Row);
    }[] = [
      { rule: 'no sort is file order', sort: [] },
      { rule: 'by at, oldest first', log: IMPRESSIONS, sort: [{ by: 'at' }] },
      {
        rule: 'by at, newest first, ties in file order',
        log: IMPRESSIONS,
        sort: [{ by: 'at', direction: 'desc' }],
      },
      {
        rule: 'by at with lines that have no time: they come last',
        sort: [{ by: 'at' }],
      },
      {
        rule: 'by at descending with lines that have no time: they still come last',
        sort: [{ by: 'at', direction: 'desc' }],
      },
      {
        rule: 'duplicates and same-instant lines keep file order under a descending sort',
        filter: (t0) => ({ eq: { at: iso(t0 - 4 * DAY) } }),
        sort: [{ by: 'at', direction: 'desc' }],
      },
      { rule: 'by line descending', sort: [{ by: 'line', direction: 'desc' }] },
      {
        rule: 'by a number in the entry, numerically',
        log: IMPRESSIONS,
        sort: [{ by: 'what.position' }],
      },
      {
        rule: 'by a number in the entry descending, lines without it last',
        log: IMPRESSIONS,
        sort: [{ by: 'what.position', direction: 'desc' }],
      },
      {
        rule: 'by text in the entry',
        log: IMPRESSIONS,
        sort: [{ by: 'what.surface' }],
      },
      { rule: 'by a deeper path', sort: [{ by: 'what.meta.device.os' }] },
      { rule: 'by actor, lines without one last', sort: [{ by: 'actor' }] },
    ];

    test('sort: each row orders the lines as the oracle does', async function (assert) {
      for (let { rule, log = ENGAGEMENT, sort, filter } of sortCases) {
        let resolved = typeof filter === 'function' ? filter(t0) : filter;
        let expected = sorted(keep(fixtureOf(log).lines, resolved, t0), sort);
        let result = await search(log, {
          ...(resolved ? { filter: resolved } : {}),
          sort,
          page: { size: 1000 },
        });
        assert.deepEqual(
          lineNumbers(result.data),
          expected.map((l) => l.line),
          rule,
        );
      }
    });

    // -----------------------------------------------------------------------
    // Paging (the card total rule; query-bounds-cases holds every mode)
    // -----------------------------------------------------------------------

    const PAGED_SORT: Sort = [
      { by: 'what.surface' },
      { by: 'what.position', direction: 'desc' },
    ];

    test('paging: pages laid end to end are the whole, with no line twice and none left out', async function (assert) {
      let expected = sorted(impressions.lines, PAGED_SORT).map((l) => l.line);
      for (let size of [1, 7, 48, 50]) {
        let seen: unknown[] = [];
        let pages = Math.ceil(expected.length / size);
        for (let number = 0; number < pages; number++) {
          let page = await search(IMPRESSIONS, {
            sort: PAGED_SORT,
            page: { size, number },
          });
          assert.deepEqual(
            lineNumbers(page.data),
            expected.slice(number * size, (number + 1) * size),
            `size ${size}, page ${number}`,
          );
          assert.strictEqual(
            page.meta.page.hasMore,
            number < pages - 1,
            `size ${size}, hasMore on page ${number}`,
          );
          seen.push(...lineNumbers(page.data));
        }
        assert.deepEqual(seen, expected, `size ${size}: the whole`);
      }
    });

    test("paging: following hasMore with total 'none' visits every matching line once, with no empty last request", async function (assert) {
      let filter = { eq: { 'what.surface': 'home' } };
      let sort: Sort = [{ by: 'at', direction: 'desc' }];
      let expected = sorted(keep(impressions.lines, filter, t0), sort).map(
        (l) => l.line,
      );
      assert.strictEqual(expected.length, 16, 'the fixture');
      for (let size of [1, 5, 16, 17]) {
        let seen: unknown[] = [];
        let requests = 0;
        for (let number = 0; ; number++) {
          let page = await search(IMPRESSIONS, {
            filter,
            sort,
            page: { size, number, total: 'none' },
          });
          requests++;
          seen.push(...lineNumbers(page.data));
          assert.strictEqual(
            page.meta.page.total,
            seen.length,
            `size ${size}: total 'none' is the rows seen so far`,
          );
          assert.strictEqual(
            hasWarning(page.meta, 'total-estimated'),
            page.meta.page.hasMore,
            `size ${size}: a lower bound exactly while more follows`,
          );
          if (!page.meta.page.hasMore || requests > 40) {
            break;
          }
        }
        assert.deepEqual(seen, expected, `size ${size}: every line once`);
        assert.strictEqual(
          requests,
          Math.ceil(expected.length / size),
          `size ${size}: hasMore is true exactly when a next page has rows`,
        );
      }
    });

    test('paging: a page past the end and a page of no rows count exactly, whatever the mode', async function (assert) {
      for (let total of ['none', 'capped', 'exact']) {
        let page = await search(IMPRESSIONS, {
          page: { size: 10, number: 99, total },
        });
        assert.deepEqual(
          [page.data, page.meta.page.hasMore, page.meta.page.total],
          [[], false, 48],
          `past the end, total ${total}`,
        );
        assert.false(hasWarning(page.meta, 'total-estimated'));
      }
      let none = await search(IMPRESSIONS, {
        filter: { eq: { 'what.surface': 'home' } },
        page: { size: 0, total: 'exact' },
      });
      assert.deepEqual([none.data, none.meta.page.total], [[], 16], 'size 0');
    });

    test('paging: 50 lines with no page named, at most 1,000 a page, and each total mode over a long log', async function (assert) {
      let first50 = await search(BIG);
      assert.deepEqual(
        lineNumbers(first50.data),
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
      assert.true(first50.meta.page.hasMore);
      assert.strictEqual(
        first50.meta.page.total,
        Math.min(1003, SEARCH_TOTAL_CAP),
        'no page named counts as capped does',
      );
      let first = await search(BIG, { page: { size: 5000 } });
      assert.deepEqual(
        lineNumbers(first.data),
        Array.from({ length: 1000 }, (_, i) => i + 1),
      );
      assert.true(first.meta.page.hasMore);
      let second = await search(BIG, { page: { size: 5000, number: 1 } });
      assert.deepEqual(lineNumbers(second.data), [1001, 1002, 1003]);
      assert.false(second.meta.page.hasMore);
      assert.strictEqual(second.meta.page.total, 1003, 'a last page is exact');
      let capped = await search(BIG, { page: { size: 10, total: 'capped' } });
      assert.strictEqual(
        capped.meta.page.total,
        Math.min(1003, SEARCH_TOTAL_CAP),
      );
      assert.strictEqual(
        hasWarning(capped.meta, 'total-estimated'),
        1003 > SEARCH_TOTAL_CAP,
      );
      let exact = await search(BIG, { page: { size: 10, total: 'exact' } });
      assert.strictEqual(exact.meta.page.total, 1003);
      assert.false(hasWarning(exact.meta, 'total-estimated'));
      let none = await search(BIG, {
        page: { size: 10, number: 2, total: 'none' },
      });
      assert.strictEqual(none.meta.page.total, 30);
      assert.true(hasWarning(none.meta, 'total-estimated'));
    });

    // -----------------------------------------------------------------------
    // select
    // -----------------------------------------------------------------------

    const selected = (lines: Line[], paths: string[]) =>
      lines.map((l) => {
        let row: Row = { line: l.line };
        for (let path of paths) {
          row[path] = valueAt(l, path) ?? null;
        }
        return row;
      });

    test('select: a row is its line number and the named paths, a path with no value null, a whole object or list as it is', async function (assert) {
      let paths = [
        'what.action',
        'what.postUri',
        'what.dwellMs',
        'at',
        'actor',
      ];
      let result = await search(ENGAGEMENT, {
        select: paths,
        page: { size: 1000 },
      });
      assert.deepEqual(result.data, selected(engagement.lines, paths));
      assert.deepEqual(
        Object.keys(result.data[0]).sort(),
        ['line', ...paths].sort(),
        'nothing else',
      );
      let missing = await search(ENGAGEMENT, {
        filter: { in: { line: [30, 31, 36, 37, 43] } },
        select: ['what.topic', 'what.meta.device.os'],
      });
      assert.deepEqual(
        missing.data,
        [
          // 30: i = 29, topic 'cooking', os 'web'.
          { line: 30, 'what.topic': 'cooking', 'what.meta.device.os': 'web' },
          { line: 31, 'what.topic': null, 'what.meta.device.os': 'web' },
          { line: 36, 'what.topic': null, 'what.meta.device.os': null },
          { line: 37, 'what.topic': null, 'what.meta.device.os': null },
          { line: 43, 'what.topic': null, 'what.meta.device.os': null },
        ],
        'absent, JSON null, or under a `what` that is not an object: null',
      );
      let whole = await search(ENGAGEMENT, {
        filter: { eq: { line: 38 } },
        select: ['what.meta', 'what.meta.tags', 'what.note', 'line'],
      });
      assert.deepEqual(whole.data, [
        {
          line: 38,
          'what.meta': { device: { os: 'ios' }, tags: ['ünï', 'a'] },
          'what.meta.tags': ['ünï', 'a'],
          'what.note': UNICODE_NOTE,
        },
      ]);
      // A table of the newest reactions: not eq, a sort, total none.
      let filter = { not: { eq: { 'what.action': 'skip' } } };
      let sort: Sort = [{ by: 'at', direction: 'desc' }];
      let reactions = [
        'what.postUri',
        'what.action',
        'what.atMs',
        'what.topic',
      ];
      let expected = sorted(keep(engagement.lines, filter, t0), sort);
      let table = await search(ENGAGEMENT, {
        filter,
        select: reactions,
        sort,
        page: { size: 500, total: 'none' },
      });
      assert.deepEqual(table.data, selected(expected, reactions));
      assert.false(table.meta.page.hasMore);
      assert.strictEqual(table.meta.page.total, expected.length);
      // Pins current behavior; rule not yet decided.
      let none = await search(AUDIT, { select: [] });
      assert.deepEqual(
        none.data,
        audit.lines.map(fullRow),
        'an empty list selects nothing, so whole lines come back',
      );
    });

    // -----------------------------------------------------------------------
    // group and aggregates
    // -----------------------------------------------------------------------

    const HAS_ACTION = { exists: 'what.action' };

    test('group: one row per action with every aggregate, sorted by the count then the action', async function (assert) {
      let aggregates = {
        n: { count: true },
        withDwell: { count: 'what.dwellMs' },
        dwellSum: { sum: 'what.dwellMs' },
        dwellAvg: { avg: 'what.dwellMs' },
        dwellMin: { min: 'what.dwellMs' },
        dwellMax: { max: 'what.dwellMs' },
        scoreSum: { sum: 'what.score' },
        scoreAvg: { avg: 'what.score' },
        scoreMin: { min: 'what.score' },
        firstAt: { min: 'at' },
        lastAt: { max: 'at' },
        firstPost: { min: 'what.postUri' },
        lastActor: { max: 'actor' },
        actors: { distinct: 'actor' },
        posts: { distinct: 'what.postUri' },
        newestPost: { latest: 'what.postUri' },
        newestLine: { latest: 'line' },
        lastLine: { max: 'line' },
      };
      let expected = grouped(
        keep(engagement.lines, HAS_ACTION, t0),
        ['what.action'],
        aggregates,
      ).sort(
        (a, b) =>
          b.n - a.n ||
          compareValues(
            a.group['what.action'],
            b.group['what.action'],
            'what.action',
          ),
      );
      assert.strictEqual(expected.length, 5, 'five actions');
      let result = await search(ENGAGEMENT, {
        filter: HAS_ACTION,
        group: { by: 'what.action', aggregates },
        sort: [{ by: 'n', direction: 'desc' }, { by: 'what.action' }],
        page: { total: 'exact' },
      });
      assert.deepEqual(result.data.map(normal), expected.map(normal));
      assert.strictEqual(result.meta.page.total, 5, 'the total counts groups');
      assert.false(result.meta.page.hasMore);
    });

    // Each row: a grouped query and the rows it answers, as the oracle works
    // them out (`sort` orders them; with none they compare as a set) or as
    // written by hand.
    const groupCases: {
      rule: string;
      log?: string;
      filter?: Row | ((t0: number) => Row);
      group: Row;
      sort?: Sort;
      order?: (a: Row, b: Row) => number;
      rows?: Row[] | ((t0: number) => Row[]);
      total?: number;
    }[] = [
      {
        rule: 'count per actor over the last week; lines with no actor form one group under null (pins current behavior; rule not yet decided)',
        filter: { range: { at: { gte: 'now-1w' } } },
        group: {
          by: 'actor',
          aggregates: {
            n: { count: true },
            score: { sum: 'what.score' },
            mean: { avg: 'what.score' },
          },
        },
      },
      {
        rule: 'by two paths, sorted by one group path descending then the other',
        filter: { every: [HAS_ACTION, { exists: 'what.postUri' }] },
        group: {
          by: ['what.postUri', 'what.action'],
          aggregates: { n: { count: true } },
        },
        sort: [
          { by: 'what.postUri', direction: 'desc' },
          { by: 'what.action' },
        ],
        order: (a, b) =>
          -compareValues(
            a.group['what.postUri'],
            b.group['what.postUri'],
            'what.postUri',
          ) ||
          compareValues(
            a.group['what.action'],
            b.group['what.action'],
            'what.action',
          ),
      },
      {
        rule: 'with no aggregates a row is only its group',
        log: IMPRESSIONS,
        group: { by: 'what.surface' },
        rows: SURFACES.map((s) => ({ group: { 'what.surface': s } })),
      },
      {
        rule: 'sorted by an aggregate ascending, then by the group path',
        log: IMPRESSIONS,
        group: {
          by: 'what.postUri',
          aggregates: { deepest: { max: 'what.position' } },
        },
        sort: [{ by: 'deepest' }, { by: 'what.postUri' }],
        order: (a, b) =>
          a.deepest - b.deepest ||
          compareValues(
            a.group['what.postUri'],
            b.group['what.postUri'],
            'what.postUri',
          ),
        total: 8,
      },
      {
        rule: 'a group the filter leaves no lines in is absent',
        filter: {
          every: [
            { not: { in: { 'what.action': ['save', 'hide'] } } },
            HAS_ACTION,
          ],
        },
        group: { by: 'what.action', aggregates: { n: { count: true } } },
        total: 3,
      },
      {
        rule: 'a filter that keeps no line answers no group',
        filter: { eq: { 'what.action': 'impression' } },
        group: { by: 'what.action', aggregates: { n: { count: true } } },
        rows: [],
        total: 0,
      },
      {
        // art, birds, cooking, café, and no topic.
        rule: 'lines with no value for the group path and lines whose value is JSON null are one group, not two',
        group: { by: 'what.topic', aggregates: { n: { count: true } } },
        total: 5,
      },
      {
        // Line 31 (like) and line 32 (save) hold `topic: null`.
        rule: 'count of a path and distinct both skip a JSON null',
        filter: { in: { 'what.action': ['like', 'save'] } },
        group: {
          by: 'what.action',
          aggregates: {
            topics: { count: 'what.topic' },
            named: { distinct: 'what.topic' },
          },
        },
      },
      {
        rule: 'an aggregate over a path no line in the group holds is null, and distinct is an empty list',
        log: IMPRESSIONS,
        group: {
          by: 'what.action',
          aggregates: {
            n: { count: 'what.nothingHere' },
            low: { min: 'what.nothingHere' },
            high: { max: 'what.nothingHere' },
            sum: { sum: 'what.nothingHere' },
            mean: { avg: 'what.nothingHere' },
            all: { distinct: 'what.nothingHere' },
            newest: { latest: 'what.nothingHere' },
          },
        },
        rows: [
          {
            group: { 'what.action': 'impression' },
            n: 0,
            low: null,
            high: null,
            sum: null,
            mean: null,
            all: [],
            newest: null,
          },
        ],
      },
      {
        // `size` is 12 (line 44), 40 (line 45), "large" (38) and "12" (46).
        rule: 'sum and avg read numbers only, so text that looks like a number adds nothing',
        filter: { exists: 'what.size' },
        group: {
          by: 'what.nothingHere',
          aggregates: {
            n: { count: 'what.size' },
            sum: { sum: 'what.size' },
            mean: { avg: 'what.size' },
          },
        },
        rows: [
          { group: { 'what.nothingHere': null }, n: 4, sum: 52, mean: 26 },
        ],
      },
      {
        // Lines 12, 39, 40 and 41 were written at the same instant.
        rule: 'latest is the value on the newest line, the later line winning a tie in time',
        filter: (t0) => ({ eq: { at: iso(t0 - 4 * DAY) } }),
        group: {
          by: 'at',
          aggregates: {
            newest: { latest: 'line' },
            post: { latest: 'what.postUri' },
            n: { count: true },
          },
        },
        rows: (t0) => [
          { group: { at: iso(t0 - 4 * DAY) }, newest: 41, post: 'p6', n: 4 },
        ],
      },
    ];

    test('group: each row answers the groups the oracle works out', async function (assert) {
      for (let row of groupCases) {
        let { rule, log = ENGAGEMENT, group, sort, order } = row;
        let filter =
          typeof row.filter === 'function' ? row.filter(t0) : row.filter;
        let by = ([] as string[]).concat(group.by);
        let expected =
          typeof row.rows === 'function'
            ? row.rows(t0)
            : (row.rows ??
              grouped(keep(fixtureOf(log).lines, filter, t0), by, {
                ...group.aggregates,
              }));
        let result = await search(log, {
          ...(filter ? { filter } : {}),
          group,
          ...(sort ? { sort } : {}),
          page: { size: 1000, total: 'exact' },
        });
        if (order) {
          assert.deepEqual(result.data, [...expected].sort(order), rule);
        } else {
          assert.deepEqual(asSet(result.data), asSet(expected), rule);
        }
        let total = row.total ?? expected.length;
        assert.strictEqual(
          result.meta.page.total,
          total,
          `${rule}: the total counts groups`,
        );
      }
    });

    test('group: pages of groups followed on hasMore (a reactions rollup), and the total counts groups in every mode', async function (assert) {
      let filter = {
        every: [
          { not: { eq: { 'what.action': 'skip' } } },
          { range: { at: { gte: 'now-720h' } } },
        ],
      };
      let by = ['what.postUri', 'what.action'];
      let aggregates = { lastAt: { max: 'what.atMs' } };
      let expected = grouped(
        keep(engagement.lines, filter, t0),
        by,
        aggregates,
      );
      assert.true(expected.length > 12, 'enough groups for several pages');
      let seen: Row[] = [];
      let requests = 0;
      for (let number = 0; ; number++) {
        let page = await search(ENGAGEMENT, {
          filter,
          group: { by, aggregates },
          sort: [{ by: 'lastAt', direction: 'desc' }],
          page: { size: 4, number, total: 'none' },
        });
        requests++;
        seen.push(...page.data);
        if (!page.meta.page.hasMore || requests > 40) {
          break;
        }
      }
      assert.strictEqual(requests, Math.ceil(expected.length / 4));
      assert.deepEqual(asSet(seen), asSet(expected), 'every group once');
      // Newest first; a group with no `atMs` at all (pins current behavior;
      // rule not yet decided) comes last.
      let order = seen.map((r) => r.lastAt as number | null);
      assert.deepEqual(
        order,
        [...order].sort((a, b) =>
          a === null || b === null
            ? a === b
              ? 0
              : a === null
                ? 1
                : -1
            : b - a,
        ),
      );
      let pairs = ['what.postUri', 'what.surface'];
      let count = grouped(impressions.lines, pairs).length;
      for (let total of ['capped', 'exact']) {
        let page = await search(IMPRESSIONS, {
          group: { by: pairs },
          page: { size: 5, total },
        });
        assert.strictEqual(page.data.length, 5);
        assert.true(page.meta.page.hasMore);
        assert.strictEqual(page.meta.page.total, count, total);
      }
      let none = await search(IMPRESSIONS, {
        group: { by: pairs },
        page: { size: 5, number: 1, total: 'none' },
      });
      assert.strictEqual(none.meta.page.total, 10);
    });

    test('group: more groups than a page holds, read 1,000 at a time until hasMore is false', async function (assert) {
      let seen: Row[] = [];
      let requests = 0;
      for (let number = 0; ; number++) {
        let page = await search(BIG, {
          group: { by: 'what.key', aggregates: { last: { max: 'what.n' } } },
          sort: [{ by: 'last', direction: 'desc' }],
          page: { size: 1000, number, total: 'none' },
        });
        requests++;
        seen.push(...page.data);
        if (!page.meta.page.hasMore || requests > 5) {
          break;
        }
      }
      assert.strictEqual(requests, 2);
      assert.deepEqual(
        seen.map((r) => r.last),
        Array.from({ length: 1003 }, (_, i) => 1003 - i),
      );
      assert.strictEqual(
        new Set(seen.map((r) => r.group['what.key'])).size,
        1003,
      );
    });

    test('group: an aggregate name of 61 characters, the longest, reads its value', async function (assert) {
      let name = 'n'.repeat(61);
      let page = await search(ENGAGEMENT, {
        group: { by: 'actor', aggregates: { [name]: { count: true } } },
        page: { size: 100 },
      });
      assert.deepEqual(
        asSet(page.data),
        asSet(
          grouped(engagement.lines, ['actor'], { [name]: { count: true } }),
        ),
      );
    });

    // The groups a page shows and how many there are come from one
    // statement; only a page that shows no group runs a second one to count.
    test('group: the total counts groups on every page, one statement where the page shows a group', async function (assert) {
      let by = ['what.postUri', 'what.surface'];
      let groups = grouped(impressions.lines, by).length;
      assert.true(groups > 10, 'enough groups for a page past the first');
      let statements: string[] = [];
      let execute = dbAdapter.execute.bind(dbAdapter);
      (dbAdapter as any).execute = (sql: string, opts: unknown) => {
        statements.push(sql);
        return execute(sql, opts as any);
      };
      // The statements that read the log's lines grouped.
      const grouping = () =>
        statements.filter((s) => /\bGROUP BY\b/.test(s)).length;
      try {
        for (let [rule, page, total, hasMore, count] of [
          ['capped, more to come', { size: 5 }, groups, true, 1],
          ['exact, more to come', { size: 5, total: 'exact' }, groups, true, 1],
          ['none, more to come', { size: 5, total: 'none' }, 5, true, 1],
          [
            'exact, a later page',
            { size: 3, number: 2, total: 'exact' },
            groups,
            true,
            1,
          ],
          [
            'the last page, short',
            { size: 4, number: Math.ceil(groups / 4) - 1 },
            groups,
            false,
            1,
          ],
          [
            'a page past the last group',
            { size: 5, number: Math.ceil(groups / 5) + 2 },
            groups,
            false,
            2,
          ],
          ['counts only', { size: 0 }, groups, false, 1],
        ] as [string, Row, number, boolean, number][]) {
          statements = [];
          let result = await search(IMPRESSIONS, { group: { by }, page });
          assert.strictEqual(result.meta.page.total, total, `${rule}: total`);
          assert.strictEqual(
            result.meta.page.hasMore,
            hasMore,
            `${rule}: hasMore`,
          );
          assert.strictEqual(grouping(), count, `${rule}: statements`);
        }
      } finally {
        (dbAdapter as any).execute = execute;
      }
    });

    // -----------------------------------------------------------------------
    // Facets
    // -----------------------------------------------------------------------

    // Counts are right, values are distinct, the largest come first, and as
    // many come back as were asked for (or as exist). The order among equal
    // counts is not promised, so it is not compared.
    function assertFacet(
      assert: Assert,
      actual: { value: unknown; count: number }[] | undefined,
      expected: { value: unknown; count: number }[],
      size: number,
      label: string,
    ) {
      let counts = new Map(
        expected.map((e) => [JSON.stringify(e.value), e.count]),
      );
      assert.ok(actual, `${label}: the facet is answered`);
      let entries = actual ?? [];
      for (let entry of entries) {
        assert.strictEqual(
          entry.count,
          counts.get(JSON.stringify(entry.value)),
          `${label}: count of ${JSON.stringify(entry.value)}`,
        );
      }
      assert.strictEqual(
        new Set(entries.map((e) => JSON.stringify(e.value))).size,
        entries.length,
        `${label}: each value once`,
      );
      assert.deepEqual(
        entries.map((e) => e.count),
        expected.slice(0, size).map((e) => e.count),
        `${label}: the largest counts, largest first`,
      );
    }

    test('facets: counts cover the filtered lines, not the page and not the whole log, columns and entry paths alike', async function (assert) {
      let filter = {
        every: [
          { range: { at: { gte: 'now-1w' } } },
          { not: { eq: { actor: '@ada:test' } } },
        ],
      };
      let kept = keep(engagement.lines, filter, t0);
      assert.true(kept.length > 5, 'the filter keeps several lines');
      assert.true(kept.length < engagement.lines.length, 'and drops some');
      let paths = [
        'what.action',
        'actor',
        'what.meta.device.os',
        'what.pinned',
        'what.score',
      ];
      let result = await search(ENGAGEMENT, {
        filter,
        page: { size: 1, number: 2, total: 'none' },
        facets: paths.map((by) => ({ by })),
      });
      assert.deepEqual(lineNumbers(result.data), [kept[2].line]);
      for (let path of paths) {
        assertFacet(
          assert,
          result.meta.facets?.[path],
          facetCounts(kept, (l) => valueAt(l, path)),
          20,
          path,
        );
      }
    });

    // Day buckets in date order, as a card's date buckets are.
    test('facets: by `at` counts per UTC day, leaving out lines with no time', async function (assert) {
      let filter = { range: { at: { gte: 'now-1M' } } };
      let day = (l: Line) => (l.at === null ? undefined : l.at.slice(0, 10));
      for (let [log, lines, f] of [
        [IMPRESSIONS, impressions.lines, filter],
        [ENGAGEMENT, engagement.lines, undefined],
      ] as [string, Line[], Row | undefined][]) {
        let result = await search(log, {
          ...(f ? { filter: f } : {}),
          page: { size: 1 },
          facets: [{ by: 'at', size: 100 }],
        });
        assert.deepEqual(
          result.meta.facets?.at,
          facetCounts(keep(lines, f, t0), day)
            .sort((a, b) => String(a.value).localeCompare(String(b.value)))
            .slice(0, 100),
          log,
        );
      }
    });

    test('facets: with a selection or a grouping, the counts are still of the filtered lines', async function (assert) {
      let filter = { eq: { 'what.surface': 'search' } };
      let expected = facetCounts(keep(impressions.lines, filter, t0), (l) =>
        valueAt(l, 'actor'),
      );
      for (let [label, shape] of [
        ['select', { select: ['actor'] }],
        ['group', { group: { by: 'what.postUri' } }],
      ] as [string, Row][]) {
        let result = await search(IMPRESSIONS, {
          filter,
          ...shape,
          page: { size: 2 },
          facets: [{ by: 'actor' }],
        });
        assertFacet(assert, result.meta.facets?.actor, expected, 20, label);
      }
    });

    // -----------------------------------------------------------------------
    // The empty log, and how a log is named
    // -----------------------------------------------------------------------

    test('an empty log answers no rows, a zero total, no more, and empty facets and groups, on the wire as well', async function (assert) {
      for (let total of ['none', 'capped', 'exact']) {
        let plain = await search(EMPTY, { page: { total } });
        assert.deepEqual(plain.data, [], total);
        assert.strictEqual(plain.meta.page.total, 0, total);
        assert.false(plain.meta.page.hasMore, total);
        assert.false(hasWarning(plain.meta, 'total-estimated'), total);
      }
      let filtered = await search(EMPTY, {
        filter: { range: { at: { gte: 'now-1d' } } },
        sort: [{ by: 'at', direction: 'desc' }],
        select: ['what.action'],
        facets: [{ by: 'what.action' }, { by: 'at' }],
      });
      assert.deepEqual(filtered.data, []);
      assert.deepEqual(filtered.meta.facets, { 'what.action': [], at: [] });
      let groups = await search(EMPTY, {
        group: { by: 'what.action', aggregates: { n: { count: true } } },
        page: { total: 'exact' },
      });
      assert.deepEqual(groups.data, []);
      assert.strictEqual(groups.meta.page.total, 0);
      let wire = await logAnswer(dbAdapter, realmURL, {
        from: { log: EMPTY },
        facets: [{ by: 'actor' }],
      });
      assert.strictEqual(wire.status, 200);
      assert.deepEqual(wire.body, {
        data: [],
        meta: {
          page: { total: 0, hasMore: false },
          facets: { actor: [] },
          log: `${realmURL}${EMPTY}`,
        },
      });
    });

    test('a log is named by a realm-relative path or by its absolute URL, and the answer names the absolute URL', async function (assert) {
      let rest = {
        filter: { eq: { 'what.action': 'share' } },
        sort: [{ by: 'at', direction: 'desc' }],
      };
      let relative = await search(ENGAGEMENT, rest);
      let absolute = await search(`${realmURL}${ENGAGEMENT}`, rest);
      let dotted = await search(`./Feed/../${ENGAGEMENT}`, rest);
      assert.true(relative.data.length > 0);
      assert.deepEqual(absolute, relative);
      assert.deepEqual(dotted, relative);
      assert.strictEqual(relative.meta.log, `${realmURL}${ENGAGEMENT}`);
    });

    // -----------------------------------------------------------------------
    // Refusals
    // -----------------------------------------------------------------------

    test('a NUL character or an unpaired surrogate anywhere in the query is refused, not sent to Postgres', async function (assert) {
      // Postgres stores neither in text or jsonb, so sent they surface as a
      // raw SQLSTATE (22P05, 22021) instead of a refusal.
      let bad = ['a\u0000b', '\uD800', '\uDC00', 'a\uD83Db', '\uDC00\uD800'];
      for (let text of bad) {
        let bodies: Row[] = [
          { filter: { eq: { 'what.action': text } } },
          { filter: { in: { actor: ['x', text] } } },
          { filter: { contains: { actor: text } } },
          { filter: { not: { eq: { what: { action: text } } } } },
          { from: { log: `Feed/${text}.jsonl` } },
          { filter: { exists: text } },
        ];
        for (let body of bodies) {
          let answer = await logAnswer(dbAdapter, realmURL, {
            from: { log: ENGAGEMENT },
            ...body,
          });
          assert.deepEqual(
            [answer.status, answer.code, answer.crash],
            [400, 'invalid-value', undefined],
            `${JSON.stringify(body)} is refused`,
          );
          assert.false(
            answer.message.includes(text),
            'the refusal does not echo the text',
          );
        }
      }
      // A whole surrogate pair is one character, and is accepted.
      let astral = await logAnswer(dbAdapter, realmURL, {
        from: { log: ENGAGEMENT },
        filter: { eq: { 'what.action': '\u{1D11E}' } },
      });
      assert.strictEqual(astral.status, 200);
    });

    const BAD_PATH = 'what.post-uri';
    const badPath = /what\.post-uri/;
    const quoted = (text: string) =>
      new RegExp(text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));

    // Each row: what is wrong, the query beside `from`, the code, and for a
    // log-only refusal a pattern its message must hold. Shapes the card
    // validator refuses alike are held by the query-refusals-*test.ts files
    // ([validation] rows); one row of each shows a log reaches it.
    const refusals: [rule: string, body: Row, code: string, names?: RegExp][] =
      [
        // Members: card ones a log does not support (the rest are in
        // log-query-parity), unknown ones, a retired one.
        [
          '"realms" beside from',
          { realms: {} },
          'not-supported-for-logs',
          /"realms"/,
        ],
        ['"matches" beside from', { matches: {} }, 'unknown-key', /"matches"/],
        ['"cursor" beside from', { cursor: {} }, 'unknown-key', /"cursor"/],
        ['"limit" beside from', { limit: 10 }, 'unknown-key', /"limit"/],
        [
          '"aggregates" beside from',
          { aggregates: {} },
          'unknown-key',
          /"aggregates"/,
        ],
        [
          'an unknown member inside from',
          { from: { log: ENGAGEMENT, realm: realmURL } },
          'unknown-key',
        ],
        [
          'an unknown member inside page',
          { page: { size: 10, cursor: 'abc' } },
          'unknown-key',
          /cursor/,
        ],
        [
          "a card search's older `page.exactTotal`",
          { page: { size: 10, exactTotal: true } },
          'unknown-key',
          /exactTotal/,
        ],
        [
          'a card facet member inside a facet (`stats`)',
          { facets: [{ by: 'what.action', stats: true }] },
          'not-supported-for-logs',
          /stats/,
        ],
        [
          'a card facet member inside a facet (`interval`)',
          { facets: [{ by: 'at', interval: 'month' }] },
          'not-supported-for-logs',
          /interval/,
        ],
        [
          'an unknown member inside group',
          { group: { by: 'what.action', having: { n: { gt: 1 } } } },
          'unknown-key',
          /having/,
        ],
        ...['type', 'on', 'gt'].map((op): [string, Row, string, RegExp] => [
          `the filter operator "${op}", which a log filter does not take`,
          { filter: { [op]: { 'what.action': 'like' } } },
          op === 'gt' ? 'unknown-key' : 'not-supported-for-logs',
          new RegExp(`\\b${op}\\b`),
        ]),

        // Shapes the card validator refuses alike.
        [
          'a filter with no operator',
          { filter: {} },
          'missing-member',
          /filter/i,
        ],
        [
          'two operators in one filter',
          {
            filter: {
              eq: { 'what.action': 'like' },
              range: { 'what.dwellMs': { gte: 100000 } },
            },
          },
          'conflicting-members',
          /filter/i,
        ],
        [
          'in over a value that is not a list',
          { filter: { in: { 'what.action': 'like' } } },
          'invalid-value',
        ],
        [
          'range bounds that are a number',
          { filter: { range: { line: 5 } } },
          'invalid-value',
          /range|line/,
        ],
        [
          'a sort direction that is neither asc nor desc',
          { sort: [{ by: 'at', direction: 'descending' }] },
          'invalid-value',
          /direction|descending/,
        ],
        ['a page that is a number', { page: 5 }, 'invalid-page', /page/],
        [
          'a page number past the bigint range of an offset',
          { page: { number: '9223372036854775808' } },
          'invalid-page',
        ],
        [
          'a page number whose offset is past exact integers',
          { page: { number: 2 ** 50, size: 1000 } },
          'invalid-page',
        ],
        [
          'a facet with no `by`',
          { facets: [{ size: 5 }] },
          'invalid-value',
          /facet|by/,
        ],

        // A line's columns.
        [
          'a range on line whose bound is not a number',
          { filter: { range: { line: { gte: 'ten' } } } },
          'invalid-value',
          /line|ten/,
        ],
        [
          'eq on line with a value that is not a number',
          { filter: { eq: { line: 'ten' } } },
          'invalid-value',
          /line|ten/,
        ],
        [
          'a time bound that is a boolean',
          { filter: { range: { at: { gte: true } } } },
          'invalid-value',
        ],

        // group and aggregates.
        [
          'group with an empty `by`',
          { group: { by: [] } },
          'missing-member',
          /group\.by/,
        ],
        [
          'group with no `by`',
          { group: { aggregates: { n: { count: true } } } },
          'missing-member',
          /group|by/,
        ],
        [
          'an aggregate name that is not a plain word',
          { group: { by: 'actor', aggregates: { 'last-at': { max: 'at' } } } },
          'invalid-value',
          /last-at/,
        ],
        [
          // A grouped row holds its keys under `group`.
          'an aggregate named group',
          { group: { by: 'actor', aggregates: { group: { count: true } } } },
          'invalid-value',
          /"group" is reserved/,
        ],
        ...['__proto__', 'constructor', 'prototype'].map(
          (name): [string, Row, string, RegExp] => [
            `an aggregate named ${name}, which names an object's own machinery`,
            { group: { by: 'actor', aggregates: { [name]: { count: true } } } },
            'invalid-value',
            new RegExp(`"${name}" is reserved`),
          ],
        ),
        [
          // Longer, its column's name would pass Postgres's 63 bytes.
          'an aggregate name longer than 61 characters',
          {
            group: {
              by: 'actor',
              aggregates: { ['n'.repeat(62)]: { count: true } },
            },
          },
          'invalid-value',
          /at most 61 characters/,
        ],
        [
          'an aggregate that is not one of the seven',
          { group: { by: 'actor', aggregates: { mid: { median: 'what.x' } } } },
          'unknown-key',
          /mid/,
        ],
        [
          'an aggregate naming two operations',
          {
            group: {
              by: 'actor',
              aggregates: { both: { min: 'what.score', max: 'what.score' } },
            },
          },
          'conflicting-members',
          /both/,
        ],
        [
          'an aggregate that is null',
          { group: { by: 'actor', aggregates: { nothing: null } } },
          'invalid-value',
          /nothing/,
        ],
        [
          'a sum of `true` rather than of a path',
          { group: { by: 'actor', aggregates: { whole: { sum: true } } } },
          'invalid-value',
          /whole/,
        ],
        [
          'a count of `false`',
          { group: { by: 'actor', aggregates: { tally: { count: false } } } },
          'invalid-value',
          /tally/,
        ],
        [
          'a grouped query sorted by a path neither grouped nor an aggregate',
          {
            group: { by: 'actor', aggregates: { n: { count: true } } },
            sort: [{ by: 'what.dwellMs' }],
          },
          'invalid-value',
          /what\.dwellMs/,
        ],
        [
          'a grouped query sorted by `at` when `at` is not grouped',
          { group: { by: 'actor' }, sort: [{ by: 'at' }] },
          'invalid-value',
          /"at"/,
        ],

        // Paths, wherever a log names one.
        ...(
          [
            ['eq', { filter: { eq: { [BAD_PATH]: 'p1' } } }],
            ['exists', { filter: { exists: BAD_PATH } }],
            ['select', { select: [BAD_PATH] }],
            ['a facet', { facets: [{ by: BAD_PATH }] }],
            ['group.by', { group: { by: ['actor', BAD_PATH] } }],
            [
              'an aggregate',
              { group: { by: 'actor', aggregates: { n: { max: BAD_PATH } } } },
            ],
          ] as [string, Row][]
        ).map(([where, body]): [string, Row, string, RegExp | undefined] => [
          `a path with a hyphen, in ${where}`,
          body,
          'invalid-value',
          where === 'a facet' ? undefined : badPath,
        ]),
        [
          'an empty path',
          { filter: { eq: { '': 'x' } } },
          'invalid-value',
          /path/i,
        ],
        [
          'a path with an empty segment',
          { filter: { eq: { 'what..action': 'like' } } },
          'invalid-value',
          /what\.\.action/,
        ],
        [
          'a path that starts with a dot',
          { sort: [{ by: '.what' }] },
          'invalid-value',
          /\.what/,
        ],
        [
          'a path that tries to carry SQL',
          { sort: [{ by: "what.action'); DROP TABLE boxel_log_lines; --" }] },
          'invalid-value',
          /DROP TABLE/,
        ],
        [
          // Pins current behavior; rule not yet decided.
          'a path into a list by position',
          { filter: { eq: { 'what.meta.tags.0': 'a' } } },
          'invalid-value',
          /what\.meta\.tags\.0/,
        ],
        [
          // Pins current behavior; rule not yet decided: a key outside ASCII
          // letters, digits, `_` and `$` is not addressable.
          'a path with a non-ASCII key',
          { filter: { exists: 'what.café' } },
          'invalid-value',
          /what\.café/,
        ],

        // Times (a log's own parsing of `at`).
        ...[
          'now-1x',
          'now-',
          'now-d',
          'now-1.5h',
          'NOW-1d',
          'now - 1d',
          'yesterday',
          '2026-13-45',
          // The unit forgotten.
          'now-1',
          'now-7',
          // A zone that is no zone, and text Date.parse would read in the
          // server's own zone.
          '2026-11-10T10:00+25:00',
          'March 7, 2026',
          '11/10/2026',
        ].map((time): [string, Row, string, RegExp] => [
          `a time bound of ${JSON.stringify(time)}`,
          { filter: { range: { at: { gte: time } } } },
          'invalid-value',
          quoted(time),
        ]),
        [
          'eq on at with a malformed relative time',
          { filter: { eq: { at: 'now-1x' } } },
          'invalid-value',
          /now-1x/,
        ],

        // The log itself.
        ...(
          [
            [
              'a file that is not a log (.json)',
              'Feed/data.json',
              /Feed\/data\.json/,
            ],
            [
              'a file that is not a log (no extension)',
              'Feed/engagement',
              /Feed\/engagement/,
            ],
            ['a file that is not a log (.txt)', 'notes.txt', undefined],
            [
              "a card's vector sidecar, which is JSON Lines but not a log",
              'Feed/post.vectors.jsonl',
              /post\.vectors\.jsonl/,
            ],
            ['an empty log name', '', /log/],
            [
              'a relative path that climbs out of the realm',
              '../outside.jsonl',
              /outside\.jsonl/,
            ],
            [
              'a log on another origin',
              'https://elsewhere.example/Feed/engagement.jsonl',
              /elsewhere\.example/,
            ],
            [
              'a log in a realm whose URL only starts like this one',
              'http://log-cases-test/realm-two/Feed/engagement.jsonl',
              /realm-two/,
            ],
          ] as [string, string, RegExp | undefined][]
        ).map(
          ([rule, log, names]): [string, Row, string, RegExp | undefined] => [
            rule,
            { from: { log } },
            'invalid-value',
            names,
          ],
        ),
      ];

    test('refused: each row is a 400 with its code, never a crash, and leaves the next query unharmed', async function (assert) {
      for (let [rule, body, code, names] of refusals) {
        let answer = await logAnswer(dbAdapter, realmURL, {
          from: { log: ENGAGEMENT },
          ...body,
        });
        assert.deepEqual(
          [answer.crash, answer.status, answer.code],
          [undefined, 400, code],
          rule,
        );
        if (names) {
          assert.true(
            names.test(answer.message),
            `${rule}: the message names it (${names}): ${JSON.stringify(answer.message)}`,
          );
        }
      }
      let missing = await logAnswer(dbAdapter, realmURL, {
        from: { log: ENGAGEMENT },
        sort: [{ by: 'at', missing: 'first' }],
      });
      assert.strictEqual(missing.status, 200, 'a sort key takes `missing`');
      // SQLite keeps no log tables: it reads the log's file and answers over
      // its lines, as Postgres does (docs/search.md, "On SQLite").
      let sqlite = await logAnswer(
        { kind: 'sqlite' } as unknown as DBAdapter,
        realmURL,
        { from: { log: ENGAGEMENT } },
        {
          readLogFile: async (u: string) =>
            u === `${realmURL}${ENGAGEMENT}`
              ? { content: engagement.content }
              : undefined,
        },
      );
      assert.deepEqual(
        [sqlite.status, sqlite.code],
        [200, undefined],
        'a database that is not Postgres answers',
      );
      assert.deepEqual(
        sqlite.body?.data,
        (await search(ENGAGEMENT)).data,
        'with the lines Postgres answers',
      );
      let invalidOnSqlite = await logAnswer(
        { kind: 'sqlite' } as unknown as DBAdapter,
        realmURL,
        { from: { log: ENGAGEMENT }, page: { size: -1 } },
      );
      assert.strictEqual(
        invalidOnSqlite.status,
        400,
        'an invalid log query is still refused there',
      );
      assert.deepEqual(await matching(ENGAGEMENT, { eq: { line: 1 } }), [1]);
    });

    // -----------------------------------------------------------------------
    // The handler's own refusals, with a context that only records
    // -----------------------------------------------------------------------

    function fakeContext() {
      let headers: Record<string, string> = {};
      let ctxt = {
        req: {
          headers: { host: 'log-cases-test' },
          socket: {},
          url: '/realm/_search',
        },
        method: 'QUERY',
        status: 0,
        message: '',
        body: undefined as unknown,
        set(name: string, value: string) {
          headers[name] = value;
        },
      };
      return {
        ctxt,
        koa: ctxt as unknown as Koa.Context,
        json: () => JSON.parse(String(ctxt.body)) as Row,
      };
    }

    const HANDLER_QUERY = {
      from: { log: ENGAGEMENT },
      filter: { eq: { 'what.action': 'share' } },
    } as LogQuery;
    const OTHER = 'http://log-cases-test/other/';

    test('handler: one realm the caller reads answers the lines; more than one, none, or one they cannot read is refused with no lines', async function (assert) {
      const COLLAPSE = { ...HANDLER_QUERY, collapse: { by: 'actor' } };
      for (let [rule, query, realms, readable, status, says, code] of [
        [
          'more than one realm',
          HANDLER_QUERY,
          [realmURL, OTHER],
          [realmURL, OTHER],
          400,
          /one realm/,
        ],
        ['no realm', HANDLER_QUERY, [], [realmURL], 400],
        [
          'a realm the caller cannot read',
          HANDLER_QUERY,
          [realmURL],
          [OTHER],
          403,
          /read access/,
        ],
        [
          'a query the log grammar refuses',
          COLLAPSE,
          [realmURL],
          [realmURL],
          400,
          /"collapse"/,
          'not-supported-for-logs',
        ],
      ] as [string, Row, string[], string[], number, RegExp?, string?][]) {
        let { ctxt, koa, json } = fakeContext();
        await respondToLogSearch(
          koa,
          query as LogQuery,
          realms,
          readable,
          dbAdapter,
        );
        assert.strictEqual(ctxt.status, status, rule);
        assert.strictEqual(json().data, undefined, `${rule}: no lines`);
        if (says) {
          // The whole answer, and its first message as written.
          let text = `${JSON.stringify(json())} ${json().errors?.[0]?.message}`;
          assert.true(says.test(text), text);
        }
        if (code) {
          assert.strictEqual(json().errors[0].code, code, `${rule}: code`);
        }
      }
      let { ctxt, koa, json } = fakeContext();
      await respondToLogSearch(
        koa,
        HANDLER_QUERY,
        [realmURL],
        [realmURL],
        dbAdapter,
      );
      assert.strictEqual(ctxt.status, 200);
      assert.deepEqual(
        lineNumbers(json().data),
        keep(engagement.lines, HANDLER_QUERY.filter as Row, t0).map(
          (l) => l.line,
        ),
      );
      assert.strictEqual(json().meta.log, `${realmURL}${ENGAGEMENT}`);
    });
  });
});
