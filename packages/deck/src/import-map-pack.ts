// Reading a deck's manifest out of a pack.
//
// This lives apart from `import-map.ts` for one reason: opening a pack needs
// a zip reader, a zip reader needs `node:zlib`, and `import-map.ts` is part
// of the browser-safe surface (see `resolve.ts`). Parsing the manifest and
// unwrapping the container are different jobs, and only one of them needs a
// filesystem-era runtime.

import { readZipEntry } from './canonical-zip.ts';
import {
  IMPORT_MAP_PATH,
  parsePackages,
  type PackageMapEntry,
} from './import-map.ts';

export function packagesFromPack(
  packBytes: Buffer,
): Record<string, PackageMapEntry> | undefined {
  let raw = readZipEntry(packBytes, IMPORT_MAP_PATH);
  return raw ? parsePackages(raw.toString('utf8')) : undefined;
}
