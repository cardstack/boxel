// Reading a deck's declaration out of a pack.
//
// This lives apart from `import-map.ts` for one reason: opening a pack needs
// a zip reader, a zip reader needs `node:zlib`, and `import-map.ts` is part
// of the browser-safe surface (see `resolve.ts`). Parsing the declaration
// and unwrapping the container are different jobs, and only one of them
// needs a filesystem-era runtime.
//
// package.json is the declaration (name, version, deps, exports). A thin
// importmap.json may still carry lineage (`vendoredFrom`, `forkedFrom`) —
// it is not identity, not ranges, and not the lock.

import { readZipEntry } from './canonical-zip.ts';
import {
  IMPORT_MAP_PATH,
  parsePackages,
  type PackageMapEntry,
} from './import-map.ts';
import {
  PACKAGE_JSON_PATH,
  entryFromPackageJson,
  parsePackageJson,
  subpathExports,
  suggestedDependencies,
} from './package-json.ts';

function npmKeys(name: string | undefined): string[] {
  if (!name) {
    return [];
  }
  let keys = [name];
  let unscoped = name.replace(/^@[^/]+\//, '');
  if (unscoped !== name) {
    keys.push(unscoped);
  }
  return keys;
}

export function packageJsonFromPack(
  packBytes: Buffer,
): ReturnType<typeof parsePackageJson> {
  let raw = readZipEntry(packBytes, PACKAGE_JSON_PATH);
  return raw ? parsePackageJson(raw.toString('utf8')) : undefined;
}

export function packagesFromPack(
  packBytes: Buffer,
): Record<string, PackageMapEntry> | undefined {
  let pkg = packageJsonFromPack(packBytes);
  if (!pkg) {
    return undefined;
  }
  let fromMap = (() => {
    let raw = readZipEntry(packBytes, IMPORT_MAP_PATH);
    return raw ? parsePackages(raw.toString('utf8')) : undefined;
  })();
  let mapEntry =
    (pkg.name ? fromMap?.[pkg.name] : undefined) ??
    (pkg.name
      ? fromMap?.[pkg.name.replace(/^@[^/]+\//, '')]
      : undefined) ??
    (fromMap ? Object.values(fromMap)[0] : undefined);
  let entryPath = mapEntry?.sourceOnly
    ? undefined
    : entryFromPackageJson(pkg);
  let exports = mapEntry?.sourceOnly ? {} : subpathExports(pkg);
  let merged: PackageMapEntry = {
    version: pkg.version,
    entry: entryPath ? `$DECK/${entryPath}` : undefined,
    ...(Object.keys(exports).length > 0
      ? {
          exports: Object.fromEntries(
            Object.entries(exports).map(([alias, path]) => [
              `./${alias}`,
              `$DECK/${path}`,
            ]),
          ),
        }
      : {}),
    ...(mapEntry?.vendoredFrom
      ? { vendoredFrom: mapEntry.vendoredFrom }
      : {}),
    ...(mapEntry?.forkedFrom ? { forkedFrom: mapEntry.forkedFrom } : {}),
    ...(mapEntry?.derivedFrom ? { derivedFrom: mapEntry.derivedFrom } : {}),
    ...(mapEntry?.derivation ? { derivation: mapEntry.derivation } : {}),
    ...(mapEntry?.baseApi ? { baseApi: mapEntry.baseApi } : {}),
    ...(mapEntry?.sourceOnly ? { sourceOnly: mapEntry.sourceOnly } : {}),
    ...(mapEntry?.recoveredFrom
      ? { recoveredFrom: mapEntry.recoveredFrom }
      : {}),
  };
  let out: Record<string, PackageMapEntry> = {};
  for (let key of npmKeys(pkg.name)) {
    out[key] = { ...merged };
  }
  return out;
}

export function dependenciesFromPack(
  packBytes: Buffer,
): Record<string, string> {
  let pkg = packageJsonFromPack(packBytes);
  return pkg ? suggestedDependencies(pkg) : {};
}
