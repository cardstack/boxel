import { readFile } from 'fs/promises';
import { join } from 'path';
import { namesNoRealmPolicy } from '@cardstack/runtime-common';
import type { RealmRegistryReconciler } from './realm-registry-reconciler.ts';
import { realmDiskPath } from './realm-disk-path.ts';

// Whether a realm may name a policy, answered without mounting it. A realm
// this process already holds is answered from the pointer it read, which costs
// no mount. It is not answered `true` merely for being held: a caller deciding
// whether any realm it names could contribute at all gets the same answer for
// a realm whether or not this process happens to hold it. (The one difference
// is a malformed pointer, which the realm has dropped and the file below is
// read as possibly naming a policy.) For any other realm, the answer is read
// from the `realm.json` in its directory. That file is where a mounted realm
// reads its policy pointer, and the only place it reads it from, since the
// indexed config card lags a write to it by an index pass. So a realm
// answered `false` here is one that, mounted, would say it has no policy.
//
// `false` only when the realm says it has no policy, or the file was read and
// names none. When the realm's pointer cannot be read, its directory cannot be
// found from its registry row, or the file cannot be read or parsed, the
// answer is `true`. The caller then asks the realm, mounting it where it must,
// as it would if this signal did not exist, so every realm still answers as
// its policy says.
export async function mayNameRealmPolicy(
  url: string,
  {
    reconciler,
    realmsRootPath,
  }: { reconciler: RealmRegistryReconciler; realmsRootPath: string },
): Promise<boolean> {
  let mounted = reconciler.mounted.get(url);
  if (mounted) {
    try {
      return (await mounted.getRealmPolicy()) !== undefined;
    } catch {
      return true;
    }
  }
  let row = reconciler.knownByUrl.get(url);
  let dir = row ? realmDiskPath(row, realmsRootPath) : null;
  if (!dir) {
    return true;
  }
  let doc: { data?: { attributes?: { policy?: unknown } } } | null;
  try {
    doc = JSON.parse(await readFile(join(dir, 'realm.json'), 'utf8'));
  } catch {
    return true;
  }
  return !namesNoRealmPolicy(doc?.data?.attributes?.policy);
}
