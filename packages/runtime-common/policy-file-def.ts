import {
  baseFileRef,
  baseRealm,
  baseRRI,
  executableExtensions,
} from './constants.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import {
  FILEDEF_CODE_REF_BY_EXTENSION,
  extensionOfName,
} from './file-def-code-ref.ts';

// The `FileDef` subclass a policy rule's `targetType` is matched against for a
// stored non-card file, keyed by extension the way `inferContentType` keys its
// MIME types: lowercase, with the leading dot.
//
// It is the indexer's own extension table, so the type a rule is judged
// against is the type the file is indexed as. A rule naming an intermediate
// class covers every extension beneath it through the `FileDef` hierarchy: a
// `.png` resolves to `PngDef`, which a rule naming `ImageDef` matches.
//
// Module source is typed here as the indexer types `.ts` and `.gts`: as
// `TsFileDef` and `GtsFileDef`. The indexer has no type for `.js` and `.gjs`,
// which a module imports as readily as the other two, so they are typed as the
// module source they are: `.js` as `TsFileDef`, whose language is a superset
// of its, and `.gjs` as `GtsFileDef`. A module is matched on its code types
// alone, not the whole chain (see `isModuleSource`).
//
// Entries whose module is not a base-realm URL are left out. Those are
// resolved against the file's own URL at index time, which needs a virtual
// network, and this table is consulted without one.
//
// Modules are spelled in the `@cardstack/base/` prefix form, the form
// `identifyCard` emits for a base class and `baseFileRef` already uses, so
// every answer here compares against a class's identity in one spelling. The
// indexer's table spells them as base-realm URLs for its own resolution.
//
// The key is the file's extension and nothing else: renaming a file changes
// which rule matches it, and anyone who can write a file chooses its name.
export const POLICY_FILE_DEF_CODE_REF_BY_EXTENSION: Readonly<
  Record<string, ResolvedCodeRef>
> = Object.freeze(
  Object.fromEntries(
    Object.entries({
      ...FILEDEF_CODE_REF_BY_EXTENSION,
      '.js': FILEDEF_CODE_REF_BY_EXTENSION['.ts'],
      '.gjs': FILEDEF_CODE_REF_BY_EXTENSION['.gts'],
    }).flatMap(([extension, { module, name }]) =>
      module.startsWith(baseRealm.url)
        ? [
            [
              extension,
              { module: baseRRI(module.slice(baseRealm.url.length)), name },
            ],
          ]
        : [],
    ),
  ),
);

// The `FileDef` subclass a policy rule matches a stored file by, from its
// name alone. Static and synchronous: no module is loaded and no index row is
// read, so it can be consulted on paths that resolve before any definition
// lookup.
//
// - A mapped extension resolves to its `FileDef` subclass, module source
//   among them.
// - Any other extension, or none, resolves to `FileDef` itself, the root of
//   the hierarchy: a rule naming `FileDef` covers a file type nobody has
//   written a def for, and a narrower rule does not.
//
// A card instance's `.json` is typed by the card it adopts from, which only
// its document says; this answers `JsonFileDef` for any `.json`, and deciding
// that a path is a card instance is the caller's.
export function policyFileDefCodeRef(filename: string): ResolvedCodeRef {
  let extension = extensionOfName(
    filename.slice(filename.lastIndexOf('/') + 1),
  );
  if (!extension) {
    return baseFileRef;
  }
  return POLICY_FILE_DEF_CODE_REF_BY_EXTENSION[extension] ?? baseFileRef;
}

// Whether a stored file is module source, from its name alone.
//
// A module is matched on the part of its chain that is code: its own type, and
// any type between it and `FileDef`. So a rule reaches module source only by
// naming `TsFileDef`, `GtsFileDef` or a type between, and a rule on `FileDef`,
// written for the realm's data files, does not reach the code that renders
// them.
export function isModuleSource(filename: string): boolean {
  let extension = extensionOfName(
    filename.slice(filename.lastIndexOf('/') + 1),
  );
  return executableExtensions.includes(extension);
}
