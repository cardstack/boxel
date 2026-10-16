#!/usr/bin/env node
// Lists the ADRs in docs/adr/ whose `scope` globs match the given repo-relative
// paths. With no paths, lists every ADR with its scope.
//
//   node scripts/adr-for.mts packages/postgres/migrations/x.js
//   node scripts/adr-for.mts $(gh pr diff 1234 --name-only)

import { readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';

const adrDir = join(import.meta.dirname, '..', 'docs', 'adr');

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

let paths = process.argv.slice(2);

for (let adr of adrs) {
  let matched = paths.length
    ? paths.filter((path) => adr.scope.some((glob) => matchesGlob(path, glob)))
    : adr.scope;
  if (matched.length === 0) {
    continue;
  }
  console.log(`docs/adr/${adr.file} [${adr.status}] ${adr.title}`);
  for (let item of matched) {
    console.log(`  ${item}`);
  }
}
