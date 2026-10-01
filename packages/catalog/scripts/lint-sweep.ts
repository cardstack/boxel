// Lints the boxel-catalog clone in contents/ against this boxel checkout, so a
// boxel change is checked for the lint errors it would introduce in the
// catalog. The catalog lives in its own repo but type-checks and lints its
// cards against boxel, so a platform change (a field removed from a command
// input, a stricter type, a new lint rule) can break the catalog's lint
// without failing anything in boxel.
//
// Run from packages/catalog:
//
//   node scripts/lint-sweep.ts --record=<file>
//     Runs the package's own lint scripts, the same set its `pnpm lint` runs,
//     and writes every error they report to <file>. Exits 0 whether or not
//     there are lint errors; exits 1 only when a linter could not run, since
//     a linter that crashed reports no errors and must not read as a pass.
//
//   node scripts/lint-sweep.ts --report=<file> [--baseline=<file>]
//     Prints the errors recorded in <file> and exits 1 if there are any. With
//     a baseline (a recording of the same catalog revision linted against the
//     boxel base branch), only errors the baseline lacks count, so a catalog
//     that is already broken against boxel main does not fail every change.
//     Writes a markdown summary to $GITHUB_STEP_SUMMARY when it is set.
//
//   node scripts/lint-sweep.ts --report=<file> [--baseline=<file>] --pairing=<file>
//     Reports with the pull request's pairing as scripts/pairing.ts resolved
//     it. A recording of a paired catalog pull request's head is reported as
//     above. Any other recording is catalog main, and errors the change adds
//     to it pass only while a catalog pull request this change merges before
//     is open and approved, so it lands right after the change. A catalog
//     pull request this change merges after has to land first, so until it
//     does they fail, waiting on it. With no pairing they fail, saying how to
//     declare one.
//
// Errors are matched by linter, file, rule, message and position first, then
// the rest without position, so an error in a boxel file that the change only
// moved still matches, and a repeated error the change adds is the one
// reported.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { Pair, Resolution } from './pairing.ts';

type Linter = 'lint:types' | 'lint:js' | 'lint:hbs';

interface Diagnostic {
  linter: Linter;
  // Relative to the boxel repo root, e.g. packages/catalog/contents/x.gts.
  file: string;
  line?: number;
  column?: number;
  rule: string;
  message: string;
}

interface Recording {
  catalog: { repository?: string; revision?: string };
  diagnostics: Diagnostic[];
}

interface LinterRun {
  diagnostics: Diagnostic[];
  status: number | null;
  output: string;
}

const catalogDir = process.cwd();
const repoRoot = resolve(catalogDir, '..', '..');
const contentsPrefix = 'packages/catalog/contents/';

function fail(message: string): never {
  console.error(`catalog lint sweep: ${message}`);
  process.exit(1);
}

function log(message: string) {
  console.log(`catalog lint sweep: ${message}`);
}

function repoPath(file: string) {
  let absolute = isAbsolute(file) ? file : resolve(catalogDir, file);
  return relative(repoRoot, absolute).split('\\').join('/');
}

function runScript(script: Linter, args: string[]) {
  let result = spawnSync('pnpm', ['--silent', 'run', script, ...args], {
    cwd: catalogDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    fail(`could not start ${script}: ${result.error.message}`);
  }
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

// ember-tsc prints `file(line,col): error TS1234: message`, with any further
// lines of the message indented beneath it. An error with no location (a bad
// compiler option, say) prints without the file prefix.
function lintTypes(): LinterRun {
  let { status, output } = runScript('lint:types', ['--pretty', 'false']);
  let diagnostics: Diagnostic[] = [];
  let located = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
  let unlocated = /^error (TS\d+): (.*)$/;
  for (let line of output.split('\n')) {
    let match = located.exec(line);
    if (match) {
      diagnostics.push({
        linter: 'lint:types',
        file: repoPath(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        rule: match[4],
        message: match[5],
      });
      continue;
    }
    match = unlocated.exec(line);
    if (match) {
      diagnostics.push({
        linter: 'lint:types',
        file: '',
        rule: match[1],
        message: match[2],
      });
      continue;
    }
    let last = diagnostics[diagnostics.length - 1];
    if (last && /^\s+\S/.test(line)) {
      last.message += `\n${line.trim()}`;
    }
  }
  return { diagnostics, status, output };
}

function readReport(path: string) {
  if (!existsSync(path)) {
    return undefined;
  }
  let text = readFileSync(path, 'utf8').trim();
  return text ? JSON.parse(text) : undefined;
}

function lintJs(outDir: string): LinterRun {
  let reportPath = join(outDir, 'eslint.json');
  let { status, output } = runScript('lint:js', [
    '--format',
    'json',
    '--output-file',
    reportPath,
    // The package script caches results, and an entry cached against one boxel
    // tree is not invalidated when the plugins it came from change.
    '--cache-location',
    join(outDir, 'eslintcache'),
  ]);
  let diagnostics: Diagnostic[] = [];
  let report = readReport(reportPath) as
    | {
        filePath: string;
        messages: {
          ruleId: string | null;
          severity: number;
          line?: number;
          column?: number;
          message: string;
        }[];
      }[]
    | undefined;
  for (let result of report ?? []) {
    for (let message of result.messages) {
      if (message.severity !== 2) {
        continue;
      }
      diagnostics.push({
        linter: 'lint:js',
        file: repoPath(result.filePath),
        line: message.line,
        column: message.column,
        rule: message.ruleId ?? 'eslint',
        message: message.message,
      });
    }
  }
  return { diagnostics, status, output };
}

function lintHbs(outDir: string): LinterRun {
  let reportPath = join(outDir, 'template-lint.json');
  let { status, output } = runScript('lint:hbs', [
    '--format',
    'json',
    '--output-file',
    reportPath,
  ]);
  let diagnostics: Diagnostic[] = [];
  let report = readReport(reportPath) as
    | Record<
        string,
        {
          rule: string;
          severity: number;
          filePath: string;
          line?: number;
          column?: number;
          message: string;
        }[]
      >
    | undefined;
  for (let [file, messages] of Object.entries(report ?? {})) {
    for (let message of messages) {
      if (message.severity !== 2) {
        continue;
      }
      diagnostics.push({
        linter: 'lint:hbs',
        file: repoPath(message.filePath ?? file),
        line: message.line,
        column: message.column,
        rule: message.rule,
        message: message.message,
      });
    }
  }
  return { diagnostics, status, output };
}

const parsers: Record<Linter, (outDir: string) => LinterRun> = {
  'lint:types': () => lintTypes(),
  'lint:js': lintJs,
  'lint:hbs': lintHbs,
};

function git(dir: string, args: string[]) {
  let result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function githubRepository(remote: string | undefined) {
  let match = remote?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1];
}

function record(path: string) {
  let pkg = JSON.parse(readFileSync(join(catalogDir, 'package.json'), 'utf8'));
  if (pkg.name !== '@cardstack/catalog') {
    fail(`run this from packages/catalog, not ${catalogDir}`);
  }
  let contentsDir = join(catalogDir, 'contents');
  if (!existsSync(contentsDir)) {
    fail(`there is no catalog clone at ${contentsDir}`);
  }

  // `pnpm lint` runs concurrently's `pnpm:lint:*(!fix)`: every lint: script
  // whose name does not contain "fix". A script this sweep cannot read would
  // fail the catalog's lint while this passes, so it is an error here.
  let linters = Object.keys(pkg.scripts ?? {}).filter(
    (name) => name.startsWith('lint:') && !/fix/.test(name),
  );
  let unreadable = linters.filter((name) => !Object.hasOwn(parsers, name));
  if (unreadable.length > 0) {
    fail(
      `package.json has lint scripts this sweep cannot read: ${unreadable.join(', ')}. ` +
        `Add a parser for their output to scripts/lint-sweep.ts.`,
    );
  }

  let outDir = mkdtempSync(join(tmpdir(), 'catalog-lint-sweep-'));
  let diagnostics: Diagnostic[] = [];
  try {
    for (let linter of linters as Linter[]) {
      log(`running ${linter}`);
      let result = parsers[linter](outDir);
      // Every linter here exits non-zero when it reports an error, so a
      // non-zero exit with nothing parsed means it never got as far as
      // linting. ESLint also says so outright, with exit status 2.
      let crashed =
        (result.status !== 0 && result.diagnostics.length === 0) ||
        (linter === 'lint:js' && result.status === 2);
      if (crashed) {
        console.error(result.output);
        fail(`${linter} exited ${result.status} without reporting any errors`);
      }
      log(`${linter} reported ${result.diagnostics.length} error(s)`);
      diagnostics.push(...result.diagnostics);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  let recording: Recording = {
    catalog: {
      repository: githubRepository(
        git(contentsDir, ['remote', 'get-url', 'origin']),
      ),
      revision: git(contentsDir, ['rev-parse', 'HEAD']),
    },
    diagnostics,
  };
  writeFileSync(path, JSON.stringify(recording, null, 2));
  log(`recorded ${diagnostics.length} error(s) to ${path}`);
}

function key(d: Diagnostic) {
  return JSON.stringify([d.linter, d.file, d.rule, d.message]);
}

function positionedKey(d: Diagnostic) {
  return JSON.stringify([key(d), d.line, d.column]);
}

// Takes the diagnostics in `from` that `pool` holds one of, spending one of
// the pool's occurrences per match, so a second copy of an error the pool has
// once is left over.
function takeMatches(
  from: Diagnostic[],
  pool: Diagnostic[],
  keyOf: (d: Diagnostic) => string,
) {
  let remaining = new Map<string, Diagnostic[]>();
  for (let d of pool) {
    let k = keyOf(d);
    let list = remaining.get(k) ?? [];
    list.push(d);
    remaining.set(k, list);
  }
  let matched: Diagnostic[] = [];
  let unmatched: Diagnostic[] = [];
  let used = new Set<Diagnostic>();
  for (let d of from) {
    let candidates = remaining.get(keyOf(d));
    let match = candidates?.shift();
    if (match) {
      matched.push(d);
      used.add(match);
    } else {
      unmatched.push(d);
    }
  }
  return { matched, unmatched, poolLeft: pool.filter((d) => !used.has(d)) };
}

// The errors in `head` that `baseline` does not account for. Catalog files are
// the same in both runs, so errors that also match on position pair up first;
// only what is left matches without it, which covers boxel files the change
// edited above an error.
function newErrors(head: Diagnostic[], baseline: Diagnostic[]) {
  let exact = takeMatches(head, baseline, positionedKey);
  let moved = takeMatches(exact.unmatched, exact.poolLeft, key);
  let existing = new Set([...exact.matched, ...moved.matched]);
  return {
    added: head.filter((d) => !existing.has(d)),
    existing: head.filter((d) => existing.has(d)),
  };
}

function location(d: Diagnostic) {
  if (!d.file) {
    return '(no file)';
  }
  return d.line ? `${d.file}:${d.line}:${d.column ?? 1}` : d.file;
}

function markdownItem(d: Diagnostic, catalog: Recording['catalog']) {
  let where = `\`${location(d)}\``;
  if (
    d.file.startsWith(contentsPrefix) &&
    catalog.repository &&
    catalog.revision
  ) {
    let path = d.file.slice(contentsPrefix.length);
    let anchor = d.line ? `#L${d.line}` : '';
    where = `[${where}](https://github.com/${catalog.repository}/blob/${catalog.revision}/${path}${anchor})`;
  }
  // GitHub's markdown drops anything shaped like an HTML tag, and type
  // names like `Partial<FieldsOf<X>>` are.
  let message = d.message
    .split('\n')[0]
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
  return `- ${where} ${d.linter} \`${d.rule}\`: ${message}`;
}

function printErrors(heading: string, diagnostics: Diagnostic[]) {
  console.log(`\n${heading}`);
  for (let d of diagnostics) {
    console.log(`  ${location(d)} ${d.linter} ${d.rule}: ${d.message}`);
  }
}

// A workflow command's message ends at the first newline unless it is escaped.
function annotation(message: string) {
  return message
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

// The paired catalog pull request this change can lean on to fix catalog
// main, if any, and whether catalog main may fail with the errors the change
// adds to it. It may only while a catalog pull request this change merges
// before is open and approved, so it can land right after this one. A pull
// request this change merges after has to land first, so until it does the
// verdict is to wait for it.
function mainVerdict(resolution: Resolution) {
  let here = `${resolution.repository}#${resolution.number}`;
  let ref = (pair: Pair) => `${pair.repository}#${pair.number}`;
  let before = resolution.pairs.find(
    (p) => p.key === 'merges-before' && !p.merged,
  );
  let after = resolution.pairs.find(
    (p) => p.key === 'merges-after' && !p.merged,
  );
  if (before?.approved === true) {
    return {
      passes: true,
      message:
        `${here} merges before ${ref(before)}, which is approved: merge ` +
        `${ref(before)} right after this change, so catalog main fails with ` +
        `these errors only in between.`,
    };
  }
  if (after) {
    return {
      passes: false,
      message:
        `${here} merges after ${ref(after)}, so catalog main is linted ` +
        `against this change once that has landed: waiting on ${ref(after)} ` +
        `to merge. Re-run this check after it merges.`,
    };
  }
  if (before?.approved === false) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, which is not approved yet, so ` +
        `catalog main would fail with these errors until it is. Get it ` +
        `approved, re-run this check, and merge ${ref(before)} right after ` +
        `this change.`,
    };
  }
  if (before) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, and whether that is approved ` +
        `could not be read (${before.approvalError}). Re-run this check.`,
    };
  }
  let catalogRepository = 'cardstack/boxel-catalog';
  return {
    passes: false,
    message:
      `Merging this change leaves catalog main failing with these errors. ` +
      `Keep the change compatible with the catalog as it is, or fix the ` +
      `catalog in a ${catalogRepository} pull request and pair the two: add ` +
      `\`Merges before: ${catalogRepository}#<number>\` to ${here}'s ` +
      `description, and \`Merges after: ${here}\` to that pull request's.`,
  };
}

async function report(
  headPath: string,
  baselinePath: string | undefined,
  pairingPath: string | undefined,
) {
  let head = JSON.parse(readFileSync(headPath, 'utf8')) as Recording;
  let baseline = baselinePath
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Recording)
    : undefined;
  let resolution = pairingPath
    ? (JSON.parse(readFileSync(pairingPath, 'utf8')) as Resolution)
    : undefined;
  let { added, existing } = newErrors(
    head.diagnostics,
    baseline?.diagnostics ?? [],
  );
  let catalog = head.catalog;
  let revision = catalog.revision?.slice(0, 12) ?? 'unknown revision';
  let at = `${catalog.repository ?? 'the catalog'}@${revision}`;

  // With a pairing, this recording is either a paired catalog pull request's
  // head, which the change is linted with, or catalog main, which the change
  // must not leave failing behind a pull request that isn't ready.
  let pair = resolution?.pairs.find(
    (p) => !p.merged && p.headSha === catalog.revision,
  );
  let gated = Boolean(resolution) && !pair;
  let subject = pair
    ? `${pair.repository}#${pair.number}'s head (${at})`
    : gated
      ? `catalog main (${at})`
      : at;
  let linting = `Linting ${subject} against this change`;

  let summary = [
    pair
      ? `### Catalog lint: ${pair.repository}#${pair.number}`
      : gated
        ? `### Catalog lint: main`
        : `### Catalog lint`,
    '',
  ];
  let passes = added.length === 0;
  if (added.length > 0) {
    let introduced = baseline
      ? `${added.length} lint error(s) that linting it against the base branch does not`
      : `${added.length} lint error(s)`;
    printErrors(`${linting} finds ${introduced}:`, added);
    let advice: string;
    let verdict = gated && resolution ? mainVerdict(resolution) : undefined;
    if (verdict && resolution!.pairs.length > 0) {
      // What fails the check is the paired pull request not being ready,
      // which the verdict states; the errors are what main would fail with.
      passes = verdict.passes;
      advice = verdict.message;
      for (let d of added) {
        console.log(
          `::warning title=catalog lint (main)::${annotation(`${location(d)} ${d.rule}: ${d.message}`)}`,
        );
      }
      console.log(
        `::${passes ? 'notice' : 'error'} title=catalog lint (main)::${annotation(advice)}`,
      );
    } else {
      advice = pair
        ? `Fix them in ${pair.repository}#${pair.number}, which this change ` +
          `is paired with.`
        : verdict
          ? verdict.message
          : `Keep the change compatible with the catalog as it is, or fix the ` +
            `catalog in a boxel-catalog pull request and pair the two in ` +
            `their descriptions, as packages/catalog/README.md describes.`;
      for (let d of added) {
        console.log(
          `::error title=catalog lint::${annotation(`${location(d)} ${d.rule}: ${d.message}`)}`,
        );
      }
    }
    summary.push(
      `${linting} finds ${introduced}. ${advice}`,
      '',
      ...added.map((d) => markdownItem(d, catalog)),
      '',
    );
  } else {
    let finding = baseline
      ? `${linting} finds no lint errors that the base branch does not`
      : `${linting} finds no lint errors`;
    log(finding);
    summary.push(`${finding}.`, '');
  }
  if (existing.length > 0) {
    printErrors(
      `${subject} already has ${existing.length} lint error(s) against the base branch, which do not fail this check:`,
      existing,
    );
    console.log(
      `::warning title=catalog lint::${annotation(
        `${subject} already has ${existing.length} lint error(s) against the base branch; they do not fail this check.`,
      )}`,
    );
    summary.push(
      `<details><summary>${existing.length} lint error(s) the catalog already has against the base branch, which do not fail this check</summary>`,
      '',
      ...existing.map((d) => markdownItem(d, catalog)),
      '',
      `</details>`,
      '',
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
  process.exit(passes ? 0 : 1);
}

let args = process.argv.slice(2);
function option(name: string) {
  let prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

let recordPath = option('record');
let reportPath = option('report');
if (recordPath && !reportPath) {
  record(resolve(recordPath));
} else if (reportPath && !recordPath) {
  let baselinePath = option('baseline');
  let pairingPath = option('pairing');
  report(
    resolve(reportPath),
    baselinePath ? resolve(baselinePath) : undefined,
    pairingPath ? resolve(pairingPath) : undefined,
  ).catch((error) => fail(String(error)));
} else {
  fail(
    'pass either --record=<file> or --report=<file> [--baseline=<file>] [--pairing=<file>]',
  );
}
