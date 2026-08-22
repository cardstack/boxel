import {
  canonicalRRIImportMap,
  flattenInheritance,
  isExactVersionRRI,
  normalizeRRI,
  parseRRI,
  type RealmIdentifier,
  type RealmResourceIdentifier,
  type RRIImportMap,
} from '@cardstack/deck';
import {
  entryFromPackageJson,
  parsePackageJson,
  type PackageJson,
} from '@cardstack/deck/package-json';

export const DECKLIST_PATH = 'importmap.json';

export interface DeckLibSpec {
  // The catalog package supplying this product, including an exact Version.
  packageRRI: string;
  // The public name installed into the consumer's import map.
  specifier: string;
  // Module path inside packageRRI selected by Use and Install.
  entry: string;
  // The exact dependency lock published with the package.
  lock: unknown;
}

export interface DeckPackageDocuments {
  // The immutable package root is authoritative identity. package.json adds
  // conventional metadata; it does not introduce another location scheme.
  packageRRI: string;
  packageJson: string | PackageJson;
  // The exact import-map lock published with this Version.
  lock: unknown;
}

/** Adapt a sealed Version's conventional documents into the thin actions. */
export function deckLibSpecFromPackage(
  documents: DeckPackageDocuments,
): DeckLibSpec {
  let parsedRRI = parseRRI(documents.packageRRI);
  if (!parsedRRI.version || parsedRRI.path !== '') {
    throw new Error('Deck package documents require an exact package root');
  }
  let packageJson =
    typeof documents.packageJson === 'string'
      ? parsePackageJson(documents.packageJson)
      : documents.packageJson;
  if (!packageJson) {
    throw new Error('Deck package.json is not valid JSON');
  }
  if (!packageJson.name?.trim()) {
    throw new Error('Deck package.json must declare a name');
  }
  if (
    !packageJson.version ||
    (parsedRRI.version !== packageJson.version &&
      !parsedRRI.version.startsWith(`${packageJson.version}-`))
  ) {
    throw new Error(
      `Deck Version ${parsedRRI.version} does not agree with package.json version ${packageJson.version ?? '(missing)'}`,
    );
  }
  let entry = entryFromPackageJson(packageJson);
  if (!entry) {
    throw new Error(
      'Deck package.json must declare an importable exports, module, or main entry',
    );
  }
  return {
    packageRRI: normalizeRRI(documents.packageRRI),
    specifier: packageJson.name,
    entry,
    lock: documents.lock,
  };
}

export interface DecklistWrite {
  path: typeof DECKLIST_PATH;
  contents: string;
}

interface AdoptionPlanBase {
  selected: RealmResourceIdentifier;
  effectiveLock: RRIImportMap;
  // Deliberately present on every plan. A host action executes this list; it
  // cannot smuggle the old full-tree-copy behavior in behind the same verb.
  filesToCopy: readonly [];
}

export interface UseDeckPlan extends AdoptionPlanBase {
  verb: 'use';
  writes: readonly [];
}

export interface InstallDeckPlan extends AdoptionPlanBase {
  verb: 'install';
  writes: readonly [DecklistWrite];
}

export interface RemixDeckPlan extends AdoptionPlanBase {
  verb: 'remix';
  parent: RealmIdentifier;
  writes: readonly [DecklistWrite];
}

export type DeckAdoptionPlan = UseDeckPlan | InstallDeckPlan | RemixDeckPlan;

function assertExactTargets(lock: RRIImportMap): void {
  let targets = [
    ...Object.values(lock.imports),
    ...Object.values(lock.scopes).flatMap((scope) => Object.values(scope)),
  ];
  if (targets.some((target) => !isExactVersionRRI(target))) {
    throw new Error('a Deck adoption lock may only target exact Versions');
  }
}

function canonicalLock(value: unknown): RRIImportMap {
  let lock = canonicalRRIImportMap(value);
  assertExactTargets(lock);
  return lock;
}

function normalizeSpec(spec: DeckLibSpec): {
  parent: RealmIdentifier;
  selected: RealmResourceIdentifier;
  lock: RRIImportMap;
} {
  let parsed = parseRRI(spec.packageRRI);
  if (!parsed.version || parsed.path !== '') {
    throw new Error('DeckLibSpec.packageRRI must be an exact package root');
  }
  if (spec.specifier.trim() === '') {
    throw new Error('DeckLibSpec.specifier must not be empty');
  }
  let parent = parsed.root as RealmIdentifier;
  let selected = normalizeRRI(`${parent}${spec.entry}`);
  if (parseRRI(selected).path === '') {
    throw new Error('DeckLibSpec.entry must select a package resource');
  }
  return { parent, selected, lock: canonicalLock(spec.lock) };
}

function serializeDecklist(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lockDocument(lock: RRIImportMap): Record<string, unknown> {
  return {
    imports: lock.imports,
    scopes: lock.scopes,
    ...(lock.integrity ? { integrity: lock.integrity } : {}),
  };
}

function mergeScopes(
  base: Record<string, Record<string, RealmResourceIdentifier>>,
  overlay: Record<string, Record<string, RealmResourceIdentifier>>,
) {
  let result = Object.fromEntries(
    Object.entries(base).map(([scope, table]) => [scope, { ...table }]),
  );
  for (let [scope, table] of Object.entries(overlay)) {
    result[scope] = { ...(result[scope] ?? {}), ...table };
  }
  return result;
}

/** Use an immutable catalog product directly. Nothing in the realm changes. */
export function planDeckUse(spec: DeckLibSpec): UseDeckPlan {
  let { selected, lock } = normalizeSpec(spec);
  return {
    verb: 'use',
    selected,
    effectiveLock: lock,
    writes: [],
    filesToCopy: [],
  };
}

/** Install exact pins into the consumer's canonical decklist. */
export function planDeckInstall(
  spec: DeckLibSpec,
  current: unknown = { imports: {}, scopes: {} },
): InstallDeckPlan {
  let { selected, lock } = normalizeSpec(spec);
  let currentLock = canonicalLock(current);
  let effectiveLock: RRIImportMap = {
    imports: {
      ...currentLock.imports,
      ...lock.imports,
      [spec.specifier]: selected,
    },
    scopes: mergeScopes(currentLock.scopes, lock.scopes),
    ...((currentLock.integrity || lock.integrity) && {
      integrity: { ...currentLock.integrity, ...lock.integrity },
    }),
  };
  return {
    verb: 'install',
    selected,
    effectiveLock,
    writes: [
      {
        path: DECKLIST_PATH,
        contents: serializeDecklist(lockDocument(effectiveLock)),
      },
    ],
    filesToCopy: [],
  };
}

/**
 * Remix by inheritance. The authored child stores only the exact parent and
 * explicit overrides; the returned effective lock is the flattened browser
 * view and is never mistaken for authored state.
 */
export function planDeckRemix(
  spec: DeckLibSpec,
  overrides: unknown = { imports: {}, scopes: {} },
): RemixDeckPlan {
  let { parent, selected, lock } = normalizeSpec(spec);
  let child = canonicalLock(overrides);
  let flattened = flattenInheritance([
    { imports: lock.imports, scopes: lock.scopes },
    { imports: child.imports, scopes: child.scopes },
  ]);
  let effectiveLock: RRIImportMap = {
    imports: flattened.imports as Record<string, RealmResourceIdentifier>,
    scopes: flattened.scopes as Record<
      string,
      Record<string, RealmResourceIdentifier>
    >,
    ...((lock.integrity || child.integrity) && {
      integrity: { ...lock.integrity, ...child.integrity },
    }),
  };
  let authored = {
    imports: child.imports,
    scopes: child.scopes,
    ...(child.integrity ? { integrity: child.integrity } : {}),
    deck: { extends: parent },
  };
  return {
    verb: 'remix',
    parent,
    selected,
    effectiveLock,
    writes: [{ path: DECKLIST_PATH, contents: serializeDecklist(authored) }],
    filesToCopy: [],
  };
}
