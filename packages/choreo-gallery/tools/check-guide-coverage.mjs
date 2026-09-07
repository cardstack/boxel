import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/api-inventory.json'), 'utf8'),
);
const files = {
  'glimmer-motion': 'packages/glimmer-motion/src/index.ts',
  'glimmer-motion/film': 'packages/glimmer-motion/src/film/index.ts',
  'glimmer-motion/test-support':
    'packages/glimmer-motion/src/test-support/index.ts',
  'choreo-player': 'packages/choreo-player/src/index.ts',
};
const contexts = {
  ChoreoContext: ['packages/glimmer-motion/src/choreo.gts', 'c.'],
  FilmVocabulary: ['packages/glimmer-motion/src/film/graph/host.gts', 'f.'],
};
const actual = new Set();
function source(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}
for (const [entrypoint, file] of Object.entries(files)) {
  const tree = source(file);
  for (const node of tree.statements) {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const item of node.exportClause.elements) {
        actual.add(`${entrypoint}:${item.name.text}`);
      }
    } else if (
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      if (node.name) {
        actual.add(`${entrypoint}:${node.name.text}`);
      }
      if (ts.isVariableStatement(node)) {
        for (const item of node.declarationList.declarations) {
          actual.add(`${entrypoint}:${item.name.getText(tree)}`);
        }
      }
    }
  }
}
for (const [name, [file, prefix]] of Object.entries(contexts)) {
  const definition = source(file).statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === name,
  );
  assert.ok(definition, `Missing interface ${name}`);
  for (const item of definition.members) {
    actual.add(`${name}:${prefix}${item.name.getText()}`);
  }
}
const listed = new Set(
  inventory.entries.map((item) => `${item.entrypoint}:${item.symbol}`),
);
assert.equal(
  listed.size,
  inventory.entries.length,
  'Duplicate API inventory entry',
);
assert.deepEqual(
  [...listed].sort(),
  [...actual].sort(),
  'API exports changed: review and update docs/api-inventory.json',
);
const directory = path.join(root, 'test-app/app/content/guides');
const pages = new Map(
  fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.md'))
    .map((file) => [
      file.slice(0, -3),
      fs.readFileSync(path.join(directory, file), 'utf8'),
    ]),
);
const gaps = [];
for (const [slug, markdown] of pages) {
  const prose = markdown
    .split('\n## API Coverage')[0]
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6} .*$/gm, '')
    .replace(/^\|.*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const words = prose.match(/\b[\w'-]+\b/g)?.length ?? 0;
  if (words < inventory.minimumProseWords) {
    gaps.push(`${slug}: ${words} prose words`);
  }
  const preamble = markdown
    .replace(/^# .*\n/, '')
    .split(/^## /m)[0]
    .trim();
  assert.ok(preamble.length > 80, `${slug} needs an introductory preamble`);
  if (slug.endsWith('-start')) {
    assert.ok(
      markdown.includes('## Motivation') &&
        markdown.includes('## Learning Goals'),
      `${slug} needs section motivation and goals`,
    );
  }
  for (const link of markdown.matchAll(/\]\(\/docs\/([^)#]+)(?:#[^)]*)?\)/g)) {
    assert.ok(pages.has(link[1]), `${slug}: missing guide ${link[1]}`);
  }
}
for (const item of inventory.entries) {
  assert.ok(
    pages.has(item.guide),
    `Missing coverage for ${item.symbol}: ${item.guide}`,
  );
  assert.ok(
    fs.existsSync(path.join(root, item.source)),
    `Missing source for ${item.symbol}: ${item.source}`,
  );
}
if (gaps.length) {
  throw new Error(
    `Expand these guides to ${inventory.minimumProseWords} prose words (code and tables excluded):\n${gaps.join('\n')}`,
  );
}
console.log(
  `${actual.size} API/vocabulary entries mapped; ${pages.size} guides meet ${inventory.minimumProseWords} prose words; all preambles, section goals, and internal guide links pass.`,
);
