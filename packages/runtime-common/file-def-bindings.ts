import { isResolvedCodeRef } from './code-ref.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import { executableExtensions } from './constants.ts';
import {
  FILEDEF_CODE_REF_BY_EXTENSION,
  normalizeFileExtension,
} from './file-def-code-ref.ts';
import { realmConfigHrefFor } from './paths.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { Reader } from './worker.ts';

// A realm's own answer for which `FileDef` subclass a stored file is, keyed by
// the file's extension. The realm says which class an extension binds to; it
// does not say what counts as a file. That line is drawn by
// `FILEDEF_CODE_REF_BY_EXTENSION`, whose key space this map is confined to and
// whose entry it replaces — so a realm that declares nothing types every file
// exactly as it did before, and one that declares a binding changes the class
// of files the realm already treated as files.
//
// Keys are normalized extensions (lowercase, leading dot); values are fully
// resolved refs, so a binding can be compared to a `types` row or stamped onto
// a served document without resolving anything further.
export type FileDefBindings = Readonly<Record<string, ResolvedCodeRef>>;

export const NO_FILE_DEF_BINDINGS: FileDefBindings = Object.freeze({});

// The attribute the bindings arrive under on the realm's `RealmConfig` card.
// Named here rather than spelled at each reader so the card, the realm and the
// index runner cannot disagree about which member they are reading.
export const FILE_TYPE_BINDINGS_ATTRIBUTE = 'fileTypes';

// Extensions the platform keeps for itself, whatever a realm declares.
//
// These are in the extension table, so they pass the "is this a file" test —
// but what they name is the platform's own machinery rather than a realm's
// content. A bound `.gts` or `.ts` re-types every module's file row and asks
// the extractor to load the realm's class for each of them, the module
// defining that class included. A bound `.json` re-types every card instance's
// file row, the realm's own `realm.json` among them. Nothing downstream
// declines — the extractor imports whatever the ref names — so a class whose
// `extractAttributes` does not expect source text turns those rows into
// file-errors instead.
const PLATFORM_OWNED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...executableExtensions,
  '.json',
]);

// Read the realm's bindings out of the `fileTypes` attribute of its
// `RealmConfig` card.
//
// Everything here is a realm owner's hand-written JSON, so each part is held to
// a shape before it can bind anything, and what fails says so in the log rather
// than being dropped. A mapping a realm wrote and the realm cannot use reads,
// from the author's side, exactly like an operation that does not exist — so
// the one signal that distinguishes them has to exist.
//
// `module` resolves against the **realm's** URL rather than the file's. A
// binding is the realm's statement about a kind of file, not about one file, so
// resolving it per-file would make `./audit-log` mean a different module for a
// file in a subdirectory than for one at the root.
export function parseFileDefBindings(
  value: unknown,
  {
    realmURL,
    virtualNetwork,
    logWarn,
  }: {
    realmURL: URL;
    virtualNetwork: VirtualNetwork;
    logWarn: (message: string) => void;
  },
): FileDefBindings {
  if (value == null) {
    return NO_FILE_DEF_BINDINGS;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    logWarn(
      `ignoring the RealmConfig card's \`${FILE_TYPE_BINDINGS_ATTRIBUTE}\`, which is ${
        Array.isArray(value) ? 'an array' : typeof value
      } rather than a map of file extension to code ref`,
    );
    return NO_FILE_DEF_BINDINGS;
  }
  let bindings: Record<string, ResolvedCodeRef> = {};
  for (let [rawExtension, rawRef] of Object.entries(
    value as Record<string, unknown>,
  )) {
    let extension = normalizeFileExtension(rawExtension);
    if (!extension) {
      logWarn(
        `ignoring the file type binding for "${rawExtension}": a binding is keyed by a file extension, such as ".txt"`,
      );
      continue;
    }
    // Confined to the extensions already read as files. A realm that could
    // introduce one would have to be consulted by `urlNamesFile` and its
    // siblings, which decide file-or-card with no realm in scope — one of them
    // runs inside a card in the browser.
    if (!(extension in FILEDEF_CODE_REF_BY_EXTENSION)) {
      logWarn(
        `ignoring the file type binding for "${extension}": a realm binds a file extension the platform already reads as a file to its own FileDef subclass, and "${extension}" is not one of those`,
      );
      continue;
    }
    if (PLATFORM_OWNED_EXTENSIONS.has(extension)) {
      logWarn(
        `ignoring the file type binding for "${extension}": a realm binds the extensions of the content it stores, and "${extension}" names the platform's own — a module's source or a card instance's stored document`,
      );
      continue;
    }
    if (
      rawRef == null ||
      typeof rawRef !== 'object' ||
      Array.isArray(rawRef) ||
      typeof (rawRef as { module?: unknown }).module !== 'string' ||
      typeof (rawRef as { name?: unknown }).name !== 'string'
    ) {
      logWarn(
        `ignoring the file type binding for "${extension}": a binding names the FileDef subclass to bind, as \`{ "module": …, "name": … }\``,
      );
      continue;
    }
    let { module, name } = rawRef as { module: string; name: string };
    let resolved: ResolvedCodeRef;
    try {
      resolved = {
        module: virtualNetwork.resolveURL(module, realmURL)
          .href as RealmResourceIdentifier,
        name,
      };
    } catch (e) {
      logWarn(
        `ignoring the file type binding for "${extension}": "${module}" does not resolve against ${realmURL.href} (${
          (e as Error)?.message ?? e
        })`,
      );
      continue;
    }
    if (!isResolvedCodeRef(resolved)) {
      logWarn(
        `ignoring the file type binding for "${extension}": "${module}" did not resolve to a module reference`,
      );
      continue;
    }
    bindings[extension] = resolved;
  }
  return Object.freeze(bindings);
}

// The realm's bindings, read from its `realm.json` through a `Reader`.
//
// This is the index runner's half of the agreement the whole feature rests on:
// the realm reads the bindings from its stored `realm.json` document and so
// does the index runner, so a file cannot be typed one way in the row a pass
// writes and another way when an operation is dispatched against it. A
// `Reader` fetches `card+source`, which is that document's bytes.
//
// A realm with no `realm.json`, or one whose document does not parse, binds
// nothing — which is every realm today.
export async function readFileDefBindings({
  reader,
  realmURL,
  virtualNetwork,
  logWarn,
}: {
  reader: Reader;
  realmURL: URL;
  virtualNetwork: VirtualNetwork;
  logWarn: (message: string) => void;
}): Promise<FileDefBindings> {
  // Through the same helper the indexer ranks its visit order with and the
  // realm reads its own config from, so all three cannot disagree about which
  // document this is.
  let configURL = new URL(realmConfigHrefFor(realmURL));
  let fileRef: Awaited<ReturnType<Reader['readFile']>>;
  try {
    fileRef = await reader.readFile(configURL);
  } catch (e) {
    logWarn(
      `failed to read ${configURL.href} for file type bindings: ${
        (e as Error)?.message ?? e
      }`,
    );
    return NO_FILE_DEF_BINDINGS;
  }
  if (!fileRef?.content) {
    return NO_FILE_DEF_BINDINGS;
  }
  let attributes: Record<string, unknown>;
  try {
    let doc = JSON.parse(fileRef.content) as {
      data?: { attributes?: Record<string, unknown> };
    };
    attributes = doc?.data?.attributes ?? {};
  } catch (e) {
    logWarn(
      `failed to parse ${configURL.href} for file type bindings: ${
        (e as Error)?.message ?? e
      }`,
    );
    return NO_FILE_DEF_BINDINGS;
  }
  return parseFileDefBindings(attributes[FILE_TYPE_BINDINGS_ATTRIBUTE], {
    realmURL,
    virtualNetwork,
    logWarn,
  });
}
