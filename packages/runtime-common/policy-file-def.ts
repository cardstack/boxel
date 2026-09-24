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
// Two kinds of entry in that table are left out:
//
// - Module source (`executableExtensions`: `.js`, `.gjs`, `.ts`, `.gts`). The
//   indexer types `.ts` and `.gts` as `TsFileDef` and `GtsFileDef` so they can
//   be previewed, but module source is never grantable. Mapping those
//   extensions here would present them to a reader of this table as files a
//   rule can name; `policyFileDefCodeRef` answers `undefined` for them instead.
// - Entries whose module is not a base-realm URL. Those are resolved against
//   the file's own URL at index time, which needs a virtual network, and this
//   table is consulted without one.
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
    Object.entries(FILEDEF_CODE_REF_BY_EXTENSION).flatMap(
      ([extension, { module, name }]) =>
        !executableExtensions.includes(extension) &&
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
// - A mapped extension resolves to its `FileDef` subclass.
// - Any other extension, or none, resolves to `FileDef` itself, the root of
//   the hierarchy: a rule naming `FileDef` covers a file type nobody has
//   written a def for, and a narrower rule does not.
// - Module source resolves to `undefined`, which is not `FileDef`: there is no
//   type a rule could name to grant it.
//
// A card instance's `.json` is typed by the card it adopts from, which only
// its document says; this answers `JsonFileDef` for any `.json`, and deciding
// that a path is a card instance is the caller's.
export function policyFileDefCodeRef(
  filename: string,
): ResolvedCodeRef | undefined {
  let extension = extensionOfName(
    filename.slice(filename.lastIndexOf('/') + 1),
  );
  if (!extension) {
    return baseFileRef;
  }
  if (executableExtensions.includes(extension)) {
    return undefined;
  }
  return POLICY_FILE_DEF_CODE_REF_BY_EXTENSION[extension] ?? baseFileRef;
}
