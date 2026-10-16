#!/usr/bin/env node
// Lists the ADRs in docs/adr/ whose `scope` globs match the given paths. With no
// paths, lists every ADR with its scope.
//
// A relative path is matched both as relative to the working directory and as
// relative to the repo root, so a path named from inside a package and the
// repo-relative output of `gh pr diff --name-only` both work from anywhere.
//
//   node scripts/adr-for.mts packages/postgres/migrations/x.js
//   node scripts/adr-for.mts $(gh pr diff 1234 --name-only)

import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const adrDir = join(repoRoot, 'docs', 'adr');

interface Adr {
  file: string;
  status: string;
  title: string;
  scope: string[];
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

  return {
    file,
    status: field('status') ?? 'unknown',
    title: body.match(/^# (.*)$/m)?.[1] ?? file,
    scope,
  };
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
}
