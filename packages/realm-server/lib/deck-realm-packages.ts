import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseRRI, realmRRI } from '@cardstack/deck';
import { readRepositoryConfig } from '@cardstack/deck/node';

/**
 * The packages a realm hosts, as Deck core models a multi-package Repository.
 *
 * A realm is always a package: its root `package.json` names the realm RRI,
 * which is the Repository's identity and what the collaboration allowlist
 * names. A realm that hosts more packages says so the way a Deck depot does,
 * with a `.deck/repository.json` manifest whose `members` map each package
 * RRI to its authoring path. Boxel adds one constraint the manifest already
 * allows: the realm's own package is the member at `.` and a root, so the
 * whole realm tree is that package and every other member is a subtree of it.
 * All members advance together on one branch and share the realm root's lock.
 */
export interface DeckRealmPackages {
  realmRRI: string;
  // Package RRI → realm-relative authoring path (`.` for the realm itself).
  members: ReadonlyMap<string, string>;
}

export class DeckRealmPackagesError extends Error {}

async function readPackageName(path: string): Promise<string | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')).name;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError
    ) {
      return undefined;
    }
    throw error;
  }
  return typeof value === 'string' && value.startsWith('@')
    ? realmRRI(`${value.replace(/\/$/, '')}/`)
    : undefined;
}

/**
 * Read the packages a realm hosts, or `undefined` for a realm that is not a
 * Deck package at all. A manifest that disagrees with the packages on disk is
 * an error rather than a smaller answer, so a misconfigured realm never serves
 * one package under another's name.
 */
export async function readDeckRealmPackages(
  realmDir: string,
): Promise<DeckRealmPackages | undefined> {
  let rootRRI = await readPackageName(join(realmDir, 'package.json'));
  if (!rootRRI) {
    return undefined;
  }
  let manifest = await readRepositoryConfig(realmDir);
  if (!manifest) {
    return { realmRRI: rootRRI, members: new Map([[rootRRI, '.']]) };
  }
  if (manifest.members[rootRRI] !== '.' || !manifest.roots.includes(rootRRI)) {
    throw new DeckRealmPackagesError(
      `.deck/repository.json must name the realm's own package ${rootRRI} as a root at "."`,
    );
  }
  for (let [member, path] of Object.entries(manifest.members)) {
    if (member === rootRRI) {
      continue;
    }
    if (path === '.') {
      throw new DeckRealmPackagesError(
        `only the realm's own package may sit at ".", not ${member}`,
      );
    }
    let declared = await readPackageName(join(realmDir, path, 'package.json'));
    if (declared !== member) {
      throw new DeckRealmPackagesError(
        `${path}/package.json must name ${member}`,
      );
    }
  }
  return {
    realmRRI: rootRRI,
    members: new Map(Object.entries(manifest.members)),
  };
}

/** The member authored exactly at `localPath` (`.` or `a/b`), if any. */
export function memberAtPath(
  packages: DeckRealmPackages,
  localPath: string,
): string | undefined {
  let normalized = localPath.replace(/^\/+|\/+$/g, '') || '.';
  for (let [member, path] of packages.members) {
    if (path === normalized) {
      return member;
    }
  }
  return undefined;
}

/** A hosted package's mutable root URL inside the realm. */
export function memberURL(realmURL: string, path: string): URL {
  return new URL(path === '.' ? './' : `./${path}/`, realmURL);
}

/** The store name Deck core keys a package's Versions by: `scope/name`. */
export function storePackageName(packageRRI: string): string {
  let { scope, name } = parseRRI(packageRRI);
  return `${scope}/${name}`;
}
