// Enforces that every npm package this package imports is declared in its own
// package.json.
//
// Nothing else asks this question. TypeScript resolves modules by walking up to
// the workspace root, where a package hoisted for some other consumer resolves
// fine, so it checks that a module exists and never that this package declared
// it. eslint's `import/no-extraneous-dependencies` would ask it, but base has no
// eslint config, and the rule cannot model the four import idioms below.
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
const SOURCE_EXT = /\.(gts|ts|js)$/;

// `from '<specifier>'` and bare side-effect `import '<specifier>'`. Anchored on
// the import/export keyword so a specifier-shaped string in prose or in a
// template literal is not mistaken for one.
const FROM_IMPORT =
  /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm;
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
  const source = readFileSync(file, 'utf8');
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
