// Which package a module in the build's output comes from, read from the
// nearest package.json above its file that names a package. The import
// allowlist and the build record both name modules this way, so what the
// allowlist admits is exactly what the record lists.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_NAME = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
).name;

const manifests = new Map();

// Some packages ship a package.json in a subdirectory that only sets `type`,
// so a manifest without a name is passed over.
function nearestPackage(dir) {
  if (manifests.has(dir)) {
    return manifests.get(dir);
  }
  let found;
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

// `{ own, name, version, path }` for a module on disk, where `path` is the
// module's path inside its package. A module that is not a file on disk — a
// bundler's virtual module — is `{ virtual: id }`.
export function modulePackage(id) {
  let file = id.split('?')[0];
  if (id.startsWith('\0') || !isAbsolute(file)) {
    return { virtual: id };
  }
  let found = nearestPackage(dirname(file));
  if (!found) {
    return { own: false, name: undefined, path: toPosix(file) };
  }
  return {
    own: found.root === PACKAGE_ROOT,
    name: found.name,
    version: found.version,
    path: toPosix(relative(found.root, file)),
  };
}

function toPosix(path) {
  return path.split(sep).join('/');
}
