// Enforces that every npm package this package imports is declared in its own
// package.json.
//
// Nothing else asks this question. TypeScript resolves modules by walking up to
// the workspace root, where a package hoisted for some other consumer resolves
// fine, so it checks that a module exists and never that this package declared
// it. eslint's `import/no-extraneous-dependencies` would ask it, but it
// early-returns on any specifier it cannot resolve, and under pnpm an
// undeclared package is precisely the unresolvable case — so it reports nothing
// on exactly the files this check exists to flag. Measured: enabled on base it
// finds zero, including on a file importing a package that does not exist.
//
// An undeclared import works until something compiles base's source against
// base's own dependencies — pnpm links only declared packages, so the package is
// simply absent from packages/base/node_modules. Two have reached main that way:
// `ember-provide-consume-context`, declared at a range that installed a second
// copy and broke context lookup, and `date-fns`, never declared at all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'declarations', '__boxel']);
// Matches `executableExtensions` in runtime-common: a card may be authored in
// any of these, and base's own eslint config already provisions for `.gjs`.
const SOURCE_EXT = /\.(gts|gjs|ts|js)$/;

// Run over source with comments and template-literal bodies blanked out, so a
// specifier-shaped string in prose cannot be mistaken for an import. The line
// anchor alone is not enough: the gap before `from` crosses newlines, so an
// `export class …` line followed by a comment would otherwise match whatever
// quoted text came next. `<` and `>` are excluded from that gap for the same
// reason in Glimmer templates, which are not JS strings and so survive the
// blanking above — no real import carries an angle bracket before its `from`.
const FROM_IMPORT =
  /^\s*(?:import|export)\b[^;'"<>]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
// `import('<specifier>')` with a literal argument. A dynamic import reaches the
// same module graph, so an undeclared package hides here just as well — and
// these are the ones a build resolves latest, so they surface furthest from the
// change that introduced them.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Each exemption is a statement about how the specifier resolves at runtime, and
// every one of them is also the reasoning that hid the two bugs above — so a new
// entry here needs to say why the package cannot simply be declared.
const EXEMPT = [
  {
    // Ember's own module namespaces ship inside ember-source, which base does
    // declare. There is no separate package to add.
    test: (s) => s.startsWith('@ember/') || s.startsWith('@glimmer/'),
    why: 'provided by ember-source',
  },
  {
    // Host tools and commands reach card code through the virtual network's
    // shim. Declaring it would be a cycle: host already depends on base.
    test: (s) =>
      s === '@cardstack/boxel-host' || s.startsWith('@cardstack/boxel-host/'),
    why: 'resolved by the host shim; declaring it would be a dependency cycle',
  },
  {
    // A realm resource identifier for this realm. Not an npm package.
    test: (s) => s === '@cardstack/base' || s.startsWith('@cardstack/base/'),
    why: 'self-referential realm identifier',
  },
  {
    // Card source may import straight from a URL; the realm serves it.
    test: (s) => /^https?:\/\//.test(s),
    why: 'absolute URL import, served by the realm',
  },
];

// Blanks out what is not executable: line and block comments, and the inside of
// template literals. Ordinary quoted strings are preserved, because that is
// where specifiers live.
//
// Written as a scan rather than a regex because the two interact: `//` inside a
// string starts no comment, and base imports from URLs (`https://esm.run/…`),
// so a naive comment strip would truncate a real specifier.
function blankNonExecutable(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith('//')) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Keep newlines so line-anchored matches still see line boundaries.
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (source[i] === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== '`') {
        if (source[j] === '\\') j++;
        j++;
      }
      out += '`' + source.slice(i + 1, j).replace(/[^\n]/g, ' ') + '`';
      i = Math.min(j + 1, source.length);
    } else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        j++;
      }
      out += source.slice(i, Math.min(j + 1, source.length));
      i = j + 1;
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (SOURCE_EXT.test(entry)) {
      yield full;
    }
  }
}

// `lodash-es/debounce` is provided by `lodash-es`; `@scope/pkg/sub` by
// `@scope/pkg`.
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const manifest = JSON.parse(
  readFileSync(join(baseDir, 'package.json'), 'utf8'),
);
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);

const undeclared = new Map();
for (const file of walk(baseDir)) {
  const source = blankNonExecutable(readFileSync(file, 'utf8'));
  const specifiers = [
    ...source.matchAll(FROM_IMPORT),
    ...source.matchAll(SIDE_EFFECT_IMPORT),
    ...source.matchAll(DYNAMIC_IMPORT),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (specifier.startsWith('.')) continue;
    if (EXEMPT.some((rule) => rule.test(specifier))) continue;
    const pkg = packageOf(specifier);
    if (declared.has(pkg)) continue;
    if (!undeclared.has(pkg)) undeclared.set(pkg, new Set());
    undeclared.get(pkg).add(relative(baseDir, file));
  }
}

if (undeclared.size > 0) {
  const detail = [...undeclared.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, files]) => `  ${pkg} — ${[...files].sort().join(', ')}`)
    .join('\n');
  console.error(
    'These packages are imported by base but not declared in packages/base/package.json:\n' +
      detail +
      '\n\nAdd each to package.json (use `catalog:` where the workspace pins one),\n' +
      'or add an exemption to EXEMPT in this script saying why it cannot be declared.\n' +
      'It resolves at runtime today is not sufficient: so did every bug this check exists to catch.',
  );
  process.exit(1);
}
console.log(
  `ok: every package base imports is declared (${declared.size} declared)`,
);
