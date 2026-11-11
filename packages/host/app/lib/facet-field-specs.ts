import {
  definitionDisplayName,
  definitionFacetValue,
  definitionKind,
  facetFieldSpecsOf,
  getFieldDefinitions,
  identifyCard,
  type Definition,
  type FacetFieldSpecs,
} from '@cardstack/runtime-common';

import type { Loader } from '@cardstack/runtime-common/loader';

import { makeDefinitionLookup } from './definition-lookup';

import type * as CardAPI from '@cardstack/base/card-api';

// The facet fields a card type declares (runtime-common's
// facet-declarations.ts), as the render stamps them into the search doc's
// `_searchText.facets` for the index writer's facet table. Read through the
// same definitions the query engine checks a facet against, built here from
// the live classes, so the table holds exactly the fields a query may facet
// by. Kept per class: a type's declarations change only with its module,
// which a new loader (and so a new class) brings.
const specsByClass = new WeakMap<object, Promise<FacetFieldSpecs>>();

export function facetFieldSpecsOfClass(
  api: typeof CardAPI,
  loader: Loader,
  Klass: typeof CardAPI.BaseDef,
): Promise<FacetFieldSpecs> {
  let cached = specsByClass.get(Klass);
  if (!cached) {
    cached = (async () => {
      let codeRef = identifyCard(Klass);
      if (!codeRef) {
        return {};
      }
      let { fields, fieldDefs } = getFieldDefinitions(api, Klass);
      let facetValue = definitionFacetValue(Klass);
      let definition: Definition = {
        codeRef,
        fields,
        fieldDefs,
        type: definitionKind(Klass),
        displayName: definitionDisplayName(Klass),
        ...(facetValue ? { facetValue } : {}),
      };
      return await facetFieldSpecsOf(
        definition,
        makeDefinitionLookup(api, loader, 'facet fields'),
      );
    })();
    specsByClass.set(Klass, cached);
    cached.catch(() => specsByClass.delete(Klass));
  }
  return cached;
}
