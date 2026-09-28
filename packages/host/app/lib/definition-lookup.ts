import {
  definitionDisplayName,
  definitionKind,
  getFieldDefinitions,
  loadCardDef,
} from '@cardstack/runtime-common';

import type { CodeRef, Definition } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type * as CardAPI from '@cardstack/base/card-api';

// Resolve a `CodeRef` to its `Definition` through the loader — what
// `CachingDefinitionLookup` does loaderlessly on the realm server, in the
// processes that have the classes in hand.
//
// Two readers, and the reason they share one copy is that they have to agree.
// The indexer builds a type's definition entry with this and lowers the type's
// `@operation` declarations against it; the browser lowers the same
// declarations again, locally, so an optimistic write runs the program the
// realm stored rather than a second reading of it. Two lookups that resolved a
// field path differently would produce two programs from one declaration, and
// the divergence would show up as a reconciliation conflict on a card nobody
// else touched.
//
// An unloadable ref resolves to undefined, which makes every path under it
// unresolvable — recorded by the caller, never raised. A definition build that
// failed over one unreachable dependency would report nothing at all, and a
// local lowering that threw would take down a write the realm can carry out
// perfectly well on its own.
export function makeDefinitionLookup(
  api: typeof CardAPI,
  loader: Loader,
  label: string,
): (codeRef: CodeRef) => Promise<Definition | undefined> {
  return async (codeRef: CodeRef) => {
    try {
      let card = await loadCardDef(codeRef, { loader });
      let { fields, fieldDefs } = getFieldDefinitions(api, card);
      return {
        codeRef,
        fields,
        fieldDefs,
        type: definitionKind(card),
        displayName: definitionDisplayName(card),
      };
    } catch (err: any) {
      console.warn(
        `${label}: could not resolve definition ${JSON.stringify(codeRef)}: ${
          err.message
        }`,
      );
      return undefined;
    }
  };
}
