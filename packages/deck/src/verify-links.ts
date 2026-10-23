import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { IMPORT_MAP_PATH, treePathFromMapValue } from './import-map.ts';
import { packagesFromPack } from './import-map-pack.ts';
import { parseDependencyValue, LIVE_SPEC } from './lock.ts';
import {
  PACKAGE_JSON_PATH,
  entryFromPackageJson,
  parsePackageJson,
  suggestedDependencies,
} from './package-json.ts';
import {
  isValidDistTag,
  readStoreMeta,
  readStoredFile,
  readStoredPack,
} from './store.ts';
import { readEnvelope, verifyEnvelope } from './signature.ts';
import { readZipEntry } from './canonical-zip.ts';

// L11 · Fail closed — an unverifiable claim is refused, not warned about.
//
// This was the law that was half-true, which is the most dangerous state for
// a law to be in. Provenance was RECORDED and never CHECKED: the vendor
// wrote `repoVerified: 374/374` into the map and nothing ever read it back,
// so a hand-edited pin, a stale lock, or a dependency deleted out from under
// a deck all passed silently and only failed in a browser.
//
// What is checkable offline, and therefore checked on every publish:
//
//   - a pin exists for every declared dependency, and vice versa
//   - every pin still resolves to the version its dependency record implies
//   - the target version is published, and holds the file the pin names
//   - the deck's own declared entry exists in its own tree
//
// What needs the network is opt-in (`online`), because a publish that
// silently depends on a registry being up is a publish that fails at 3am.

export type LinkCode =
  | 'link-missing-record' // an import pin with no dependency record
  | 'link-missing-pin' // a declared dependency with no pin
  | 'link-integrity' // the pin disagrees with what the record resolves to
  | 'link-unresolvable' // the target version or file is not there
  | 'link-entry-missing' // the deck's own entry is not in its own tree
  | 'link-unsigned' // required endorsement absent (policy)
  | 'link-fetch-failed'; // an online check could not complete

export interface LinkFinding {
  code: LinkCode;
  specifier: string;
  detail: string;
}

export interface LinkReport {
  deck: string;
  findings: LinkFinding[];
  checked: number;
}

export interface VerifyLinksOptions {
  depotName: string;
  storeDir: string;
  // Exactly one of these: a live deck directory, or sealed pack bytes.
  deckDir?: string;
  packBytes?: Buffer;
  deck: string;
  // Refuse unless at least this many valid endorsements sit on the tree.
  requireSignatures?: number;
  treeHash?: string;
}

// A pin written by the lock, as it would be written today.
function expectedPin(
  depotName: string,
  target: { publisher: string; package: string },
  version: string | undefined,
  entry: string | undefined,
): { prefix: string; entry?: string } {
  let base = `/${depotName}/${target.publisher}/${target.package}`;
  let versioned = version === undefined ? base : `${base}@${version}`;
  return {
    prefix: `${versioned}/`,
    ...(entry ? { entry: `${versioned}/${entry}` } : {}),
  };
}

function parseDeckRef(
  value: string,
  depotName: string,
): { depot: string; publisher: string; package: string } | undefined {
  let segments = value.split('/');
  if (segments.length === 2) {
    return { depot: depotName, publisher: segments[0], package: segments[1] };
  }
  if (segments.length === 3) {
    return { depot: segments[0], publisher: segments[1], package: segments[2] };
  }
  return undefined;
}

export async function verifyLinks(
  options: VerifyLinksOptions,
): Promise<LinkReport> {
  let { depotName, storeDir, deck, deckDir, packBytes } = options;
  let findings: LinkFinding[] = [];
  let checked = 0;

  let pkgText: string | undefined;
  let mapText: string | undefined;
  if (packBytes) {
    pkgText = readZipEntry(packBytes, PACKAGE_JSON_PATH)?.toString('utf8');
    mapText = readZipEntry(packBytes, IMPORT_MAP_PATH)?.toString('utf8');
  } else if (deckDir) {
    try {
      pkgText = await readFile(join(deckDir, PACKAGE_JSON_PATH), 'utf8');
    } catch {
      pkgText = undefined;
    }
    try {
      mapText = await readFile(join(deckDir, IMPORT_MAP_PATH), 'utf8');
    } catch {
      mapText = undefined;
    }
  }
  if (pkgText === undefined) {
    return {
      deck,
      checked: 0,
      findings: [
        {
          code: 'link-missing-record',
          specifier: PACKAGE_JSON_PATH,
          detail: 'the deck has no package.json, so nothing about it is checkable',
        },
      ],
    };
  }

  let pkg = parsePackageJson(pkgText);
  let imports: Record<string, string> = {};
  if (mapText !== undefined) {
    try {
      let parsed = JSON.parse(mapText) as {
        imports?: Record<string, string>;
      };
      imports = parsed.imports ?? {};
    } catch {
      imports = {};
    }
  }
  let dependencies = pkg ? suggestedDependencies(pkg) : {};

  // The deck's own entry must exist in the deck's own tree.
  let declaredEntry = pkg ? entryFromPackageJson(pkg) : undefined;
  if (declaredEntry) {
    checked++;
    let present = packBytes
      ? Boolean(readZipEntry(packBytes, declaredEntry))
      : await readFile(join(deckDir!, ...declaredEntry.split('/'))).then(
          () => true,
          () => false,
        );
    if (!present) {
      findings.push({
        code: 'link-entry-missing',
        specifier: declaredEntry,
        detail: `${deck} declares this entry and does not contain it`,
      });
    }
  }

  for (let [specifier, declared] of Object.entries(dependencies)) {
    checked++;
    let { target: alias, spec } = parseDependencyValue(declared);
    let target = parseDeckRef(alias ?? specifier, depotName);
    if (!target) {
      findings.push({
        code: 'link-missing-record',
        specifier,
        detail: `"${declared}" names no deck this depot can resolve`,
      });
      continue;
    }
    if (target.depot !== depotName) {
      findings.push({
        code: 'link-unresolvable',
        specifier,
        detail: `depot ${target.depot} is not served from here`,
      });
      continue;
    }

    let scoped = `${target.publisher}/${target.package}`;
    let version: string | undefined;
    if (spec !== LIVE_SPEC) {
      let meta = await readStoreMeta(storeDir, scoped);
      if (!meta || Object.keys(meta.versions).length === 0) {
        findings.push({
          code: 'link-unresolvable',
          specifier,
          detail: `${scoped} has no published versions`,
        });
        continue;
      }
      version =
        semver.valid(spec) === spec
          ? meta.versions[spec]
            ? spec
            : undefined
          : (meta.tags[spec] ??
            semver.maxSatisfying(
              Object.keys(meta.versions).filter(
                (candidate) => semver.prerelease(candidate) === null,
              ),
              spec,
            ) ??
            undefined);
      if (!version) {
        findings.push({
          code: 'link-unresolvable',
          specifier,
          detail: `no published version of ${scoped} satisfies "${spec}"`,
        });
        continue;
      }
    }

    let entry: string | undefined;
    if (version) {
      let bytes = await readStoredPack(storeDir, scoped, version);
      let value = bytes
        ? packagesFromPack(bytes)?.[target.package]?.entry
        : undefined;
      entry = value ? treePathFromMapValue(value) : undefined;
      if (entry) {
        let present = await readStoredFile(storeDir, scoped, version, entry);
        if (!present) {
          findings.push({
            code: 'link-unresolvable',
            specifier,
            detail: `${scoped}@${version} declares entry ${entry} and does not contain it`,
          });
        }
      }
    }

    let pinSpec =
      spec === LIVE_SPEC ? undefined : isValidDistTag(spec) ? spec : version;
    let expected = expectedPin(depotName, target, pinSpec, entry);
    let actualPrefix = imports[`${specifier}/`];
    let actualEntry = imports[specifier];
    if (actualPrefix === undefined && actualEntry === undefined) {
      findings.push({
        code: 'link-missing-pin',
        specifier,
        detail: `declared as "${declared}" but nothing in imports resolves it — run \`deck lock\``,
      });
      continue;
    }
    if (actualPrefix !== undefined && actualPrefix !== expected.prefix) {
      findings.push({
        code: 'link-integrity',
        specifier: `${specifier}/`,
        detail: `pinned to ${actualPrefix}, but "${declared}" resolves to ${expected.prefix}`,
      });
    }
    if (
      expected.entry !== undefined &&
      actualEntry !== undefined &&
      actualEntry !== expected.entry
    ) {
      findings.push({
        code: 'link-integrity',
        specifier,
        detail: `pinned to ${actualEntry}, but "${declared}" resolves to ${expected.entry}`,
      });
    }
  }

  // A pin the lock owns, with no dependency behind it, is drift: it will
  // keep resolving until the day the deck it points at is pruned.
  for (let [specifier, targetUrl] of Object.entries(imports)) {
    let bare = specifier.replace(/\/$/, '');
    if (dependencies[bare] !== undefined) {
      continue;
    }
    let match = /^\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)(@[^/]+)?\//.exec(
      targetUrl,
    );
    if (match && match[1] === depotName) {
      checked++;
      findings.push({
        code: 'link-missing-record',
        specifier,
        detail: `pinned to ${targetUrl} with no entry in package.json dependencies`,
      });
    }
  }

  if (options.requireSignatures && options.treeHash) {
    checked++;
    let envelope = await readEnvelope(storeDir, options.treeHash);
    let valid = envelope ? verifyEnvelope(options.treeHash, envelope).valid : [];
    if (valid.length < options.requireSignatures) {
      findings.push({
        code: 'link-unsigned',
        specifier: options.treeHash,
        detail: `${valid.length} valid endorsement(s), ${options.requireSignatures} required`,
      });
    }
  }

  return { deck, findings, checked };
}

export function assertLinksOk(report: LinkReport): void {
  if (report.findings.length === 0) {
    return;
  }
  let lines = report.findings.map(
    (finding) => `  ${finding.code}  ${finding.specifier}: ${finding.detail}`,
  );
  throw new Error(
    `${report.deck}: ${report.findings.length} link problem(s)\n${lines.join('\n')}`,
  );
}
