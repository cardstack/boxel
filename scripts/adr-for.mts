#!/usr/bin/env node
// Lists the ADRs in docs/adr/ whose `scope` globs match the given paths, and
// the known gaps their remediation files (docs/adr/remediation/<number>.md)
// list for those paths. With no paths, lists every ADR with its scope and its
// remediation file.
//
// A relative path is matched both as relative to the working directory and as
// relative to the repo root, so a path named from inside a package and the
// repo-relative output of `gh pr diff --name-only` both work from anywhere.
//
//   node scripts/adr-for.mts packages/postgres/migrations/x.js
//   node scripts/adr-for.mts $(gh pr diff 1234 --name-only)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const adrDir = join(repoRoot, 'docs', 'adr');

interface Adr {
  file: string;
  status: string;
  title: string;
  scope: string[];
  remediation: string | undefined;
}

// One top-level list item of a remediation file. `paths` are the files the
// entry names, plus those of the line that introduces its group
// (`packages/x.ts`: followed by one entry per symbol). An item with a
// nested list keeps each nested item separately, so a match prints only the
// nested items that name the path.
interface Gap {
  group: { text: string; paths: string[] } | undefined;
  lead: string[];
  paths: string[];
  children: { lines: string[]; paths: string[] }[];
}

function parseAdr(file: string): Adr {
  let text = readFileSync(join(adrDir, file), 'utf8');
  let [, frontmatter = '', body = ''] =
    text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  let lines = frontmatter.split('\n');
  let field = (name: string) =>
    lines
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .replace(/#.*$/, '')
      .trim();

  let scope: string[] = [];
  let start = lines.findIndex((line) => line.startsWith('scope:'));
  if (start !== -1) {
    let inline = field('scope');
    if (inline?.startsWith('[')) {
      scope = inline.slice(1, -1).split(',');
    } else {
      for (let line of lines.slice(start + 1)) {
        let item = line.match(/^\s+-\s+(.*)$/);
        if (!item) {
          break;
        }
        scope.push(item[1]);
      }
    }
  }
  scope = scope
    .map((glob) =>
      glob
        .replace(/#.*$/, '')
        .trim()
        .replace(/^['"]|['"]$/g, ''),
    )
    .filter(Boolean);

  let remediation = join('remediation', `${file.slice(0, 3)}.md`);
  return {
    file,
    status: field('status') ?? 'unknown',
    title: body.match(/^# (.*)$/m)?.[1] ?? file,
    scope,
    remediation: existsSync(join(adrDir, remediation))
      ? remediation
      : undefined,
  };
}

// A backticked token names a file when it is a glob or a path that exists from
// the repo root, so `packages/x.ts` and `AGENTS.md` do, and a symbol such as
// `fetchModule` or a specifier such as `@cardstack/base/` doesn't.
function pathsIn(lines: string[]): string[] {
  return [...lines.join(' ').matchAll(/`([^`\s]+)`/g)]
    .map((match) => match[1])
    .filter(
      (token) =>
        /[*{]/.test(token) ||
        existsSync(join(repoRoot, token.replace(/\/$/, ''))),
    );
}

function parseGaps(remediation: string): Gap[] {
  let gaps: Gap[] = [];
  let group: { text: string; paths: string[] } | undefined;
  let paragraph: string[] = [];
  for (let line of readFileSync(join(adrDir, remediation), 'utf8').split(
    '\n',
  )) {
    if (line.startsWith('- ')) {
      gaps.push({ group, lead: [line], paths: [], children: [] });
    } else if (/^\s+- /.test(line) && gaps.length) {
      gaps.at(-1)!.children.push({ lines: [line], paths: [] });
    } else if (/^\s+\S/.test(line) && gaps.length) {
      let gap = gaps.at(-1)!;
      (gap.children.at(-1)?.lines ?? gap.lead).push(line);
    } else if (line.trim() === '') {
      if (paragraph.length && paragraph.at(-1)!.endsWith(':')) {
        group = { text: paragraph.join('\n'), paths: pathsIn(paragraph) };
      }
      paragraph = [];
    } else if (!line.startsWith('#')) {
      paragraph.push(line);
    }
  }
  for (let gap of gaps) {
    gap.paths = [...(gap.group?.paths ?? []), ...pathsIn(gap.lead)];
    for (let child of gap.children) {
      child.paths = pathsIn(child.lines);
    }
  }
  return gaps;
}

function names(entryPath: string, path: string) {
  return (
    path === entryPath ||
    matchesGlob(path, entryPath) ||
    path.startsWith(`${entryPath.replace(/\/$/, '')}/`)
  );
}

// The text of each gap that names one of the paths, in file order.
function gapsFor(gaps: Gap[], paths: string[]): string[] {
  let named = (entryPaths: string[]) =>
    paths.some((path) =>
      entryPaths.some((entryPath) => names(entryPath, path)),
    );
  let out: string[] = [];
  let lastGroup: Gap['group'];
  for (let gap of gaps) {
    let children = gap.children.filter((child) => named(child.paths));
    if (!children.length && !named(gap.paths)) {
      continue;
    }
    if (gap.group && gap.group !== lastGroup) {
      out.push(...gap.group.text.split('\n'));
    }
    lastGroup = gap.group;
    let shown = children.length ? children : gap.children;
    out.push(...gap.lead, ...shown.flatMap((child) => child.lines));
  }
  return out;
}

let adrs = readdirSync(adrDir)
  .filter((file) => /^\d+-.*\.md$/.test(file))
  .sort()
  .map(parseAdr);

let paths = process.argv.slice(2).map((arg) => {
  let fromCwd = relative(repoRoot, resolve(arg));
  return isAbsolute(arg) || fromCwd === arg ? [fromCwd] : [fromCwd, arg];
});

for (let adr of adrs) {
  let inScope = (path: string) =>
    adr.scope.some((glob) => matchesGlob(path, glob));
  let matched = paths.length
    ? paths.flatMap((readings) => readings.find(inScope) ?? [])
    : adr.scope;
  if (matched.length === 0) {
    continue;
  }
  console.log(`docs/adr/${adr.file} [${adr.status}] ${adr.title}`);
  for (let item of matched) {
    console.log(`  ${item}`);
  }
  if (!adr.remediation) {
    if (adr.status === 'proposed') {
      console.error(
        `  warning: no remediation file docs/adr/remediation/${adr.file.slice(0, 3)}.md (ADR 001 §1.6)`,
      );
    }
    continue;
  }
  let gaps = parseGaps(adr.remediation);
  if (!paths.length) {
    console.log(
      `  remediation: docs/adr/${adr.remediation} (${gaps.length} gaps)`,
    );
    continue;
  }
  let listed = gapsFor(gaps, matched);
  if (listed.length) {
    console.log(`  known gaps, from docs/adr/${adr.remediation}:`);
    for (let line of listed) {
      console.log(`    ${line}`);
    }
  }
}
