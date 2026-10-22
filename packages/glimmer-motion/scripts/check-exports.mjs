/**
 * Checks the package in the current directory resolves both ways its
 * package.json#exports is read:
 *
 * - `--source`: under the `developing:choreo` condition, every module in
 *   `src/` resolves to itself, so workspace apps compiling the package from
 *   source can import any subpath an npm consumer can. A pattern export maps
 *   one extension, so a new `.gts` module needs its own exact entry; this is
 *   the check that notices when one is missing.
 * - `--packed`: packs the package (its prepack builds it) and resolves every
 *   module's subpath against the tarball without the condition, for types and
 *   for the runtime, so what npm consumers install never depends on the
 *   condition or on `src/`, which the tarball leaves out.
 *
 * With neither flag, both run.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const SOURCE_CONDITION = 'developing:choreo';

const args = process.argv.slice(2);
const runSource = args.includes('--source') || !args.includes('--packed');
const runPacked = args.includes('--packed') || !args.includes('--source');

const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const failures = [];

function sourceModules() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/(?<!\.d)\.g?ts$/.test(entry.name)) {
        found.push(relative(join(pkgDir, 'src'), path));
      }
    }
  };
  walk(join(pkgDir, 'src'));
  return found.sort();
}

function subpathOf(module) {
  const bare = module.replace(/\.g?ts$/, '');
  return bare === 'index' ? '.' : `./${bare}`;
}

/**
 * Node's package-exports resolution, as far as these packages use it: exact
 * keys win over `*` patterns, the longest pattern prefix wins among patterns,
 * and a conditions object picks its first key that is in `conditions`.
 */
function resolveExport(exportsMap, subpath, conditions) {
  let target = exportsMap[subpath];
  let star;
  if (target === undefined) {
    const patterns = Object.keys(exportsMap)
      .filter((key) => key.includes('*'))
      .sort((a, b) => b.indexOf('*') - a.indexOf('*'));
    for (const key of patterns) {
      const [prefix, suffix] = key.split('*');
      if (
        subpath.startsWith(prefix) &&
        subpath.endsWith(suffix) &&
        subpath.length >= key.length - 1
      ) {
        star = subpath.slice(prefix.length, subpath.length - suffix.length);
        target = exportsMap[key];
        break;
      }
    }
  }
  while (target && typeof target === 'object') {
    const next = Object.keys(target).find(
      (key) => key === 'default' || conditions.includes(key),
    );
    target = next === undefined ? undefined : target[next];
  }
  if (typeof target !== 'string') {
    return undefined;
  }
  return star === undefined ? target : target.replaceAll('*', star);
}

const modules = sourceModules();

if (runSource) {
  for (const module of modules) {
    const subpath = subpathOf(module);
    const target = resolveExport(pkg.exports, subpath, [
      SOURCE_CONDITION,
      'types',
      'import',
    ]);
    if (target !== `./src/${module}`) {
      failures.push(
        `${pkg.name}${subpath.slice(1)} resolves to ${target ?? 'nothing'} under "${SOURCE_CONDITION}", not ./src/${module}; give it an exact entry in package.json#exports`,
      );
    }
  }
}

if (runPacked) {
  const work = mkdtempSync(join(tmpdir(), 'check-exports-'));
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', work], {
      cwd: pkgDir,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
    execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
    const packed = join(work, 'package');
    const packedPkg = JSON.parse(
      readFileSync(join(packed, 'package.json'), 'utf8'),
    );
    for (const module of modules) {
      const subpath = subpathOf(module);
      for (const conditions of [['types'], ['import']]) {
        const target = resolveExport(packedPkg.exports, subpath, conditions);
        if (!target || target.startsWith('./src/')) {
          failures.push(
            `${pkg.name}${subpath.slice(1)} resolves to ${target ?? 'nothing'} in the tarball for [${conditions}]`,
          );
        } else if (!existsSync(join(packed, target))) {
          failures.push(
            `${pkg.name}${subpath.slice(1)} resolves to ${target} for [${conditions}], which the tarball doesn't contain`,
          );
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `${pkg.name}: ${modules.length} modules resolve${runSource ? ` from source under "${SOURCE_CONDITION}"` : ''}${runSource && runPacked ? ' and' : ''}${runPacked ? ' from the packed tarball without it' : ''}`,
  );
}
