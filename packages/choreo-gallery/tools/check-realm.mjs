/**
 * Checks the gallery realm's contents against the libraries it documents.
 *
 * - The API inventory names every public export of glimmer-motion, Choreo
 *   and choreo-player, plus the members of the ChoreoContext and
 *   FilmVocabulary vocabularies, and maps each to the guide that covers it.
 * - Every demo instance in realm/demos is well formed, the index card links
 *   exactly that set, and each demo carries a complete teaching lesson that
 *   names a known guide.
 * - Every guide meets the prose floor and has a preamble, the `-start`
 *   guides state their motivation and goals, and internal guide links
 *   resolve.
 *
 * Reads sources and JSON only, so it needs no build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const realm = path.join(root, 'packages/choreo-gallery/realm');
/**
 * The guides and the guide pages that embed demos are still test-app
 * sources; the realm takes them over when the guides are ported.
 */
const guidesDir = path.join(
  root,
  'packages/choreo-test-app/app/content/guides',
);
const guideEmbedSources = [
  'packages/choreo-test-app/app/lib/guides.ts',
  'packages/choreo-test-app/app/lib/guide-reference.ts',
  'packages/choreo-test-app/app/lib/demo-guides.ts',
];

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function source(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

// ---- the API inventory ---------------------------------------------------

const inventory = readJSON(
  path.join(root, 'packages/choreo-gallery/docs/api-inventory.json'),
);
const files = {
  'glimmer-motion': 'packages/glimmer-motion/src/index.ts',
  'glimmer-motion/test-support':
    'packages/glimmer-motion/src/test-support/index.ts',
  '@cardstack/choreo': 'packages/choreo/src/index.ts',
  '@cardstack/choreo/film': 'packages/choreo/src/film/index.ts',
  '@cardstack/choreo/test-support': 'packages/choreo/src/test-support/index.ts',
  '@cardstack/choreo-player': 'packages/choreo-player/src/index.ts',
};
const contexts = {
  ChoreoContext: ['packages/choreo/src/choreo.gts', 'c.'],
  FilmVocabulary: ['packages/choreo/src/film/graph/host.gts', 'f.'],
};
const actual = new Set();
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
  'API exports changed: review and update packages/choreo-gallery/docs/api-inventory.json',
);

// ---- the guides ----------------------------------------------------------

const pages = new Map(
  fs
    .readdirSync(guidesDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => [
      file.slice(0, -3),
      fs.readFileSync(path.join(guidesDir, file), 'utf8'),
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

// ---- the catalog ---------------------------------------------------------

/** the gallery's groups, as demo.gts declares them */
const groupsSource = fs
  .readFileSync(path.join(realm, 'demo.gts'), 'utf8')
  .match(/export const GROUPS = \[([\s\S]*?)\] as const;/);
assert.ok(groupsSource, 'realm/demo.gts must declare GROUPS');
const groups = new Set(
  [
    ...groupsSource[1].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/'([^']+)'/g),
  ].map((match) => match[1]),
);

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const demos = fs
  .readdirSync(path.join(realm, 'demos'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    file,
    slug: file.slice(0, -'.json'.length),
    doc: readJSON(path.join(realm, 'demos', file)).data,
  }));
for (const { file, slug, doc } of demos) {
  const where = `realm/demos/${file}`;
  const { attributes: demo, meta } = doc;
  assert.equal(demo.slug, slug, `${where}: slug must match the filename`);
  // a demo with a stage of its own adopts from its subclass in stages/
  const { module, name } = meta.adoptsFrom;
  assert.ok(
    (module === '../demo' && name === 'GalleryDemo') ||
      module === `../stages/${slug}`,
    `${where}: must adopt from ../demo GalleryDemo, or from ../stages/${slug}`,
  );
  for (const field of ['title', 'lede', 'sample']) {
    assert.ok(nonEmpty(demo[field]), `${where}: needs a ${field}`);
  }
  assert.ok(groups.has(demo.group), `${where}: unknown group ${demo.group}`);
  assert.ok(
    Array.isArray(demo.apis) && demo.apis.length && demo.apis.every(nonEmpty),
    `${where}: needs its apis`,
  );
  for (const step of demo.walkthrough ?? []) {
    for (const field of ['label', 'note', 'source']) {
      assert.ok(nonEmpty(step[field]), `${where}: walkthrough needs ${field}`);
    }
  }
}

const index = readJSON(path.join(realm, 'index.json')).data;
const linked = Object.entries(index.relationships ?? {})
  .filter(([key]) => /^demos\.\d+$/.test(key))
  .sort(([a], [b]) => Number(a.split('.')[1]) - Number(b.split('.')[1]))
  .map(([, value]) => value.links.self);
assert.equal(
  new Set(linked).size,
  linked.length,
  'realm/index.json links a demo twice',
);
assert.deepEqual(
  [...linked].sort(),
  demos.map(({ slug }) => `./demos/${slug}`).sort(),
  'realm/index.json must link every demo in realm/demos, and nothing else',
);

// ---- the lessons ---------------------------------------------------------

function literalIds(tree) {
  const ids = new Set();
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === 'id' &&
      ts.isStringLiteral(node.initializer)
    ) {
      ids.add(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return ids;
}
const embedded = new Set(
  guideEmbedSources.flatMap((file) => [...literalIds(source(file))]),
);
for (const { file, slug, doc } of demos) {
  const where = `realm/demos/${file}`;
  const lesson = doc.attributes.lesson;
  assert.ok(lesson, `${where}: needs a teaching lesson`);
  assert.ok(embedded.has(slug), `${slug} needs a guide embed`);
  assert.ok(
    pages.has(lesson.guide),
    `${where}: unknown concept guide ${lesson.guide}`,
  );
  for (const field of ['concept', 'why', 'experiment', 'pitfall', 'combine']) {
    assert.ok(nonEmpty(lesson[field]), `${where}: lesson needs ${field}`);
  }
}
console.log(
  `${demos.length} demos are well formed, linked from the index, and have guide embeds and complete teaching lessons.`,
);
