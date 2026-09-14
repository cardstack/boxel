#!/usr/bin/env node
/**
 * shift-realm-dates.mjs — uniformly translate every date in a realm's card
 * instances so that demo activity lands on "today" while all dates keep
 * their offsets relative to each other.
 *
 * Works on a local workspace directory produced by `boxel realm pull`.
 * Typical runbook (using a staging demo realm as the example):
 *
 *   boxel profile switch @you:stack.cards
 *   boxel realm pull https://realms-staging.stack.cards/example-user/demo-realm/ ./demo-realm
 *   node scripts/shift-realm-dates.mjs analyze ./demo-realm   # optional: inspect first
 *   node scripts/shift-realm-dates.mjs apply ./demo-realm
 *   boxel realm push --dry-run ./demo-realm https://realms-staging.stack.cards/example-user/demo-realm/
 *   boxel realm push ./demo-realm https://realms-staging.stack.cards/example-user/demo-realm/
 *
 * Modes:
 *   analyze <dir>   Inventory every date-bearing attribute across *.json card
 *                   instances: field paths, value ranges, a per-date histogram
 *                   with weekdays, prose (non-ISO) date mentions it will NOT
 *                   touch, and a suggested --anchor.
 *   apply <dir>     Shift dates. Every ISO date (bare
 *                   YYYY-MM-DD values, datetime prefixes, and ISO dates
 *                   embedded inside longer strings) found under each card's
 *                   `attributes` is moved by (target - anchor) days.
 *                   Times of day are preserved. Afterwards the script
 *                   re-scans and verifies every value moved by exactly the
 *                   delta.
 *
 * Options for apply:
 *   --anchor YYYY-MM-DD    The date in the data that represents "demo today";
 *                          it will be mapped onto --target. Defaults to the
 *                          most recent timestamp date in the data (timestamps
 *                          record things that already happened, so their max
 *                          is where demo activity currently sits). Pass it
 *                          explicitly only when that heuristic is wrong for
 *                          your data.
 *   --target YYYY-MM-DD    Defaults to today (local time).
 *   --preserve-weekday     Round the shift down to a multiple of 7 days so
 *                          every date keeps its weekday. The anchor then maps
 *                          to the most recent same-weekday on or before the
 *                          target (up to 6 days earlier).
 *   --rename-files         Also rename instance files whose basename embeds
 *                          an ISO date (e.g. DailyPlan/2a-2026-08-05-x.json).
 *                          Off by default; only safe when nothing links to
 *                          those files by URL. Requires `realm push --delete`
 *                          (or `realm sync --delete`) for the old names to be
 *                          removed remotely.
 *   --dry-run              Report what would change without writing.
 *
 * Prose dates ("Oct 14", "April 5, 2026") inside attribute strings are also
 * shifted by default (disable with --no-prose). A year-less prose date is
 * interpreted as the most recent such date on or before the anchor — right
 * for fields that record things that happened (observation dates, evidence
 * probes), which is what year-less prose dates are in practice. The rendered
 * result keeps the original's style (abbreviated vs. full month, explicit
 * year kept if present, no year invented). Apply prints every distinct
 * prose mapping it made so you can eyeball the inferences.
 *
 * What is deliberately NOT touched:
 *   - Anything outside `data.attributes` / `included[].attributes`
 *     (relationship links, meta, ids stay untouched).
 *   - Non-JSON files (.gts modules, .md docs) — analyze reports ISO dates
 *     found in .md files so you can update them by hand if they matter.
 *   - Attribute paths listed in EXCLUDE_PATHS below.
 *
 * Note that a uniform shift preserves every duration — ages, goal spans,
 * "days since enrollment" all stay constant relative to demo-today. That is
 * usually what you want, so EXCLUDE_PATHS ships empty. If you'd rather pin
 * biographical dates in place (birthdays, hire dates), add their paths, e.g.:
 *   'Contact:dateOfBirth', 'EmployeeProfile:identity.hireDate'
 * The format is '<TypeDir>:<dot.path>' or just '<dot.path>' to match any type
 * (array hops are flattened, so an entry inside a list is just its key path).
 */

import fs from 'node:fs';
import path from 'node:path';

const EXCLUDE_PATHS = [];

const ISO_DATE_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ABBREV = MONTH_FULL.map((m) => m.slice(0, 3));
const MONTH_PROSE_RE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(\.?) (\d{1,2})(?!\d)(, (\d{4}))?/g;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    'usage: shift-realm-dates.mjs analyze <workspace-dir>\n' +
      '       shift-realm-dates.mjs apply <workspace-dir> [--anchor YYYY-MM-DD]\n' +
      '           [--target YYYY-MM-DD] [--preserve-weekday] [--rename-files] [--no-prose] [--dry-run]',
  );
  process.exit(1);
}

function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (
    d.getUTCFullYear() !== +m[1] ||
    d.getUTCMonth() !== +m[2] - 1 ||
    d.getUTCDate() !== +m[3]
  ) {
    return null;
  }
  return d;
}

function formatISODate(d) {
  return d.toISOString().slice(0, 10);
}

function shiftISODate(dateStr, deltaDays) {
  const d = parseISODate(dateStr);
  if (!d) return dateStr; // not a real calendar date (e.g. 2026-13-45): leave it
  return formatISODate(new Date(d.getTime() + deltaDays * MS_PER_DAY));
}

function monthIndexOf(token) {
  const t = token.replace(/\.$/, '').toLowerCase();
  let idx = MONTH_FULL.findIndex((m) => m.toLowerCase() === t);
  if (idx < 0) idx = MONTH_ABBREV.findIndex((m) => m.toLowerCase() === t);
  if (idx < 0 && t === 'sept') idx = 8;
  return idx;
}

/**
 * Replace prose dates ("Oct 14", "Sept 3.", "April 5, 2026") in a string,
 * shifting each by deltaDays. A year-less date is read as the most recent
 * occurrence on or before the anchor. Rendering keeps the original style:
 * abbreviated months stay abbreviated (with their period), full names stay
 * full, and a year appears only if the original had one. Each mapping is
 * tallied into mappings ("Oct 14 -> Nov 23" -> count).
 */
function shiftProseDates(value, deltaDays, anchor, mappings) {
  return value.replace(
    MONTH_PROSE_RE,
    (whole, monthToken, period, dayStr, _yearPart, yearStr) => {
      const monthIdx = monthIndexOf(monthToken);
      const day = +dayStr;
      if (monthIdx < 0 || day < 1 || day > 31) return whole;
      let year = yearStr ? +yearStr : anchor.getUTCFullYear();
      let d = new Date(Date.UTC(year, monthIdx, day));
      if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) return whole; // e.g. Feb 30
      if (!yearStr && d.getTime() > anchor.getTime()) {
        d = new Date(Date.UTC(year - 1, monthIdx, day));
        if (d.getUTCMonth() !== monthIdx) return whole; // Feb 29 in a non-leap prior year
      }
      const shifted = new Date(d.getTime() + deltaDays * MS_PER_DAY);
      // Full-name tokens keep full names; abbreviations (incl. "Sept" and
      // the ambiguous "May") render as three-letter abbreviations.
      const t = monthToken.toLowerCase();
      const fullStyle =
        t !== 'may' && MONTH_FULL.some((m) => m.toLowerCase() === t);
      const monthOut = fullStyle
        ? MONTH_FULL[shifted.getUTCMonth()]
        : MONTH_ABBREV[shifted.getUTCMonth()];
      const out = `${monthOut}${period} ${shifted.getUTCDate()}${yearStr ? `, ${shifted.getUTCFullYear()}` : ''}`;
      mappings?.set(`${whole} -> ${out}`, (mappings.get(`${whole} -> ${out}`) ?? 0) + 1);
      return out;
    },
  );
}

function weekday(dateStr) {
  const d = parseISODate(dateStr);
  return d ? d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : '???';
}

function todayLocalISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Yields { file (abs), rel, doc } for every parseable .json under dir. */
function* jsonFiles(root) {
  const skipDirs = new Set(['.boxel-history', 'node_modules', '.git']);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(abs);
      } else if (entry.name.endsWith('.json')) {
        let doc;
        try {
          doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
        } catch {
          console.warn(`warning: skipping unparseable JSON: ${path.relative(root, abs)}`);
          continue;
        }
        yield { file: abs, rel: path.relative(root, abs), doc };
      }
    }
  }
}

function typeDirOf(rel) {
  return rel.includes(path.sep) ? rel.split(path.sep)[0] : '(root)';
}

function isExcluded(typeDir, dotPath) {
  return EXCLUDE_PATHS.some(
    (e) => e === dotPath || e === `${typeDir}:${dotPath}`,
  );
}

/**
 * Walk every string value under the attributes objects of a card document,
 * calling visit(stringValue, dotPath) and replacing the value with its
 * return when it differs. Returns the number of replacements.
 */
function visitAttributeStrings(doc, typeDir, visit) {
  let changes = 0;
  function walk(node, dotPath) {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (typeof v === 'string') {
          const next = visitValue(v, dotPath);
          if (next !== v) {
            node[i] = next;
            changes++;
          }
        } else {
          walk(v, dotPath);
        }
      });
    } else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        const childPath = dotPath ? `${dotPath}.${key}` : key;
        const v = node[key];
        if (typeof v === 'string') {
          const next = visitValue(v, childPath);
          if (next !== v) {
            node[key] = next;
            changes++;
          }
        } else {
          walk(v, childPath);
        }
      }
    }
  }
  function visitValue(value, dotPath) {
    if (isExcluded(typeDir, dotPath)) return value;
    return visit(value, dotPath);
  }
  const resources = [];
  if (doc?.data) resources.push(doc.data);
  if (Array.isArray(doc?.included)) resources.push(...doc.included);
  for (const resource of resources) {
    if (resource?.attributes) walk(resource.attributes, '');
  }
  return changes;
}

/** Collect [{dotPath, value}] for every ISO-date-bearing string. */
function collectDates(doc, typeDir) {
  const found = [];
  visitAttributeStrings(doc, typeDir, (value, dotPath) => {
    for (const m of value.matchAll(ISO_DATE_RE)) {
      found.push({ dotPath, date: m[0], whole: value });
    }
    return value; // no mutation
  });
  return found;
}

/**
 * The data's own "today": the most recent date appearing in a datetime
 * value. Timestamps record things that already happened, so their max is
 * where demo activity currently sits.
 */
function detectAnchor(root) {
  let max = null;
  for (const { rel, doc } of jsonFiles(root)) {
    for (const { date, whole } of collectDates(doc, typeDirOf(rel))) {
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(whole)) {
        if (!max || date > max) max = date;
      }
    }
  }
  return max;
}

function analyze(root) {
  const byField = new Map(); // `${typeDir}|${dotPath}` -> [dates]
  const histogram = new Map(); // date -> count
  const prose = new Map(); // `${typeDir}|${dotPath}` -> count
  let timestampMax = null;
  let fileCount = 0;
  const datedFilenames = [];

  for (const { rel, doc } of jsonFiles(root)) {
    fileCount++;
    const typeDir = typeDirOf(rel);
    if (path.basename(rel).match(ISO_DATE_RE)) datedFilenames.push(rel);
    for (const { dotPath, date, whole } of collectDates(doc, typeDir)) {
      const key = `${typeDir}|${dotPath}`;
      if (!byField.has(key)) byField.set(key, []);
      byField.get(key).push(date);
      histogram.set(date, (histogram.get(date) ?? 0) + 1);
      // a datetime records something that happened, so its max is a good
      // guess at the data's "today"
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(whole)) {
        if (!timestampMax || date > timestampMax) timestampMax = date;
      }
    }
    visitAttributeStrings(doc, typeDir, (value, dotPath) => {
      const matches = value.match(MONTH_PROSE_RE);
      if (matches) {
        const key = `${typeDir}|${dotPath}`;
        prose.set(key, (prose.get(key) ?? 0) + matches.length);
      }
      return value;
    });
  }

  console.log(`Scanned ${fileCount} JSON files under ${root}\n`);
  console.log('ISO dates by field (type dir | attribute path | count | min..max):');
  for (const [key, dates] of [...byField.entries()].sort()) {
    const [typeDir, dotPath] = key.split('|');
    dates.sort();
    console.log(
      `  ${typeDir.padEnd(22)} ${dotPath.padEnd(42)} n=${String(dates.length).padStart(3)}  ${dates[0]} .. ${dates[dates.length - 1]}`,
    );
  }

  console.log('\nDate histogram:');
  for (const [date, count] of [...histogram.entries()].sort()) {
    console.log(`  ${date} ${weekday(date)} ${'#'.repeat(Math.min(count, 60))} (${count})`);
  }

  if (prose.size) {
    console.log('\nProse date mentions (shifted by apply unless --no-prose):');
    for (const [key, count] of [...prose.entries()].sort()) {
      const [typeDir, dotPath] = key.split('|');
      console.log(`  ${typeDir.padEnd(22)} ${dotPath.padEnd(42)} n=${count}`);
    }
  }

  if (datedFilenames.length) {
    console.log(
      `\n${datedFilenames.length} instance filename(s) embed an ISO date (shift with --rename-files if desired):`,
    );
    for (const f of datedFilenames) console.log(`  ${f}`);
  }

  const mdWithDates = [];
  for (const entry of fs.readdirSync(root)) {
    if (entry.endsWith('.md')) {
      const text = fs.readFileSync(path.join(root, entry), 'utf8');
      const n = (text.match(ISO_DATE_RE) ?? []).length;
      if (n) mdWithDates.push(`${entry} (${n})`);
    }
  }
  if (mdWithDates.length) {
    console.log(`\nMarkdown docs containing ISO dates (not shifted): ${mdWithDates.join(', ')}`);
  }

  if (timestampMax) {
    console.log(
      `\nSuggested anchor: ${timestampMax} (${weekday(timestampMax)}) — the most recent timestamp date in the data.`,
    );
    console.log(
      `  apply with: node scripts/shift-realm-dates.mjs apply <dir> --anchor ${timestampMax}`,
    );
  }
}

function apply(root, opts) {
  if (!opts.anchor) {
    opts.anchor = detectAnchor(root);
    if (!opts.anchor) {
      usage(
        'no datetime values found to auto-detect an anchor from — pass --anchor YYYY-MM-DD (run analyze to explore)',
      );
    }
    console.log(
      `Auto-detected anchor: ${opts.anchor} (most recent timestamp date; override with --anchor)`,
    );
  }
  const anchor = parseISODate(opts.anchor);
  if (!anchor) usage(`--anchor is not a valid date: ${opts.anchor}`);
  const targetStr = opts.target ?? todayLocalISO();
  const target = parseISODate(targetStr);
  if (!target) usage(`--target is not a valid date: ${targetStr}`);

  let deltaDays = Math.round((target.getTime() - anchor.getTime()) / MS_PER_DAY);
  if (opts.preserveWeekday) {
    deltaDays = Math.floor(deltaDays / 7) * 7;
  }
  const anchorLandsOn = shiftISODate(opts.anchor, deltaDays);
  console.log(
    `Shifting all dates by ${deltaDays >= 0 ? '+' : ''}${deltaDays} days: anchor ${opts.anchor} (${weekday(opts.anchor)}) -> ${anchorLandsOn} (${weekday(anchorLandsOn)})${opts.dryRun ? '  [dry run]' : ''}`,
  );
  if (deltaDays === 0) {
    console.log('Delta is zero — nothing to do.');
    return;
  }

  // Snapshot every date before mutating, for post-hoc verification.
  const before = [];
  for (const { rel, doc } of jsonFiles(root)) {
    for (const { dotPath, date } of collectDates(doc, typeDirOf(rel))) {
      before.push({ rel, dotPath, date });
    }
  }

  // Count prose-date matches beforehand so we can verify none were lost.
  const proseCountIn = (doc, typeDir) => {
    let n = 0;
    visitAttributeStrings(doc, typeDir, (value) => {
      n += (value.match(MONTH_PROSE_RE) ?? []).length;
      return value;
    });
    return n;
  };
  let proseBefore = 0;
  if (opts.prose) {
    for (const { rel, doc } of jsonFiles(root)) {
      proseBefore += proseCountIn(doc, typeDirOf(rel));
    }
  }

  const proseMappings = new Map();
  let filesChanged = 0;
  let valuesChanged = 0;
  for (const { file, rel, doc } of jsonFiles(root)) {
    const typeDir = typeDirOf(rel);
    const changes = visitAttributeStrings(doc, typeDir, (value) => {
      let next = value.replace(ISO_DATE_RE, (d) => shiftISODate(d, deltaDays));
      if (opts.prose) {
        next = shiftProseDates(next, deltaDays, anchor, proseMappings);
      }
      return next;
    });
    if (changes > 0) {
      filesChanged++;
      valuesChanged += changes;
      if (!opts.dryRun) {
        fs.writeFileSync(file, JSON.stringify(doc, null, 2));
      }
    }
  }
  console.log(`${opts.dryRun ? 'Would change' : 'Changed'} ${valuesChanged} string value(s) across ${filesChanged} file(s).`);

  if (proseMappings.size) {
    console.log('Prose date mappings applied:');
    for (const [mapping, count] of [...proseMappings.entries()].sort()) {
      console.log(`  ${mapping} (x${count})`);
    }
  }

  if (opts.renameFiles) {
    let renamed = 0;
    for (const { file, rel } of [...jsonFiles(root)]) {
      const base = path.basename(rel);
      const newBase = base.replace(ISO_DATE_RE, (d) => shiftISODate(d, deltaDays));
      if (newBase !== base) {
        const dest = path.join(path.dirname(file), newBase);
        if (fs.existsSync(dest)) {
          console.warn(`warning: not renaming ${rel} — ${newBase} already exists`);
          continue;
        }
        console.log(`  rename ${rel} -> ${path.join(path.dirname(rel), newBase)}`);
        if (!opts.dryRun) fs.renameSync(file, dest);
        renamed++;
      }
    }
    if (renamed) {
      console.log(
        `${opts.dryRun ? 'Would rename' : 'Renamed'} ${renamed} file(s). Push with --delete so the old names are removed remotely.`,
      );
    }
  }

  if (opts.dryRun) return;

  // Verify: every date moved by exactly deltaDays, none appeared or vanished.
  const after = [];
  for (const { rel, doc } of jsonFiles(root)) {
    for (const { dotPath, date } of collectDates(doc, typeDirOf(rel))) {
      after.push({ rel, dotPath, date });
    }
  }
  let ok = before.length === after.length;
  if (!ok) {
    console.error(`VERIFY FAILED: date count changed (${before.length} -> ${after.length})`);
  } else {
    // Compare as sorted multisets of (dotPath, date) — file paths may have
    // been renamed, and order within a file is stable.
    const norm = (list, shift) =>
      list
        .map(({ dotPath, date }) => `${dotPath}|${shift ? shiftISODate(date, deltaDays) : date}`)
        .sort();
    const expected = norm(before, true);
    const actual = norm(after, false);
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        console.error(`VERIFY FAILED: expected ${expected[i]}, found ${actual[i]}`);
        ok = false;
        break;
      }
    }
  }
  if (ok && opts.prose) {
    let proseAfter = 0;
    for (const { rel, doc } of jsonFiles(root)) {
      proseAfter += proseCountIn(doc, typeDirOf(rel));
    }
    if (proseAfter !== proseBefore) {
      console.error(
        `VERIFY FAILED: prose date count changed (${proseBefore} -> ${proseAfter})`,
      );
      ok = false;
    }
  }
  if (ok) {
    const dates = after.map((e) => e.date).sort();
    console.log(
      `Verified: all ${after.length} ISO dates shifted by exactly ${deltaDays} days${opts.prose ? ` and all ${proseBefore} prose dates accounted for` : ''}. New range: ${dates[0]} .. ${dates[dates.length - 1]}`,
    );
  } else {
    process.exitCode = 1;
  }
}

// ---- arg parsing ----
const [mode, dirArg, ...rest] = process.argv.slice(2);
if (!mode || !dirArg || !['analyze', 'apply'].includes(mode)) usage();
const root = path.resolve(dirArg);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  usage(`not a directory: ${root}`);
}
const opts = { preserveWeekday: false, renameFiles: false, dryRun: false, prose: true };
for (let i = 0; i < rest.length; i++) {
  switch (rest[i]) {
    case '--anchor':
      opts.anchor = rest[++i];
      break;
    case '--target':
      opts.target = rest[++i];
      break;
    case '--preserve-weekday':
      opts.preserveWeekday = true;
      break;
    case '--rename-files':
      opts.renameFiles = true;
      break;
    case '--no-prose':
      opts.prose = false;
      break;
    case '--dry-run':
      opts.dryRun = true;
      break;
    default:
      usage(`unknown option: ${rest[i]}`);
  }
}

if (mode === 'analyze') analyze(root);
else apply(root, opts);
