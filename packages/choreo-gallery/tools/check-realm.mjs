/**
 * Checks the gallery realm's contents against the libraries it documents.
 *
 * - The API inventory names every public export of glimmer-motion, Choreo
 *   and choreo-player, plus the members of the ChoreoContext and
 *   FilmVocabulary vocabularies, and maps each to the guide that covers it.
 * - Every demo instance in realm/demos is well formed, the index card links
 *   exactly that set, and each demo carries a complete teaching lesson that
 *   names a known guide.
 * - Every guide in realm/docs/guides meets the prose floor and has a
 *   preamble, the `-start` guides state their motivation and goals, the
 *   guides' index lists each guide once, and each guide's pager names its
 *   neighbours in that order.
 * - Every card a realm doc embeds (`::card[…]`) is a card instance in the
 *   realm, and every demo has a guide that embeds it.
 * - The docs and design records in the realm link only to files and
 *   headings that exist; every import written in the docs, the guides and
 *   the package READMEs names an export its package has (the design
 *   records sketch APIs that were never built, so their imports aren't
 *   checked); and every choreo.boxel.site URL names a file in the realm,
 *   and every link into the monorepo a file that exists, down to the
 *   heading a `#fragment` names.
 *
 * Reads sources and JSON only, so it needs no build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Marked } from 'marked';
import { getHeadingList, gfmHeadingId } from 'marked-gfm-heading-id';
import ts from 'typescript';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const realm = path.join(root, 'packages/choreo-gallery/realm');
const guidesDir = path.join(realm, 'docs/guides');

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
  path.join(root, 'packages/choreo-gallery/tools/api-inventory.json'),
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
  'API exports changed: review and update packages/choreo-gallery/tools/api-inventory.json',
);

// ---- the guides ----------------------------------------------------------

const pages = new Map(
  fs
    .readdirSync(guidesDir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
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

/*
 * The guides' index gives them their order, and each guide ends on a pager
 * naming its neighbours in it, so a reader can go through them in sequence.
 */
const order = [
  ...fs
    .readFileSync(path.join(guidesDir, 'README.md'), 'utf8')
    .matchAll(/^- \[[^\]]+\]\(([\w-]+)\.md\)/gm),
].map((match) => match[1]);
assert.equal(new Set(order).size, order.length, 'A guide is indexed twice');
assert.deepEqual(
  [...order].sort(),
  [...pages.keys()].sort(),
  'realm/docs/guides/README.md must list every guide, and nothing else',
);
const titleOf = (slug) => pages.get(slug).match(/^# (.+)$/m)[1];
order.forEach((slug, i) => {
  const [prev, next] = [order[i - 1], order[i + 1]];
  const pager = [
    prev && `[← ${titleOf(prev)}](${prev}.md)`,
    '[All guides](README.md)',
    next && `[${titleOf(next)} →](${next}.md)`,
  ]
    .filter(Boolean)
    .join(' · ');
  assert.equal(
    pages.get(slug).trimEnd().split('\n').at(-1),
    pager,
    `${slug}: its pager must name its neighbours in the index`,
  );
});
console.log(
  `${actual.size} API/vocabulary entries mapped; ${pages.size} guides meet ${inventory.minimumProseWords} prose words; all preambles, section goals, the index and the pagers pass.`,
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

/** the cards a document embeds, `::card[…]`, outside its code */
function cardEmbeds(markdown) {
  return [
    ...markdown
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '')
      .matchAll(/::?card\[([^\]|]+?)\s*(?:\|[^\]]*)?\]/g),
  ].map((match) => match[1]);
}
const embedded = new Set(
  [...pages.values()]
    .flatMap(cardEmbeds)
    .map((target) => target.match(/^\.\.\/\.\.\/demos\/([\w-]+)$/)?.[1])
    .filter(Boolean),
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

// ---- the docs ------------------------------------------------------------

function markdownFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(dir, file));
}
const relative = (file) => path.relative(root, file);
/** each file is read, and each document's headings worked out, once */
function memoized(fn) {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) {
      cache.set(key, fn(key));
    }
    return cache.get(key);
  };
}
const read = memoized((file) => fs.readFileSync(file, 'utf8'));
/** undefined for a malformed escape, rather than a URIError */
function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/**
 * The ids a document's headings get, from the parser and slugger the host
 * uses (runtime-common/marked-sync.ts), so setext headings, entities and
 * repeats come out as they render. The host prefixes each id with
 * `user-content-`, as GitHub does in its HTML.
 */
const headingParser = new Marked().use(gfmHeadingId());
const headingIds = memoized((file) => {
  headingParser.parse(read(file));
  return new Set(getHeadingList().map((heading) => heading.id));
});
/**
 * The link and image targets in a document's prose. Code, fenced, indented
 * or inline, isn't prose, so a link it quotes isn't one.
 */
const linkParser = new Marked();
function linkTargets(file) {
  const targets = [];
  linkParser.walkTokens(linkParser.lexer(read(file)), (token) => {
    if (token.type === 'link' || token.type === 'image') {
      targets.push(token.href);
    }
  });
  return targets;
}
/**
 * What is wrong with a `#fragment` on a link to `target`, a Markdown file or a
 * directory (whose README.md GitHub shows), if anything.
 */
function fragmentProblem(target, fragment) {
  if (!fragment) {
    return undefined;
  }
  const id = decode(fragment);
  if (id === undefined) {
    return 'has a malformed escape';
  }
  const isDirectory =
    fs.existsSync(target) && fs.statSync(target).isDirectory();
  // GitHub anchors a directory page's README at `#readme`
  if (isDirectory && id === 'readme') {
    return undefined;
  }
  const doc = isDirectory ? path.join(target, 'README.md') : target;
  return doc.endsWith('.md') && fs.existsSync(doc) && !headingIds(doc).has(id)
    ? 'names no heading'
    : undefined;
}

const realmDocs = [
  ...markdownFiles(path.join(realm, 'docs')),
  ...markdownFiles(path.join(realm, 'design')),
];
const packageReadmes = [
  'glimmer-motion',
  'choreo',
  'choreo-player',
  'choreo-gallery',
].map((pkg) => path.join(root, 'packages', pkg, 'README.md'));
const brokenLinks = [];
for (const file of [...realmDocs, ...packageReadmes]) {
  // a realm doc is published with the realm, so it may link only inside it
  const inRealm = file.startsWith(realm + path.sep);
  for (const target of linkTargets(file)) {
    if (/^[a-z][a-z+.-]*:/i.test(target)) {
      continue;
    }
    const [pathPart, fragment] = target.split('#');
    const decoded = decode(pathPart);
    if (decoded === undefined) {
      brokenLinks.push(`${relative(file)}: ${target} has a malformed escape`);
      continue;
    }
    const resolved = pathPart
      ? path.resolve(path.dirname(file), decoded)
      : file;
    // an extensionless link is a card: `../demos/fold` is demos/fold.json
    const exists = fs.existsSync(resolved) || fs.existsSync(`${resolved}.json`);
    const problem = exists && fragmentProblem(resolved, fragment);
    if (inRealm && (!resolved.startsWith(realm + path.sep) || !exists)) {
      brokenLinks.push(`${relative(file)}: ${target} is not a realm file`);
    } else if (!exists) {
      brokenLinks.push(`${relative(file)}: ${target} names no file`);
    } else if (problem) {
      brokenLinks.push(`${relative(file)}: ${target} ${problem}`);
    }
  }
}
assert.deepEqual(brokenLinks, [], 'Broken links in the docs');

/** an embed renders a card, so it names a card instance in the realm */
const brokenEmbeds = [];
for (const file of realmDocs) {
  for (const target of cardEmbeds(read(file))) {
    const resolved = path.resolve(path.dirname(file), decode(target) ?? '');
    if (
      !resolved.startsWith(realm + path.sep) ||
      !fs.existsSync(`${resolved}.json`)
    ) {
      brokenEmbeds.push(`${relative(file)}: ::card[${target}]`);
    }
  }
}
assert.deepEqual(brokenEmbeds, [], 'Embeds that name no card in the realm');

/*
 * Imports, wherever the docs show one. Choreo and Film moved out of
 * glimmer-motion into @cardstack/choreo, so a name imported from a package
 * has to be one that package exports today.
 */
const packageDirs = {
  'glimmer-motion': 'packages/glimmer-motion',
  '@cardstack/choreo': 'packages/choreo',
  '@cardstack/choreo-player': 'packages/choreo-player',
};
const retiredSpecifiers = new Set(['choreo', 'choreo-player']);
const packageOf = (specifier) =>
  Object.keys(packageDirs)
    .sort((a, b) => b.length - a.length)
    .find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
/**
 * The source module a specifier reaches through its package's `exports` map,
 * as a consumer resolves it: an exact subpath, else a `*` pattern.
 */
function moduleFile(specifier) {
  const name = packageOf(specifier);
  const dir = path.join(root, packageDirs[name]);
  const { exports } = JSON.parse(read(path.join(dir, 'package.json')));
  const subpath = `.${specifier.slice(name.length)}`;
  let target = exports[subpath];
  if (!target) {
    for (const [key, value] of Object.entries(exports)) {
      const [prefix, suffix] = key.split('*');
      if (
        suffix !== undefined &&
        subpath.length >= prefix.length + suffix.length &&
        subpath.startsWith(prefix) &&
        subpath.endsWith(suffix)
      ) {
        const star = subpath.slice(
          prefix.length,
          subpath.length - suffix.length,
        );
        target = JSON.parse(JSON.stringify(value).replaceAll('*', star));
        break;
      }
    }
  }
  const source = target?.['developing:choreo'];
  const file = source && path.join(dir, source);
  return file && fs.existsSync(file) ? file : undefined;
}
/**
 * A module's export names, `default` included. `unknown` names a re-export
 * whose names can't be listed, so imports from the module can't be checked.
 */
function exportsOf(file) {
  const tree = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set();
  const hasModifier = (node, kind) =>
    node.modifiers?.some((modifier) => modifier.kind === kind);
  for (const node of tree.statements) {
    if (ts.isExportDeclaration(node) && !node.exportClause) {
      // `export * from './x'`: follow it
      const specifier = node.moduleSpecifier.text;
      const base = path.resolve(path.dirname(file), specifier);
      const target = specifier.startsWith('.')
        ? [
            base,
            `${base}.ts`,
            `${base}.gts`,
            path.join(base, 'index.ts'),
            path.join(base, 'index.gts'),
          ].find(
            (candidate) =>
              fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
          )
        : undefined;
      const inner = target
        ? exportsOf(target)
        : { unknown: `export * from '${specifier}'` };
      if (inner.unknown) {
        return inner;
      }
      inner.names.forEach((name) => names.add(name));
    } else if (ts.isExportDeclaration(node)) {
      if (ts.isNamespaceExport(node.exportClause)) {
        names.add(node.exportClause.name.text);
      } else {
        for (const item of node.exportClause.elements) {
          names.add(item.name.text);
        }
      }
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      names.add('default');
    } else if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
        names.add('default');
      } else if (ts.isVariableStatement(node)) {
        for (const item of node.declarationList.declarations) {
          names.add(item.name.getText(tree));
        }
      } else if (node.name) {
        names.add(node.name.text);
      }
    }
  }
  return { names };
}
const moduleExports = memoized(exportsOf);
const importedDocs = [...realmDocs, ...packageReadmes];
const designDir = path.join(realm, 'design') + path.sep;
const badImports = [];
// the design records sketch APIs that were never built
for (const file of importedDocs.filter((doc) => !doc.startsWith(designDir))) {
  for (const [statement, clause, specifier] of read(file).matchAll(
    /\bimport\s+(?:type\s+)?([\w$]+\s*,\s*\{[^}]*\}|\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    const where = `${relative(file)}: ${statement.replace(/\s+/g, ' ')}`;
    if (retiredSpecifiers.has(specifier)) {
      badImports.push(`${where} — no such package`);
      continue;
    }
    if (!packageOf(specifier)) {
      continue;
    }
    const module = moduleFile(specifier);
    if (!module) {
      badImports.push(`${where} — ${specifier} is not an entry point`);
      continue;
    }
    const exported = moduleExports(module);
    if (exported.unknown) {
      badImports.push(
        `${where} — ${relative(module)} has \`${exported.unknown}\`, so its exports can't be checked`,
      );
      continue;
    }
    // `X` and `X, { … }` take the default export; `* as X` takes the module
    const imported = clause.startsWith('*')
      ? []
      : [
          ...(/^[\w$]/.test(clause) ? ['default'] : []),
          ...(clause.match(/\{([^}]*)\}/)?.[1] ?? '')
            .split(',')
            .map(
              (item) =>
                item
                  .trim()
                  .replace(/^type\s+/, '')
                  .split(/\s+as\s+/)[0],
            )
            .filter(Boolean),
        ];
    for (const name of imported) {
      if (!exported.names.has(name)) {
        badImports.push(
          `${where} — ${specifier} has no ${name === 'default' ? 'default export' : `export ${name}`}`,
        );
      }
    }
  }
}
assert.deepEqual(badImports, [], 'Imports the packages do not provide');

/** the hosted gallery is this realm, so its URLs name realm files */
const siteURLs = [];
for (const file of importedDocs) {
  for (const [url, pathname, fragment] of read(file).matchAll(
    /https:\/\/choreo\.boxel\.site\/([^\s)"'<>`#?]*)(?:#([^\s)"'<>`]+))?/g,
  )) {
    const decoded = decode(pathname);
    const target =
      decoded === undefined ? undefined : path.join(realm, decoded);
    const exists =
      pathname === '' ||
      (target !== undefined &&
        (fs.existsSync(target) || fs.existsSync(`${target}.json`)));
    const problem = exists && target && fragmentProblem(target, fragment);
    if (!exists) {
      siteURLs.push(`${relative(file)}: ${url}`);
    } else if (problem) {
      siteURLs.push(`${relative(file)}: ${url} ${problem}`);
    }
  }
}
assert.deepEqual(
  siteURLs,
  [],
  'choreo.boxel.site URLs that name no realm file',
);

/*
 * Links into the monorepo name files that exist, and the docs (the design
 * history aside, which records where things were) don't send a reader to
 * Choreo's archived repository.
 */
const repoLinks = [];
for (const file of importedDocs) {
  const markdown = read(file);
  for (const [url, repoPath, fragment] of markdown.matchAll(
    /https:\/\/github\.com\/cardstack\/boxel\/(?:blob|tree)\/main\/([^\s)"'<>`#?]+)(?:#([^\s)"'<>`]+))?/g,
  )) {
    const decoded = decode(repoPath);
    const target = decoded === undefined ? undefined : path.join(root, decoded);
    if (!target || !fs.existsSync(target)) {
      repoLinks.push(`${relative(file)}: ${url} names no file`);
      continue;
    }
    const problem = fragmentProblem(target, fragment);
    if (problem) {
      repoLinks.push(`${relative(file)}: ${url} ${problem}`);
    }
  }
  if (!file.startsWith(designDir)) {
    // `cardstack/choreo` itself, not a repository whose name starts with it
    for (const [url] of markdown.matchAll(
      /https:\/\/github\.com\/cardstack\/choreo(?![\w.-])[^\s)"'<>`]*/g,
    )) {
      repoLinks.push(`${relative(file)}: ${url} is the archived repository`);
    }
  }
}
assert.deepEqual(repoLinks, [], 'Links to repository files that are gone');
console.log(
  `${realmDocs.length} realm docs link only to files and headings that exist; imports, choreo.boxel.site URLs and repository links in ${importedDocs.length} docs resolve.`,
);
