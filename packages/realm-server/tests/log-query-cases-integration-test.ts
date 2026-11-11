import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type Koa from 'koa';

import type { PgAdapter } from '@cardstack/postgres';
import {
  hasWarning,
  logSearchResponse,
  query,
  runLogQuery,
  SEARCH_TOTAL_CAP,
  syncLogFile,
  type DBAdapter,
  type Expression,
  type LogLineIndexHost,
  type LogQuery,
} from '@cardstack/runtime-common';

import { respondToLogSearch } from '../handlers/log-search.ts';
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
        let host: LogLineIndexHost = {
          dbAdapter,
          realmURL,
          query: (e: Expression) => query(dbAdapter, e) as any,
          readLogFile: async (url) =>
            files.has(url) ? { content: files.get(url)! } : undefined,
        };
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
    // 8. What a line reads as
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
    });

    test('an impressions log written entirely through JSON-string `what` reads back whole', async function (assert) {
      let result = await search(IMPRESSIONS, { page: { size: 1000 } });
      assert.deepEqual(result.data, impressions.lines.map(fullRow));
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
    // 1. Filters
    // -----------------------------------------------------------------------

    const filterCases: {
      rule: string;
      log?: string;
      filter: Row | ((t0: number) => Row);
      // Lines worked out by hand, where the rule is worth spelling out.
      lines?: number[];
      empty?: true;
    }[] = [
      {
        rule: 'eq on a path into the entry',
        filter: { eq: { 'what.action': 'save' } },
      },
      {
        rule: 'eq on a deeper path',
        filter: { eq: { 'what.meta.device.os': 'web' } },
      },
      {
        rule: 'eq on two paths keeps the lines matching both',
        filter: { eq: { 'what.action': 'like', 'what.postUri': 'p6' } },
        // The generated line 6 (i = 5: like, p6) and the three duplicates.
        lines: [6, 39, 40, 41],
      },
      {
        rule: 'eq on a number is strict about type',
        filter: { eq: { 'what.size': 12 } },
        // Line 46 holds the text "12".
        lines: [44],
      },
      {
        rule: 'eq on text that looks like a number is strict about type',
        filter: { eq: { 'what.size': '12' } },
        lines: [46],
      },
      {
        rule: 'eq on a boolean',
        filter: { eq: { 'what.pinned': true } },
        lines: [1, 10, 19, 28],
      },
      {
        rule: 'eq on zero does not match a line with no value',
        filter: { eq: { 'what.dwellMs': 0 } },
      },
      {
        rule: 'eq on a unicode value',
        filter: { eq: { 'what.topic': 'café' } },
        lines: [38],
      },
      {
        rule: 'eq on a whole unicode sentence',
        filter: { eq: { 'what.note': UNICODE_NOTE } },
        lines: [38],
      },
      { rule: 'eq on actor', filter: { eq: { actor: '@cy:test' } } },
      {
        rule: 'eq null on actor keeps the lines with no actor',
        filter: { eq: { actor: null } },
        lines: [31, 32, 43],
      },
      { rule: 'eq on line', filter: { eq: { line: 17 } }, lines: [17] },
      {
        rule: 'eq on at keeps every line written at that instant',
        filter: (t0) => ({ eq: { at: iso(t0 - 4 * DAY) } }),
        // The generated line with age 4d and the three duplicates.
        lines: [12, 39, 40, 41],
      },
      {
        rule: 'eq null on a path keeps the lines with nothing there',
        filter: { eq: { 'what.dwellMs': null } },
      },
      {
        rule: 'eq null on `what.action` keeps the lines whose `what` is absent or not an object',
        filter: { eq: { 'what.action': null } },
        lines: [36, 37, 43],
      },
      {
        rule: 'in keeps a line matching any listed value',
        filter: { in: { 'what.action': ['save', 'hide'] } },
      },
      {
        rule: 'in with one value is eq',
        filter: { in: { 'what.postUri': ['p5'] } },
      },
      {
        rule: 'in with no values keeps nothing',
        filter: { in: { 'what.action': [] } },
        empty: true,
      },
      {
        rule: 'in on actor',
        filter: { in: { actor: ['@ada:test', '@dee:test'] } },
      },
      { rule: 'in on line', filter: { in: { line: [2, 43, 46, 999] } } },
      {
        rule: 'exists keeps the lines with a value',
        filter: { exists: 'what.dwellMs' },
      },
      {
        rule: 'exists on at drops the lines with no readable time',
        filter: { not: { exists: 'at' } },
        lines: [33, 34, 35, 43],
      },
      { rule: 'exists on actor', filter: { exists: 'actor' } },
      {
        rule: 'range on a number inside the entry, both ends',
        filter: { range: { 'what.dwellMs': { gte: 300, lt: 900 } } },
      },
      {
        rule: 'range on a number takes a negative and a fraction',
        filter: { range: { 'what.score': { gt: -2, lte: 0.5 } } },
      },
      {
        rule: 'a number range does not match text that looks like a number',
        filter: { range: { 'what.size': { gte: 1 } } },
        lines: [44, 45],
      },
      {
        rule: 'range on text compares text',
        log: IMPRESSIONS,
        filter: { range: { 'what.surface': { gte: 'p' } } },
      },
      {
        rule: 'range on line',
        filter: { range: { line: { gt: 40, lte: 44 } } },
        lines: [41, 42, 43, 44],
      },
      {
        rule: 'range on at with ISO bounds',
        filter: (t0) => ({
          range: {
            at: { gte: iso(t0 - 3 * DAY), lt: iso(t0 - 90 * MIN) },
          },
        }),
      },
      {
        rule: 'range on at takes `yyyy-mm-dd hh:mm:ss` as UTC',
        filter: (t0) => ({
          range: { at: { gte: plainTime(t0 - 3 * HOUR) } },
        }),
      },
      {
        rule: 'range on at takes milliseconds since the epoch',
        filter: (t0) => ({ range: { at: { lt: t0 - 100 * DAY } } }),
      },
      {
        rule: 'a range bound is inclusive with gte and lte, exclusive with gt and lt',
        filter: (t0) => ({
          every: [
            { range: { at: { gte: iso(t0 - 4 * DAY) } } },
            { range: { at: { lte: iso(t0 - 4 * DAY) } } },
            { not: { range: { at: { gt: iso(t0 - 4 * DAY) } } } },
            { not: { range: { at: { lt: iso(t0 - 4 * DAY) } } } },
          ],
        }),
        lines: [12, 39, 40, 41],
      },
      {
        rule: 'contains ignores case',
        filter: { contains: { 'what.note': 'done' } },
        lines: [44, 45],
      },
      {
        rule: 'contains matches unicode',
        filter: { contains: { 'what.note': '日本' } },
        lines: [38],
      },
      {
        rule: 'contains reads `_` as itself, not as any character',
        filter: { contains: { 'what.note': 'a_b' } },
        lines: [44],
      },
      {
        rule: 'contains reads `%` as itself',
        filter: { contains: { 'what.note': '100%' } },
        lines: [44],
      },
      {
        rule: 'contains reads a backslash as itself',
        filter: { contains: { 'what.note': 'b \\ d' } },
        lines: [44],
      },
      {
        rule: 'contains on actor',
        filter: { contains: { actor: 'ADA' } },
      },
      {
        rule: 'contains on a `what` that stayed text',
        filter: { contains: { what: 'some words' } },
        lines: [36],
      },
      {
        rule: 'every keeps the lines all its filters keep',
        filter: {
          every: [
            { eq: { 'what.action': 'like' } },
            { range: { 'what.score': { gte: 1 } } },
            { exists: 'actor' },
          ],
        },
      },
      {
        rule: 'every of nothing keeps every line',
        filter: { every: [] },
        lines: Array.from({ length: 46 }, (_, i) => i + 1),
      },
      {
        rule: 'any keeps the lines one of its filters keeps',
        filter: {
          any: [
            { eq: { 'what.action': 'share' } },
            { range: { 'what.dwellMs': { gte: 1000 } } },
            { eq: { actor: null } },
          ],
        },
      },
      {
        rule: 'any of nothing keeps no line',
        filter: { any: [] },
        empty: true,
      },
      {
        rule: 'not inside any inside every',
        filter: {
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
      },
      {
        rule: 'not not is the filter itself',
        filter: { not: { not: { eq: { 'what.action': 'hide' } } } },
      },
    ];

    for (let { rule, log = ENGAGEMENT, filter, lines, empty } of filterCases) {
      test(`filter: ${rule}`, async function (assert) {
        let resolved = typeof filter === 'function' ? filter(t0) : filter;
        let all = fixtureOf(log).lines;
        let expected = keep(all, resolved, t0).map((l) => l.line);
        if (lines) {
          assert.deepEqual(
            expected,
            lines,
            'the oracle agrees with the hand count',
          );
        }
        if (empty) {
          assert.deepEqual(expected, [], 'the oracle keeps nothing');
        } else {
          assert.true(expected.length > 0, 'the case keeps some line');
        }
        assert.deepEqual(await matching(log, resolved), expected);
      });
    }

    // Missing values under `not`: a line with no value at a path is dropped
    // by the filter and by its `not` alike, as a card query drops a card.
    const NO_ACTION = [36, 37, 43];
    const NO_ACTOR = [31, 32, 43];
    const NO_DWELL = (lines: Line[]) =>
      lines.filter((l) => valueAt(l, 'what.dwellMs') === undefined);

    test('not eq on an entry path drops the lines with no value there; eq null beside it brings them back', async function (assert) {
      let notLike = { not: { eq: { 'what.action': 'like' } } };
      let kept = await matching(ENGAGEMENT, notLike);
      let expected = engagement.lines
        .filter((l) => {
          let action = valueAt(l, 'what.action');
          return action !== undefined && action !== 'like';
        })
        .map((l) => l.line);
      assert.deepEqual(kept, expected);
      for (let line of NO_ACTION) {
        assert.false(
          kept.includes(line),
          `line ${line} has no action and goes`,
        );
      }
      assert.deepEqual(
        await matching(ENGAGEMENT, {
          any: [{ eq: { 'what.action': null } }, notLike],
        }),
        [...expected, ...NO_ACTION].sort((a, b) => a - b),
        'with eq null beside it, the lines with no action are kept',
      );
    });

    test('not in on an entry path drops the lines with no value there; eq null beside it brings them back', async function (assert) {
      let listed = ['like', 'save', 'skip'];
      let notListed = { not: { in: { 'what.action': listed } } };
      let kept = await matching(ENGAGEMENT, notListed);
      let expected = engagement.lines
        .filter((l) => {
          let action = valueAt(l, 'what.action');
          return action !== undefined && !listed.includes(action as string);
        })
        .map((l) => l.line);
      assert.deepEqual(kept, expected);
      for (let line of NO_ACTION) {
        assert.false(kept.includes(line), `line ${line} goes`);
      }
      assert.deepEqual(
        await matching(ENGAGEMENT, {
          any: [{ eq: { 'what.action': null } }, notListed],
        }),
        [...expected, ...NO_ACTION].sort((a, b) => a - b),
        'with eq null beside it, the lines with no action are kept',
      );
    });

    test('not eq on actor drops the lines with no actor (pins current behavior; rule not yet decided)', async function (assert) {
      let kept = await matching(ENGAGEMENT, {
        not: { eq: { actor: '@ada:test' } },
      });
      let expected = engagement.lines
        .filter((l) => l.actor !== null && l.actor !== '@ada:test')
        .map((l) => l.line);
      assert.deepEqual(kept, expected);
      for (let line of NO_ACTOR) {
        assert.false(kept.includes(line), `line ${line} has no actor and goes`);
      }
    });

    test('a number range and its not both drop the lines with no number there (pins current behavior; rule not yet decided)', async function (assert) {
      let range = { range: { 'what.dwellMs': { gte: 500 } } };
      let inside = await matching(ENGAGEMENT, range);
      let outside = await matching(ENGAGEMENT, { not: range });
      let dwell = (l: Line) => valueAt(l, 'what.dwellMs') as number | undefined;
      assert.deepEqual(
        inside,
        engagement.lines
          .filter((l) => dwell(l) !== undefined && dwell(l)! >= 500)
          .map((l) => l.line),
      );
      assert.deepEqual(
        outside,
        engagement.lines
          .filter((l) => dwell(l) !== undefined && dwell(l)! < 500)
          .map((l) => l.line),
      );
      let missing = NO_DWELL(engagement.lines).map((l) => l.line);
      assert.true(missing.length > 0);
      assert.deepEqual(
        [...inside, ...outside, ...missing].sort((a: any, b: any) => a - b),
        engagement.lines.map((l) => l.line),
        'the three sets are the whole log, with no overlap',
      );
    });

    test('contains and its not both drop the lines with no value there (pins current behavior; rule not yet decided)', async function (assert) {
      let contains = { contains: { 'what.note': 'done' } };
      assert.deepEqual(await matching(ENGAGEMENT, contains), [44, 45]);
      // Only line 38 has a note without "done".
      assert.deepEqual(await matching(ENGAGEMENT, { not: contains }), [38]);
    });

    test('a time range and its not both drop the lines with no time', async function (assert) {
      let range = { range: { at: { gte: 'now-1d' } } };
      let inside = await matching(ENGAGEMENT, range);
      let outside = await matching(ENGAGEMENT, { not: range });
      assert.deepEqual(
        [...inside, ...outside].sort((a: any, b: any) => a - b),
        engagement.lines.filter((l) => l.at !== null).map((l) => l.line),
      );
    });

    test('exists and eq null split the log in two, whatever the path', async function (assert) {
      for (let path of ['what.dwellMs', 'what.topic', 'what.action', 'actor']) {
        let present = await matching(ENGAGEMENT, { exists: path });
        let absent = await matching(ENGAGEMENT, { eq: { [path]: null } });
        assert.deepEqual(
          [...present, ...absent].sort((a: any, b: any) => a - b),
          engagement.lines.map((l) => l.line),
          path,
        );
      }
    });

    // A value that is JSON null. Lines 31 and 32 hold `topic: null`; a row
    // shows it exactly as it shows a missing topic.
    test('eq null keeps a line whose value is JSON null as well as one with no value', async function (assert) {
      let expected = engagement.lines
        .filter((l) => valueAt(l, 'what.topic') === undefined)
        .map((l) => l.line);
      assert.true(expected.includes(31), 'line 31 holds a null topic');
      assert.true(expected.includes(32), 'line 32 holds a null topic');
      assert.deepEqual(
        await matching(ENGAGEMENT, { eq: { 'what.topic': null } }),
        expected,
      );
    });

    test('exists does not keep a line whose value is JSON null', async function (assert) {
      let kept = await matching(ENGAGEMENT, { exists: 'what.topic' });
      assert.deepEqual(
        kept,
        engagement.lines
          .filter((l) => valueAt(l, 'what.topic') !== undefined)
          .map((l) => l.line),
      );
    });

    test('eq with a list value is equality, not "holds these items"', async function (assert) {
      let expected = engagement.lines
        .filter((l) => same(valueAt(l, 'what.meta.tags'), ['a']))
        .map((l) => l.line);
      assert.true(expected.length > 0);
      assert.deepEqual(
        await matching(ENGAGEMENT, { eq: { 'what.meta.tags': ['a'] } }),
        expected,
      );
    });

    test('eq with an object value is equality, not "holds these members"', async function (assert) {
      // Only line 32's `meta` is exactly its device; every other web line
      // also carries tags.
      assert.deepEqual(
        await matching(ENGAGEMENT, {
          eq: { 'what.meta': { device: { os: 'web' } } },
        }),
        [32],
      );
    });

    // -----------------------------------------------------------------------
    // 2. Relative times, resolved by the engine
    // -----------------------------------------------------------------------

    const relativeCases: { rule: string; range: Row; log?: string }[] = [
      { rule: 'the last hour', range: { gte: 'now-1h' } },
      { rule: 'the last 3600 seconds', range: { gte: 'now-3600s' } },
      { rule: 'the last 90 minutes', range: { gte: 'now-90m' } },
      { rule: 'the last day', range: { gte: 'now-1d' } },
      { rule: 'the last 24 hours', range: { gte: 'now-24h' } },
      { rule: 'the last week', range: { gte: 'now-1w' } },
      { rule: 'the last 720 hours', range: { gte: 'now-720h' } },
      { rule: 'the last 30 days', range: { gte: 'now-30d' } },
      { rule: 'the last month', range: { gte: 'now-1M' } },
      { rule: 'the last year', range: { gte: 'now-1y' } },
      { rule: 'older than a day', range: { lt: 'now-1d' } },
      { rule: 'older than a year', range: { lte: 'now-1y' } },
      {
        rule: 'up to now leaves out a line from the future',
        range: { lte: 'now' },
      },
      {
        rule: 'after now is only the line from the future',
        range: { gt: 'now' },
      },
      {
        rule: 'between a week ago and a day ago',
        range: { gte: 'now-1w', lt: 'now-1d' },
      },
      {
        rule: 'the last 720 hours of the impressions log',
        range: { gte: 'now-720h' },
        log: IMPRESSIONS,
      },
      {
        rule: 'between a month ago and an hour ago in the impressions log',
        range: { gt: 'now-1M', lte: 'now-1h' },
        log: IMPRESSIONS,
      },
    ];

    for (let { rule, range, log = ENGAGEMENT } of relativeCases) {
      test(`relative time: ${rule} (${JSON.stringify(range)})`, async function (assert) {
        let all = fixtureOf(log).lines;
        let filter = { range: { at: range } };
        let expected = keep(all, filter, t0).map((l) => l.line);
        assert.true(expected.length > 0, 'some line is inside the bound');
        assert.true(expected.length < all.length, 'some line is outside it');
        assert.deepEqual(await matching(log, filter), expected);
      });
    }

    test('relative time: `now-1h` keeps exactly the lines under an hour old', async function (assert) {
      // By hand: ages 10m, 20m, 30m and 45m, plus the line from the future.
      let expected = engagement.lines
        .filter((l) => l.at !== null && Date.parse(l.at) > t0 - 50 * MIN)
        .map((l) => l.line);
      assert.deepEqual(expected, [1, 2, 3, 4, 21, 22, 23, 24, 31, 38, 42]);
      assert.deepEqual(
        await matching(ENGAGEMENT, { range: { at: { gte: 'now-1h' } } }),
        expected,
      );
    });

    test('relative time: `now-720h` and `now-30d` are the same bound', async function (assert) {
      assert.deepEqual(
        await matching(IMPRESSIONS, { range: { at: { gte: 'now-720h' } } }),
        await matching(IMPRESSIONS, { range: { at: { gte: 'now-30d' } } }),
      );
    });

    // -----------------------------------------------------------------------
    // 3. Sort
    // -----------------------------------------------------------------------

    const sortCases: {
      rule: string;
      log?: string;
      sort: Sort;
      filter?: Row;
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
      { rule: 'by line ascending', sort: [{ by: 'line', direction: 'asc' }] },
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
        rule: 'by a negative and fractional number',
        sort: [{ by: 'what.score' }],
      },
      {
        rule: 'by text in the entry',
        log: IMPRESSIONS,
        sort: [{ by: 'what.surface' }],
      },
      {
        rule: 'by text in the entry descending, ties in file order',
        sort: [{ by: 'what.action', direction: 'desc' }],
      },
      {
        rule: 'by a deeper path',
        sort: [{ by: 'what.meta.device.os' }],
      },
      { rule: 'by actor, lines without one last', sort: [{ by: 'actor' }] },
      {
        rule: 'by actor descending, lines without one still last',
        sort: [{ by: 'actor', direction: 'desc' }],
      },
      {
        rule: 'by two keys, the second breaking ties in the first',
        log: IMPRESSIONS,
        sort: [
          { by: 'what.surface' },
          { by: 'what.position', direction: 'desc' },
        ],
      },
      {
        rule: 'by three keys of mixed direction',
        log: IMPRESSIONS,
        sort: [
          { by: 'actor', direction: 'desc' },
          { by: 'what.surface' },
          { by: 'at', direction: 'desc' },
        ],
      },
      {
        rule: 'by a key no line has is file order',
        sort: [{ by: 'what.nothingHere', direction: 'desc' }],
      },
      {
        rule: 'a filter then a sort',
        filter: { in: { 'what.action': ['like', 'share'] } },
        sort: [{ by: 'what.dwellMs', direction: 'desc' }, { by: 'at' }],
      },
    ];

    for (let { rule, log = ENGAGEMENT, sort, filter } of sortCases) {
      test(`sort: ${rule}`, async function (assert) {
        let expected = sorted(keep(fixtureOf(log).lines, filter, t0), sort).map(
          (l) => l.line,
        );
        let result = await search(log, {
          ...(filter ? { filter } : {}),
          sort,
          page: { size: 1000 },
        });
        assert.deepEqual(lineNumbers(result.data), expected);
      });
    }

    test('sort: duplicates and same-instant lines keep file order under a descending sort', async function (assert) {
      let result = await search(ENGAGEMENT, {
        filter: { eq: { at: iso(t0 - 4 * DAY) } },
        sort: [{ by: 'at', direction: 'desc' }],
      });
      assert.deepEqual(lineNumbers(result.data), [12, 39, 40, 41]);
    });

    // -----------------------------------------------------------------------
    // 4. Paging
    // -----------------------------------------------------------------------

    const PAGED_SORT: Sort = [
      { by: 'what.surface' },
      { by: 'what.position', direction: 'desc' },
    ];

    for (let size of [1, 5, 7, 48, 50]) {
      test(`paging: pages of ${size} laid end to end are the whole, with no line twice and none left out`, async function (assert) {
        let expected = sorted(impressions.lines, PAGED_SORT).map((l) => l.line);
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
            `page ${number}`,
          );
          assert.strictEqual(
            page.meta.page.hasMore,
            number < pages - 1,
            `hasMore on page ${number}`,
          );
          seen.push(...lineNumbers(page.data));
        }
        assert.deepEqual(seen, expected);
        assert.strictEqual(new Set(seen).size, expected.length);
      });
    }

    for (let size of [1, 4, 5, 16, 17]) {
      test(`paging: following hasMore with pages of ${size} and total 'none' visits every matching line once`, async function (assert) {
        let filter = { eq: { 'what.surface': 'home' } };
        let sort: Sort = [{ by: 'at', direction: 'desc' }];
        let expected = sorted(keep(impressions.lines, filter, t0), sort).map(
          (l) => l.line,
        );
        assert.strictEqual(expected.length, 16, 'the fixture');
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
            `total 'none' is the rows seen so far (page ${number})`,
          );
          assert.strictEqual(
            hasWarning(page.meta, 'total-estimated'),
            page.meta.page.hasMore,
            'the total is a lower bound exactly while more follows',
          );
          if (!page.meta.page.hasMore) {
            break;
          }
          if (requests > 40) {
            throw new Error('hasMore never turned false');
          }
        }
        assert.deepEqual(seen, expected);
        assert.strictEqual(
          requests,
          Math.ceil(expected.length / size),
          'no empty last request: hasMore is true exactly when a next page has rows',
        );
      });
    }

    test('paging: the total mode never changes the rows or hasMore', async function (assert) {
      let filter = { not: { eq: { 'what.surface': 'search' } } };
      let expected = keep(impressions.lines, filter, t0).map((l) => l.line);
      assert.strictEqual(expected.length, 32, 'the fixture');
      for (let [size, number] of [
        [10, 0],
        [10, 3],
        [32, 0],
        [5, 6],
        [1, 31],
      ]) {
        let rows = expected.slice(number * size, (number + 1) * size);
        let more = (number + 1) * size < expected.length;
        for (let total of ['none', 'capped', 'exact']) {
          let page = await search(IMPRESSIONS, {
            filter,
            page: { size, number, total },
          });
          let label = `size ${size}, page ${number}, total ${total}`;
          assert.deepEqual(lineNumbers(page.data), rows, label);
          assert.strictEqual(page.meta.page.hasMore, more, `hasMore: ${label}`);
          if (total !== 'none' || !more) {
            assert.strictEqual(
              page.meta.page.total,
              expected.length,
              `total: ${label}`,
            );
            assert.false(
              hasWarning(page.meta, 'total-estimated'),
              `exact: ${label}`,
            );
          }
        }
      }
    });

    test('paging: with no page named, the first 50 come back and the total is capped-mode exact', async function (assert) {
      let whole = await search(BIG);
      assert.deepEqual(
        lineNumbers(whole.data),
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
      assert.true(whole.meta.page.hasMore);
      assert.strictEqual(
        whole.meta.page.total,
        Math.min(1003, SEARCH_TOTAL_CAP),
      );
      assert.strictEqual(
        hasWarning(whole.meta, 'total-estimated'),
        1003 > SEARCH_TOTAL_CAP,
      );
    });

    for (let total of ['none', 'capped', 'exact']) {
      test(`paging: a page past the end is empty, has no more, and its total is the true count (total '${total}')`, async function (assert) {
        // docs/search.md, "Pagination": "A page with no next page is always
        // counted exactly, whatever the mode."
        let page = await search(IMPRESSIONS, {
          page: { size: 10, number: 99, total },
        });
        assert.deepEqual(page.data, []);
        assert.false(page.meta.page.hasMore);
        assert.strictEqual(page.meta.page.total, 48);
        assert.false(hasWarning(page.meta, 'total-estimated'));
      });
    }

    test('paging: a page of size 0 returns no rows and still counts', async function (assert) {
      let page = await search(IMPRESSIONS, {
        filter: { eq: { 'what.surface': 'home' } },
        page: { size: 0, total: 'exact' },
      });
      assert.deepEqual(page.data, []);
      assert.strictEqual(page.meta.page.total, 16);
    });

    test('paging: a page holds at most 1,000 lines, and the next page carries on from there', async function (assert) {
      let first = await search(BIG, { page: { size: 5000 } });
      assert.deepEqual(
        lineNumbers(first.data),
        Array.from({ length: 1000 }, (_, i) => i + 1),
      );
      assert.true(first.meta.page.hasMore);
      let second = await search(BIG, { page: { size: 5000, number: 1 } });
      assert.deepEqual(lineNumbers(second.data), [1001, 1002, 1003]);
      assert.false(second.meta.page.hasMore);
      assert.strictEqual(
        second.meta.page.total,
        1003,
        'a last page counts exactly',
      );
    });

    test('paging: capped counts up to the cap and says so, exact counts all, none counts the rows seen', async function (assert) {
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
    // 5. select
    // -----------------------------------------------------------------------

    test('select: a row is its line number and the named paths, nothing else', async function (assert) {
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
      assert.deepEqual(
        result.data,
        engagement.lines.map((l) => {
          let row: Row = { line: l.line };
          for (let path of paths) {
            row[path] = valueAt(l, path) ?? null;
          }
          return row;
        }),
      );
      assert.deepEqual(
        Object.keys(result.data[0]).sort(),
        ['line', ...paths].sort(),
      );
    });

    test('select: a path with no value reads null, whether absent, JSON null, or under a `what` that is not an object', async function (assert) {
      let result = await search(ENGAGEMENT, {
        filter: { in: { line: [30, 31, 36, 37, 43] } },
        select: ['what.topic', 'what.meta.device.os'],
      });
      assert.deepEqual(result.data, [
        // 30: i = 29, topic 'cooking', os 'web'.
        { line: 30, 'what.topic': 'cooking', 'what.meta.device.os': 'web' },
        { line: 31, 'what.topic': null, 'what.meta.device.os': 'web' },
        { line: 36, 'what.topic': null, 'what.meta.device.os': null },
        { line: 37, 'what.topic': null, 'what.meta.device.os': null },
        { line: 43, 'what.topic': null, 'what.meta.device.os': null },
      ]);
    });

    test('select: a path may name a whole object or list, and unicode comes back intact', async function (assert) {
      let result = await search(ENGAGEMENT, {
        filter: { eq: { line: 38 } },
        select: ['what.meta', 'what.meta.tags', 'what.note', 'line'],
      });
      assert.deepEqual(result.data, [
        {
          line: 38,
          'what.meta': { device: { os: 'ios' }, tags: ['ünï', 'a'] },
          'what.meta.tags': ['ünï', 'a'],
          'what.note': UNICODE_NOTE,
        },
      ]);
    });

    test('select: with not eq, a sort and total none (a table of the newest reactions)', async function (assert) {
      let filter = { not: { eq: { 'what.action': 'skip' } } };
      let sort: Sort = [{ by: 'at', direction: 'desc' }];
      let paths = ['what.postUri', 'what.action', 'what.atMs', 'what.topic'];
      let expected = sorted(keep(engagement.lines, filter, t0), sort);
      let result = await search(ENGAGEMENT, {
        filter,
        select: paths,
        sort,
        page: { size: 500, total: 'none' },
      });
      assert.deepEqual(
        result.data,
        expected.map((l) => {
          let row: Row = { line: l.line };
          for (let path of paths) {
            row[path] = valueAt(l, path) ?? null;
          }
          return row;
        }),
      );
      assert.false(result.meta.page.hasMore);
      assert.strictEqual(result.meta.page.total, expected.length);
    });

    test('select: pages of a selection lay end to end like pages of whole lines', async function (assert) {
      let seen: unknown[] = [];
      for (let number = 0; number < 5; number++) {
        let page = await search(IMPRESSIONS, {
          select: ['what.position'],
          sort: [{ by: 'what.position', direction: 'desc' }],
          page: { size: 10, number },
        });
        seen.push(...lineNumbers(page.data));
      }
      assert.deepEqual(
        seen,
        sorted(impressions.lines, [
          { by: 'what.position', direction: 'desc' },
        ]).map((l) => l.line),
      );
    });

    test('select: an empty list selects nothing, so whole lines come back (pins current behavior; rule not yet decided)', async function (assert) {
      let result = await search(AUDIT, { select: [] });
      assert.deepEqual(result.data, audit.lines.map(fullRow));
    });

    // -----------------------------------------------------------------------
    // 6. group and aggregates
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

    test('group: count per actor over the last week; lines with no actor form one group under null (pins current behavior; rule not yet decided)', async function (assert) {
      let filter = { range: { at: { gte: 'now-1w' } } };
      let aggregates = {
        n: { count: true },
        score: { sum: 'what.score' },
        mean: { avg: 'what.score' },
      };
      let expected = grouped(
        keep(engagement.lines, filter, t0),
        ['actor'],
        aggregates,
      );
      assert.strictEqual(
        expected.filter((r) => r.group.actor === null).length,
        1,
        'the oracle has one null group',
      );
      let result = await search(ENGAGEMENT, {
        filter,
        group: { by: 'actor', aggregates },
        sort: [{ by: 'n', direction: 'desc' }],
      });
      assert.deepEqual(asSet(result.data), asSet(expected));
      let counts = result.data.map((r) => r.n as number);
      assert.deepEqual(
        counts,
        [...counts].sort((a, b) => b - a),
        'largest count first',
      );
    });

    test('group: by two paths, sorted by one group path descending then the other', async function (assert) {
      let filter = { every: [HAS_ACTION, { exists: 'what.postUri' }] };
      let by = ['what.postUri', 'what.action'];
      let expected = grouped(keep(engagement.lines, filter, t0), by, {
        n: { count: true },
      }).sort(
        (a, b) =>
          -compareValues(a.group[by[0]], b.group[by[0]], by[0]) ||
          compareValues(a.group[by[1]], b.group[by[1]], by[1]),
      );
      let result = await search(ENGAGEMENT, {
        filter,
        group: { by, aggregates: { n: { count: true } } },
        sort: [
          { by: 'what.postUri', direction: 'desc' },
          { by: 'what.action' },
        ],
        page: { size: 1000, total: 'exact' },
      });
      assert.deepEqual(result.data, expected);
      assert.strictEqual(result.meta.page.total, expected.length);
    });

    test('group: with no aggregates a row is only its group', async function (assert) {
      let result = await search(IMPRESSIONS, { group: { by: 'what.surface' } });
      assert.deepEqual(
        asSet(result.data),
        asSet(SURFACES.map((s) => ({ group: { 'what.surface': s } }))),
      );
    });

    test('group: sorted by an aggregate ascending, then by the group path', async function (assert) {
      let aggregates = { deepest: { max: 'what.position' } };
      let expected = grouped(
        impressions.lines,
        ['what.postUri'],
        aggregates,
      ).sort(
        (a, b) =>
          a.deepest - b.deepest ||
          compareValues(
            a.group['what.postUri'],
            b.group['what.postUri'],
            'what.postUri',
          ),
      );
      assert.strictEqual(expected.length, 8, 'eight posts');
      let result = await search(IMPRESSIONS, {
        group: { by: 'what.postUri', aggregates },
        sort: [{ by: 'deepest' }, { by: 'what.postUri' }],
      });
      assert.deepEqual(result.data, expected);
    });

    test('group: a group the filter leaves no lines in is absent', async function (assert) {
      let filter = { not: { in: { 'what.action': ['save', 'hide'] } } };
      let result = await search(ENGAGEMENT, {
        filter: { every: [filter, HAS_ACTION] },
        group: { by: 'what.action', aggregates: { n: { count: true } } },
      });
      let expected = grouped(
        keep(engagement.lines, { every: [filter, HAS_ACTION] }, t0),
        ['what.action'],
        { n: { count: true } },
      );
      assert.deepEqual(asSet(result.data), asSet(expected));
      assert.deepEqual(
        result.data.map((r) => (r.group as Row)['what.action']).sort(),
        ['like', 'share', 'skip'],
      );
      let nothing = await search(ENGAGEMENT, {
        filter: { eq: { 'what.action': 'impression' } },
        group: { by: 'what.action', aggregates: { n: { count: true } } },
        page: { total: 'exact' },
      });
      assert.deepEqual(nothing.data, []);
      assert.strictEqual(nothing.meta.page.total, 0);
    });

    test('group: lines with no value for the group path and lines whose value is JSON null are one group, not two', async function (assert) {
      let expected = grouped(engagement.lines, ['what.topic'], {
        n: { count: true },
      });
      // art, birds, cooking, café, and no topic.
      assert.strictEqual(expected.length, 5, 'the oracle');
      let result = await search(ENGAGEMENT, {
        group: { by: 'what.topic', aggregates: { n: { count: true } } },
        page: { total: 'exact' },
      });
      assert.deepEqual(asSet(result.data), asSet(expected));
      assert.strictEqual(result.meta.page.total, 5);
    });

    test('group: count of a path and distinct both skip a JSON null', async function (assert) {
      // Line 31 (like) and line 32 (save) hold `topic: null`.
      let filter = { in: { 'what.action': ['like', 'save'] } };
      let aggregates = {
        topics: { count: 'what.topic' },
        named: { distinct: 'what.topic' },
      };
      let expected = grouped(
        keep(engagement.lines, filter, t0),
        ['what.action'],
        aggregates,
      );
      let result = await search(ENGAGEMENT, {
        filter,
        group: { by: 'what.action', aggregates },
      });
      assert.deepEqual(asSet(result.data), asSet(expected));
    });

    test('group: an aggregate over a path no line in the group holds is null, and distinct is an empty list', async function (assert) {
      let aggregates = {
        n: { count: 'what.nothingHere' },
        low: { min: 'what.nothingHere' },
        high: { max: 'what.nothingHere' },
        sum: { sum: 'what.nothingHere' },
        mean: { avg: 'what.nothingHere' },
        all: { distinct: 'what.nothingHere' },
        newest: { latest: 'what.nothingHere' },
      };
      let result = await search(IMPRESSIONS, {
        group: { by: 'what.action', aggregates },
      });
      assert.deepEqual(result.data, [
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
      ]);
    });

    test('group: sum and avg read numbers only, so text that looks like a number adds nothing', async function (assert) {
      // `size` is 12 (line 44), 40 (line 45), "large" (38) and "12" (46).
      let result = await search(ENGAGEMENT, {
        filter: { exists: 'what.size' },
        group: {
          by: 'what.nothingHere',
          aggregates: {
            n: { count: 'what.size' },
            sum: { sum: 'what.size' },
            mean: { avg: 'what.size' },
          },
        },
      });
      assert.deepEqual(result.data, [
        { group: { 'what.nothingHere': null }, n: 4, sum: 52, mean: 26 },
      ]);
    });

    test('group: latest is the value on the newest line, the later line winning a tie in time', async function (assert) {
      // Lines 12, 39, 40 and 41 were written at the same instant.
      let result = await search(ENGAGEMENT, {
        filter: { eq: { at: iso(t0 - 4 * DAY) } },
        group: {
          by: 'at',
          aggregates: {
            newest: { latest: 'line' },
            post: { latest: 'what.postUri' },
            n: { count: true },
          },
        },
      });
      assert.deepEqual(result.data, [
        { group: { at: iso(t0 - 4 * DAY) }, newest: 41, post: 'p6', n: 4 },
      ]);
    });

    test('group: filter, relative range, group by two paths, sort by an aggregate, pages followed on hasMore (a reactions rollup)', async function (assert) {
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
        if (!page.meta.page.hasMore) {
          break;
        }
        if (requests > 40) {
          throw new Error('hasMore never turned false');
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
        if (!page.meta.page.hasMore) {
          break;
        }
        if (requests > 5) {
          throw new Error('hasMore never turned false');
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

    test('group: the total counts groups in every mode, and a page of groups has more when groups remain', async function (assert) {
      let by = ['what.postUri', 'what.surface'];
      let count = grouped(impressions.lines, by).length;
      for (let total of ['capped', 'exact']) {
        let page = await search(IMPRESSIONS, {
          group: { by },
          page: { size: 5, total },
        });
        assert.strictEqual(page.data.length, 5);
        assert.true(page.meta.page.hasMore);
        assert.strictEqual(page.meta.page.total, count, total);
      }
      let none = await search(IMPRESSIONS, {
        group: { by },
        page: { size: 5, number: 1, total: 'none' },
      });
      assert.strictEqual(none.meta.page.total, 10);
    });

    // -----------------------------------------------------------------------
    // 7. Facets
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

    test('facets: counts by action with a one-line page and total none (a counts-only read)', async function (assert) {
      let result = await search(ENGAGEMENT, {
        page: { size: 1, total: 'none' },
        facets: [{ by: 'what.action', size: 50 }],
      });
      assert.deepEqual(lineNumbers(result.data), [1], 'the page is one line');
      assertFacet(
        assert,
        result.meta.facets?.['what.action'],
        facetCounts(engagement.lines, (l) => valueAt(l, 'what.action')),
        50,
        'action',
      );
    });

    test('facets: counts cover the filtered lines, not the page and not the whole log', async function (assert) {
      let filter = {
        every: [
          { range: { at: { gte: 'now-1w' } } },
          { not: { eq: { actor: '@ada:test' } } },
        ],
      };
      let kept = keep(engagement.lines, filter, t0);
      assert.true(kept.length > 5, 'the filter keeps several lines');
      assert.true(kept.length < engagement.lines.length, 'and drops some');
      let result = await search(ENGAGEMENT, {
        filter,
        page: { size: 1, number: 2, total: 'none' },
        facets: [
          { by: 'what.action' },
          { by: 'actor' },
          { by: 'what.meta.device.os' },
          { by: 'what.pinned' },
          { by: 'what.score' },
        ],
      });
      assert.deepEqual(lineNumbers(result.data), [kept[2].line]);
      for (let path of [
        'what.action',
        'actor',
        'what.meta.device.os',
        'what.pinned',
        'what.score',
      ]) {
        assertFacet(
          assert,
          result.meta.facets?.[path],
          facetCounts(kept, (l) => valueAt(l, path)),
          20,
          path,
        );
      }
    });

    test('facets: `size` keeps the most common values', async function (assert) {
      let filter = { not: { eq: { 'what.surface': 'profile' } } };
      let result = await search(IMPRESSIONS, {
        filter,
        page: { size: 1 },
        facets: [{ by: 'what.postUri', size: 3 }],
      });
      assertFacet(
        assert,
        result.meta.facets?.['what.postUri'],
        facetCounts(keep(impressions.lines, filter, t0), (l) =>
          valueAt(l, 'what.postUri'),
        ),
        3,
        'postUri',
      );
      assert.strictEqual(result.meta.facets?.['what.postUri'].length, 3);
    });

    test('facets: `size` counts values, so lines with no value never take a place', async function (assert) {
      let expected = facetCounts(engagement.lines, (l) =>
        valueAt(l, 'what.topic'),
      );
      let missing = engagement.lines.filter(
        (l) => valueAt(l, 'what.topic') === undefined,
      ).length;
      assert.true(
        missing > expected[0].count,
        'the fixture: more lines have no topic than have any one topic',
      );
      let result = await search(ENGAGEMENT, {
        page: { size: 1 },
        facets: [{ by: 'what.topic', size: 1 }],
      });
      assertFacet(
        assert,
        result.meta.facets?.['what.topic'],
        expected,
        1,
        'topic',
      );
    });

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
        assertFacet(
          assert,
          result.meta.facets?.at,
          facetCounts(keep(lines, f, t0), day),
          100,
          log,
        );
      }
    });

    test('facets: with a selection or a grouping, the counts are still of the filtered lines', async function (assert) {
      let filter = { eq: { 'what.surface': 'search' } };
      let expected = facetCounts(keep(impressions.lines, filter, t0), (l) =>
        valueAt(l, 'actor'),
      );
      let selected = await search(IMPRESSIONS, {
        filter,
        select: ['actor'],
        page: { size: 2 },
        facets: [{ by: 'actor' }],
      });
      assertFacet(assert, selected.meta.facets?.actor, expected, 20, 'select');
      let groupedResult = await search(IMPRESSIONS, {
        filter,
        group: { by: 'what.postUri' },
        page: { size: 2 },
        facets: [{ by: 'actor' }],
      });
      assertFacet(
        assert,
        groupedResult.meta.facets?.actor,
        expected,
        20,
        'group',
      );
    });

    // -----------------------------------------------------------------------
    // 8 and 9. The empty log, and how a log is named
    // -----------------------------------------------------------------------

    test('an empty log answers no rows, a zero total, no more, and empty facets and groups', async function (assert) {
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

    test('a log no pass has synced is refused as not indexed when nothing can read it, never answered as empty', async function (assert) {
      let { status, body } = await logSearchResponse(dbAdapter, realmURL, {
        from: { log: 'Feed/never-written.jsonl' },
        facets: [{ by: 'actor' }],
      } as LogQuery);
      assert.strictEqual(status, 409);
      assert.strictEqual((body as Row).errors[0].code, 'log-not-indexed');
      assert.strictEqual((body as Row).data, undefined);
    });

    test('a log that does not exist is a 404 when the realm can read its files', async function (assert) {
      let { status, body } = await logSearchResponse(
        dbAdapter,
        realmURL,
        { from: { log: 'Feed/never-written.jsonl' } } as LogQuery,
        { readLogFile: async () => undefined },
      );
      assert.strictEqual(status, 404);
      assert.strictEqual((body as Row).errors[0].code, 'log-not-found');
    });

    test('an empty log answers as an empty log', async function (assert) {
      let { status, body } = await logSearchResponse(dbAdapter, realmURL, {
        from: { log: EMPTY },
        facets: [{ by: 'actor' }],
      } as LogQuery);
      assert.strictEqual(status, 200);
      assert.deepEqual(body, {
        data: [],
        meta: {
          page: { total: 0, hasMore: false },
          facets: { actor: [] },
          log: `${realmURL}${EMPTY}`,
        },
      });
    });

    // -----------------------------------------------------------------------
    // 10. Refusals
    // -----------------------------------------------------------------------

    // A refused query is a 400 with the card grammar's code for the mistake
    // (`unknown-key` with the nearest name, `invalid-value`, `invalid-page`,
    // `missing-member`, `conflicting-members`, `limit-exceeded`) and a
    // message that names what was wrong. A query that throws anything else would be
    // a 500 on the wire; that is recorded as a crash.
    async function refusal(body: Row, adapter: DBAdapter = dbAdapter) {
      try {
        let { status, body: answer } = await logSearchResponse(
          adapter,
          realmURL,
          body as LogQuery,
        );
        let error = (answer as Row)?.errors?.[0];
        return {
          status,
          code: error?.code as string | undefined,
          message: (error?.message ?? '') as string,
          crash: undefined as string | undefined,
        };
      } catch (e: any) {
        return {
          status: 500,
          code: undefined,
          message: '',
          crash: `${e?.name}: ${e?.message}`,
        };
      }
    }

    test('a NUL character or an unpaired surrogate anywhere in the query is refused, not sent to Postgres', async function (assert) {
      // Postgres stores neither in text or jsonb, so sent they surface as a
      // raw SQLSTATE (22P05, 22021) instead of a refusal.
      let bad = ['a\u0000b', '\uD800', '\uDC00', 'a\uD83Db', '\uDC00\uD800'];
      for (let text of bad) {
        let bodies: Row[] = [
          {
            from: { log: ENGAGEMENT },
            filter: { eq: { 'what.action': text } },
          },
          { from: { log: ENGAGEMENT }, filter: { in: { actor: ['x', text] } } },
          { from: { log: ENGAGEMENT }, filter: { contains: { actor: text } } },
          {
            from: { log: ENGAGEMENT },
            filter: { not: { eq: { what: { action: text } } } },
          },
          { from: { log: `Feed/${text}.jsonl` } },
          { from: { log: ENGAGEMENT }, filter: { exists: text } },
        ];
        for (let body of bodies) {
          let answer = await refusal(body);
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
      let astral = await refusal({
        from: { log: ENGAGEMENT },
        filter: { eq: { 'what.action': '\u{1D11E}' } },
      });
      assert.strictEqual(astral.status, 200);
    });

    const BAD_PATH = 'what.post-uri';
    const badPath = /what\.post-uri/;

    const refusals: {
      rule: string;
      body: Row;
      names: RegExp;
      code?: string;
    }[] = [
      // Unknown members, at each level.
      ...[
        'type',
        'fields',
        'let',
        'collapse',
        'rerank',
        'realms',
        'cursor',
        'aggregates',
        'limit',
        'matches',
      ].map((member) => ({
        rule: `an unknown member "${member}" beside from`,
        body: { [member]: member === 'limit' ? 10 : {} },
        names: new RegExp(`"${member}"`),
      })),
      {
        rule: 'an unknown member inside from',
        code: 'unknown-key',
        body: { from: { log: ENGAGEMENT, realm: realmURL } },
        names: /from\.realm/,
      },
      {
        rule: 'an unknown member inside page',
        code: 'unknown-key',
        body: { page: { size: 10, cursor: 'abc' } },
        names: /cursor/,
      },
      {
        rule: "a card search's older `page.exactTotal`",
        code: 'unknown-key',
        body: { page: { size: 10, exactTotal: true } },
        names: /exactTotal/,
      },
      {
        rule: 'an unknown member inside a sort key',
        code: 'unknown-key',
        body: { sort: [{ by: 'at', missing: 'first' }] },
        names: /missing/,
      },
      {
        rule: 'an unknown member inside a facet (`stats`, which a card facet takes)',
        code: 'unknown-key',
        body: { facets: [{ by: 'what.action', stats: true }] },
        names: /stats/,
      },
      {
        rule: 'an unknown member inside a facet (`interval`, which a card facet takes)',
        code: 'unknown-key',
        body: { facets: [{ by: 'at', interval: 'month' }] },
        names: /interval/,
      },
      {
        rule: 'an unknown member inside group',
        code: 'unknown-key',
        body: { group: { by: 'what.action', having: { n: { gt: 1 } } } },
        names: /having/,
      },
      {
        rule: 'an unknown member beside a filter operator',
        code: 'unknown-key',
        body: { filter: { eq: { 'what.action': 'like' }, boost: 2 } },
        names: /boost/,
      },
      {
        rule: 'two operators in one filter, where only one would apply',
        code: 'conflicting-members',
        body: {
          filter: {
            eq: { 'what.action': 'like' },
            range: { 'what.dwellMs': { gte: 100000 } },
          },
        },
        names: /filter/i,
      },
      {
        rule: 'an unknown bound in a range',
        code: 'unknown-key',
        body: { filter: { range: { line: { between: [1, 2] } } } },
        names: /between/,
      },

      // Filter operators a card query takes and a log query does not.
      ...['matches', 'type', 'on', 'near', 'gt'].map((op) => ({
        rule: `the filter operator "${op}", which a log filter does not take`,
        body: { filter: { [op]: { 'what.action': 'like' } } },
        names: new RegExp(`\\b${op}\\b`),
      })),
      {
        rule: 'a filter with no operator',
        code: 'missing-member',
        body: { filter: {} },
        names: /filter/i,
      },

      // Wrong types.
      {
        rule: 'a filter that is text',
        code: 'invalid-value',
        body: { filter: 'like' },
        names: /filter/i,
      },
      {
        rule: 'a filter inside any that is a number',
        code: 'invalid-value',
        body: { filter: { any: [5] } },
        names: /filter/i,
      },
      {
        rule: 'a not over text',
        code: 'invalid-value',
        body: { filter: { not: 'like' } },
        names: /filter/i,
      },
      {
        rule: 'every over something that is not a list',
        code: 'invalid-value',
        body: { filter: { every: { eq: { 'what.action': 'like' } } } },
        names: /every/,
      },
      {
        rule: 'eq over null',
        code: 'invalid-value',
        body: { filter: { eq: null } },
        names: /eq/,
      },
      {
        rule: 'eq over text',
        code: 'invalid-value',
        body: { filter: { eq: 'like' } },
        names: /eq/,
      },
      {
        rule: 'in over a value that is not a list',
        code: 'invalid-value',
        body: { filter: { in: { 'what.action': 'like' } } },
        names: /in\.what\.action/,
      },
      {
        rule: 'range over null',
        code: 'invalid-value',
        body: { filter: { range: null } },
        names: /range/,
      },
      {
        rule: 'range bounds that are a number, not { gt, gte, lt, lte }',
        code: 'invalid-value',
        body: { filter: { range: { line: 5 } } },
        names: /range|line/,
      },
      {
        rule: 'a range on line whose bound is not a number',
        code: 'invalid-value',
        body: { filter: { range: { line: { gte: 'ten' } } } },
        names: /line|ten/,
      },
      {
        rule: 'eq on line with a value that is not a number',
        code: 'invalid-value',
        body: { filter: { eq: { line: 'ten' } } },
        names: /line|ten/,
      },
      {
        rule: 'a time bound that is a boolean',
        code: 'invalid-value',
        body: { filter: { range: { at: { gte: true } } } },
        names: /time/i,
      },
      {
        rule: 'select that is one path, not a list',
        code: 'invalid-value',
        body: { select: 'what.action' },
        names: /select/,
      },
      {
        rule: 'select beside group',
        code: 'conflicting-members',
        body: { select: ['at'], group: { by: 'actor' } },
        names: /select.*group|group.*select/,
      },
      {
        rule: 'sort that is one key, not a list',
        code: 'invalid-value',
        body: { sort: { by: 'at' } },
        names: /sort/,
      },
      {
        rule: 'a sort key with no `by`',
        code: 'missing-member',
        body: { sort: [{ direction: 'desc' }] },
        names: /sort|by/,
      },
      {
        rule: 'a sort direction that is neither asc nor desc',
        code: 'invalid-value',
        body: { sort: [{ by: 'at', direction: 'descending' }] },
        names: /direction|descending/,
      },
      {
        rule: 'a page that is a number',
        code: 'invalid-page',
        body: { page: 5 },
        names: /page/,
      },
      {
        rule: 'a negative page size',
        code: 'invalid-page',
        body: { page: { size: -1 } },
        names: /page\.size/,
      },
      {
        rule: 'a fractional page size',
        code: 'invalid-page',
        body: { page: { size: 1.5 } },
        names: /page\.size/,
      },
      {
        rule: 'a page size that is a word',
        code: 'invalid-page',
        body: { page: { size: 'ten' } },
        names: /page\.size/,
      },
      {
        rule: 'a negative page number',
        code: 'invalid-page',
        body: { page: { number: -1 } },
        names: /page\.number/,
      },
      {
        rule: 'a fractional page number',
        code: 'invalid-page',
        body: { page: { number: 0.5 } },
        names: /page\.number/,
      },
      {
        rule: 'a page number past the bigint range of an offset',
        code: 'invalid-page',
        body: { page: { number: '9223372036854775808' } },
        names: /page\.number/,
      },
      {
        rule: 'a page number whose offset is past exact integers',
        code: 'invalid-page',
        body: { page: { number: 2 ** 50, size: 1000 } },
        names: /page\.number/,
      },
      {
        rule: 'a total mode that is not none, capped or exact',
        code: 'invalid-page',
        body: { page: { total: 'roughly' } },
        names: /total|roughly/,
      },
      {
        rule: 'facets that is one facet, not a list',
        code: 'invalid-value',
        body: { facets: { by: 'what.action' } },
        names: /facets/,
      },
      {
        rule: 'a facet with no `by`',
        code: 'missing-member',
        body: { facets: [{ size: 5 }] },
        names: /facet|by/,
      },
      {
        rule: 'a facet size that is a word',
        code: 'invalid-value',
        body: { facets: [{ by: 'what.action', size: 'many' }] },
        names: /size|many/,
      },
      {
        rule: 'group with an empty `by`',
        code: 'missing-member',
        body: { group: { by: [] } },
        names: /group\.by/,
      },
      {
        rule: 'group with no `by`',
        code: 'missing-member',
        body: { group: { aggregates: { n: { count: true } } } },
        names: /group|by/,
      },
      {
        rule: 'an aggregate name that is not a plain word',
        code: 'invalid-value',
        body: {
          group: { by: 'actor', aggregates: { 'last-at': { max: 'at' } } },
        },
        names: /last-at/,
      },
      {
        rule: 'an aggregate that is not one of the seven',
        code: 'unknown-key',
        body: {
          group: {
            by: 'actor',
            aggregates: { middle: { median: 'what.score' } },
          },
        },
        names: /middle/,
      },
      {
        rule: 'an aggregate naming two operations',
        code: 'conflicting-members',
        body: {
          group: {
            by: 'actor',
            aggregates: { both: { min: 'what.score', max: 'what.score' } },
          },
        },
        names: /both/,
      },
      {
        rule: 'an aggregate that is null',
        code: 'invalid-value',
        body: { group: { by: 'actor', aggregates: { nothing: null } } },
        names: /nothing/,
      },
      {
        rule: 'a sum of `true` rather than of a path',
        code: 'invalid-value',
        body: { group: { by: 'actor', aggregates: { whole: { sum: true } } } },
        names: /whole/,
      },
      {
        rule: 'a count of `false`',
        code: 'invalid-value',
        body: {
          group: { by: 'actor', aggregates: { tally: { count: false } } },
        },
        names: /tally/,
      },
      {
        rule: 'a grouped query sorted by a path that is neither grouped nor an aggregate',
        code: 'invalid-value',
        body: {
          group: { by: 'actor', aggregates: { n: { count: true } } },
          sort: [{ by: 'what.dwellMs' }],
        },
        names: /what\.dwellMs/,
      },
      {
        rule: 'a grouped query sorted by `at` when `at` is not grouped',
        code: 'invalid-value',
        body: { group: { by: 'actor' }, sort: [{ by: 'at' }] },
        names: /"at"/,
      },

      // Paths.
      {
        rule: 'a path with a hyphen, in eq',
        code: 'invalid-value',
        body: { filter: { eq: { [BAD_PATH]: 'p1' } } },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in in',
        code: 'invalid-value',
        body: { filter: { in: { [BAD_PATH]: ['p1'] } } },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in range',
        code: 'invalid-value',
        body: { filter: { range: { [BAD_PATH]: { gte: 1 } } } },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in contains',
        code: 'invalid-value',
        body: { filter: { contains: { [BAD_PATH]: 'p' } } },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in exists',
        code: 'invalid-value',
        body: { filter: { exists: BAD_PATH } },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in sort',
        code: 'invalid-value',
        body: { sort: [{ by: BAD_PATH }] },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in select',
        code: 'invalid-value',
        body: { select: [BAD_PATH] },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in a facet',
        code: 'invalid-value',
        body: { facets: [{ by: BAD_PATH }] },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in group.by',
        code: 'invalid-value',
        body: { group: { by: ['actor', BAD_PATH] } },
        names: badPath,
      },
      {
        rule: 'a path with a hyphen, in an aggregate',
        code: 'invalid-value',
        body: { group: { by: 'actor', aggregates: { n: { max: BAD_PATH } } } },
        names: badPath,
      },
      {
        rule: 'an empty path',
        code: 'invalid-value',
        body: { filter: { eq: { '': 'x' } } },
        names: /path/i,
      },
      {
        rule: 'a path with an empty segment',
        code: 'invalid-value',
        body: { filter: { eq: { 'what..action': 'like' } } },
        names: /what\.\.action/,
      },
      {
        rule: 'a path that starts with a dot',
        code: 'invalid-value',
        body: { sort: [{ by: '.what' }] },
        names: /\.what/,
      },
      {
        rule: 'a path that tries to carry SQL',
        code: 'invalid-value',
        body: {
          sort: [{ by: "what.action'); DROP TABLE boxel_log_lines; --" }],
        },
        names: /DROP TABLE/,
      },
      {
        // Pins current behavior; rule not yet decided: an item of a list is
        // not addressable by its position.
        rule: 'a path into a list by position',
        code: 'invalid-value',
        body: { filter: { eq: { 'what.meta.tags.0': 'a' } } },
        names: /what\.meta\.tags\.0/,
      },
      {
        // Pins current behavior; rule not yet decided: a key outside ASCII
        // letters, digits, `_` and `$` is not addressable.
        rule: 'a path with a non-ASCII key',
        code: 'invalid-value',
        body: { filter: { exists: 'what.café' } },
        names: /what\.café/,
      },

      // Times.
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
      ].map((time) => ({
        rule: `a time bound of ${JSON.stringify(time)}`,
        body: { filter: { range: { at: { gte: time } } } },
        names: new RegExp(time.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')),
      })),
      {
        rule: 'eq on at with a malformed relative time',
        code: 'invalid-value',
        body: { filter: { eq: { at: 'now-1x' } } },
        names: /now-1x/,
      },

      // The log itself.
      {
        rule: 'a file that is not a log (.json)',
        code: 'invalid-value',
        body: { from: { log: 'Feed/data.json' } },
        names: /Feed\/data\.json/,
      },
      {
        rule: 'a file that is not a log (no extension)',
        code: 'invalid-value',
        body: { from: { log: 'Feed/engagement' } },
        names: /Feed\/engagement/,
      },
      {
        rule: "a card's vector sidecar, which is JSON Lines but not a log",
        code: 'invalid-value',
        body: { from: { log: 'Feed/post.vectors.jsonl' } },
        names: /post\.vectors\.jsonl/,
      },
      {
        rule: 'an empty log name',
        code: 'invalid-value',
        body: { from: { log: '' } },
        names: /log/,
      },
      {
        rule: 'a relative path that climbs out of the realm',
        code: 'invalid-value',
        body: { from: { log: '../outside.jsonl' } },
        names: /outside\.jsonl/,
      },
      {
        rule: 'a log on another origin',
        code: 'invalid-value',
        body: {
          from: { log: 'https://elsewhere.example/Feed/engagement.jsonl' },
        },
        names: /elsewhere\.example/,
      },
      {
        rule: 'a log in a realm whose URL only starts like this one',
        code: 'invalid-value',
        body: {
          from: {
            log: 'http://log-cases-test/realm-two/Feed/engagement.jsonl',
          },
        },
        names: /realm-two/,
      },
    ];

    // The spread entries above name their rule in a template: an unknown
    // member, a filter operator a log does not take, or a time.
    // A card query's member or operator is refused as one a log does not
    // support; any other unknown name as unknown.
    const CARD_ONLY =
      /"(type|fields|let|collapse|rerank|realms|matches|on|near)"/;
    const codeOf = (rule: string) =>
      /unknown member|which a log filter does not take/.test(rule)
        ? CARD_ONLY.test(rule) &&
          !/unknown member "matches" beside from/.test(rule)
          ? 'not-supported-for-logs'
          : 'unknown-key'
        : 'invalid-value';

    for (let { rule, body, names, code = codeOf(rule) } of refusals) {
      test(`refused: ${rule} (${code})`, async function (assert) {
        let answer = await refusal({ from: { log: ENGAGEMENT }, ...body });
        assert.strictEqual(
          answer.crash,
          undefined,
          'the query is refused, not crashed',
        );
        assert.strictEqual(answer.status, 400, 'status');
        assert.strictEqual(answer.code, code, 'code');
        assert.true(
          names.test(answer.message),
          `the message names it (${names}): ${JSON.stringify(answer.message)}`,
        );
      });
    }

    test('refused: a log query on a database that is not Postgres', async function (assert) {
      let answer = await refusal({ from: { log: ENGAGEMENT } }, {
        kind: 'sqlite',
      } as unknown as DBAdapter);
      assert.strictEqual(answer.status, 400);
      assert.strictEqual(answer.code, 'needs-postgres');
      assert.true(/Postgres/.test(answer.message), answer.message);
    });

    test('a refusal leaves the next query unharmed', async function (assert) {
      await refusal({
        from: { log: ENGAGEMENT },
        filter: { range: { at: { gte: 'now-1x' } } },
      });
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

    test('handler: a log search naming more than one realm is a 400 that returns no lines', async function (assert) {
      let other = 'http://log-cases-test/other/';
      let { ctxt, koa, json } = fakeContext();
      await respondToLogSearch(
        koa,
        HANDLER_QUERY,
        [realmURL, other],
        [realmURL, other],
        dbAdapter,
      );
      assert.strictEqual(ctxt.status, 400);
      assert.strictEqual(json().data, undefined);
      assert.true(
        /one realm/.test(JSON.stringify(json())),
        JSON.stringify(json()),
      );
    });

    test('handler: a log search naming no realm is a 400', async function (assert) {
      let { ctxt, koa, json } = fakeContext();
      await respondToLogSearch(koa, HANDLER_QUERY, [], [realmURL], dbAdapter);
      assert.strictEqual(ctxt.status, 400);
      assert.strictEqual(json().data, undefined);
    });

    test('handler: a log search on a realm the caller cannot read is a 403 that returns no lines', async function (assert) {
      let { ctxt, koa, json } = fakeContext();
      await respondToLogSearch(
        koa,
        HANDLER_QUERY,
        [realmURL],
        ['http://log-cases-test/other/'],
        dbAdapter,
      );
      assert.strictEqual(ctxt.status, 403);
      assert.strictEqual(json().data, undefined);
      assert.true(
        /read access/.test(JSON.stringify(json())),
        JSON.stringify(json()),
      );
    });

    test('handler: a log search on the one realm the caller reads answers the lines', async function (assert) {
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

    test('handler: a query the log grammar refuses is a 400 with its code', async function (assert) {
      let { ctxt, koa, json } = fakeContext();
      await respondToLogSearch(
        koa,
        { ...HANDLER_QUERY, collapse: { by: 'actor' } } as unknown as LogQuery,
        [realmURL],
        [realmURL],
        dbAdapter,
      );
      assert.strictEqual(ctxt.status, 400);
      assert.strictEqual(json().errors[0].code, 'not-supported-for-logs');
      assert.true(/"collapse"/.test(json().errors[0].message));
    });
  });
});
