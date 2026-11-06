// Which package a module in the build's output comes from, read from the
// nearest package.json above its file that names a package. The import
// allowlist and the build record both name modules this way, so what the
// allowlist admits is exactly what the record lists.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export const PACKAGE_ROOT = join(import.meta.dirname, '..');
// Where this repository's packages are, this one among them.
const WORKSPACE_PACKAGES = dirname(PACKAGE_ROOT);
export const PACKAGE_NAME: string = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
).name;

interface FoundPackage {
  root: string;
  name: string;
  version: string;
}

// A module on disk, by the package it belongs to and its path inside that
// package, or a bundler's virtual module, which has no file.
export type ModulePackage =
  | {
      virtual?: undefined;
      own: boolean;
      // A package of this repository's other than this one, compiled or read
      // from its source tree rather than installed: its version doesn't
      // change when its code does.
      workspace: boolean;
      name: string | undefined;
      version?: string;
      path: string;
    }
  | { virtual: string };

const manifests = new Map<string, FoundPackage | undefined>();

// Some packages ship a package.json in a subdirectory that only sets `type`,
// so a manifest without a name is passed over.
function nearestPackage(dir: string): FoundPackage | undefined {
  if (manifests.has(dir)) {
    return manifests.get(dir);
  }
  let found: FoundPackage | undefined;
  let file = join(dir, 'package.json');
  if (existsSync(file)) {
    let { name, version } = JSON.parse(readFileSync(file, 'utf8'));
    if (name) {
      found = { root: dir, name, version };
    }
  }
  if (!found && dirname(dir) !== dir) {
    found = nearestPackage(dirname(dir));
  }
  manifests.set(dir, found);
  return found;
}

export function modulePackage(id: string): ModulePackage {
  let file = id.split('?')[0];
  if (id.startsWith('\0') || !isAbsolute(file)) {
    return { virtual: id };
  }
  let found = nearestPackage(dirname(file));
  if (!found) {
    return {
      own: false,
      workspace: false,
      name: undefined,
      path: toPosix(file),
    };
  }
  let own = found.root === PACKAGE_ROOT;
  return {
    own,
    workspace:
      !own &&
      !found.root.split(sep).includes('node_modules') &&
      !relative(WORKSPACE_PACKAGES, found.root).startsWith('..'),
    name: found.name,
    version: found.version,
    path: toPosix(relative(found.root, file)),
  };
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}
