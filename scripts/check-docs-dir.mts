#!/usr/bin/env node
// Guard: the repo-root docs/ directory holds durable documentation only — the
// concept and operations docs that docs/README.md links to, and the ADRs in
// docs/adr/. It fails when a tracked file outside docs/adr/:
//
//   - is named like a ticket or a plan (contains `cs-<digits>`, or ends in
//     `-plan.md`), or
//   - is a Markdown file that docs/README.md does not link to,
//
// and when docs/README.md links to a file under docs/ that is not tracked.
//
// Per-ticket plans, investigation notes and status reports belong on the
// tracker ticket, not in the repo. A decision that outlives its PR belongs in
// an ADR.
//
// Reads the git index, so a file counts once it is staged, and untracked
// scratch files are ignored.
//
//   node scripts/check-docs-dir.mts          # CI: exit 1 on a problem
//   node scripts/check-docs-dir.mts --warn   # pre-commit: report, exit 0
//
// With --warn, the report goes to the file named by $LINT_AUTOFIX_WARN_FILE
// when it is set (the husky pre-commit hook prints that file), else to stderr.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const warnOnly = process.argv.includes('--warn');

// The ticket half needs a non-letter before `cs-`, so `docs-2.md` and
// `ecs-2-task-sizing.md` pass.
const TICKET_OR_PLAN_NAME = /(?:^|[^a-z])cs-[0-9]+|-plan\.md$/i;
// A link with a scheme (`https:`, `mailto:`) points outside the repo.
const EXTERNAL_LINK = /^[a-z][a-z0-9+.-]*:/i;
const WHERE_IT_GOES =
  'Put a per-ticket plan, investigation notes or a status report on the ticket instead. ' +
  'A decision that outlives its PR goes in an ADR (docs/adr/, see ADR 001). ' +
  'A durable concept or operations doc goes in docs/ with a link from docs/README.md, ' +
  'and a doc about one package goes in that package.';

let tracked = execFileSync('git', ['ls-files', '--', 'docs'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);
let trackedSet = new Set(tracked);
let files = tracked.filter((file) => !file.startsWith('docs/adr/'));

let readme = readFileSync(join(repoRoot, 'docs', 'README.md'), 'utf8');
let linked = new Set(
  [...readme.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
    .map(([, target]) => target)
    .filter((target) => !EXTERNAL_LINK.test(target))
    .map((target) => posix.normalize(posix.join('docs', target))),
);

let problems: string[] = [];
for (let file of files) {
  if (TICKET_OR_PLAN_NAME.test(posix.basename(file))) {
    problems.push(`${file}: named like a ticket or a plan.`);
  } else if (
    file.endsWith('.md') &&
    file !== 'docs/README.md' &&
    !linked.has(file)
  ) {
    problems.push(`${file}: not linked from docs/README.md.`);
  }
}
for (let target of linked) {
  if (target.startsWith('docs/') && !trackedSet.has(target)) {
    problems.push(`docs/README.md: links to ${target}, which is not tracked.`);
  }
}

if (problems.length > 0) {
  let report = [
    'check-docs-dir: docs/ holds durable documentation that docs/README.md links to, and ADRs.',
    ...problems.map((problem) => `  ${problem}`),
    WHERE_IT_GOES,
    '',
  ].join('\n');
  let warnFile = process.env.LINT_AUTOFIX_WARN_FILE;
  if (warnOnly && warnFile) {
    appendFileSync(warnFile, report);
  } else {
    process.stderr.write(report);
  }
  process.exit(warnOnly ? 0 : 1);
}
