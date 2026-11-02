import {
  identifyCard,
  isCardDef,
  isResolvedCodeRef,
  trimExecutableExtension,
  type Loader,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

// The card definitions a module declares itself. A card it only re-exports
// belongs to the module that declares it, and deleting this one leaves it be.
export async function cardDefinitionsInModule(
  loader: Loader,
  moduleURL: URL,
): Promise<ResolvedCodeRef[]> {
  let module = trimExecutableExtension(moduleURL.href);
  let exports = await loader.import<Record<string, unknown>>(module);
  let refs: ResolvedCodeRef[] = [];
  for (let value of Object.values(exports)) {
    if (!isCardDef(value)) {
      continue;
    }
    let ref = identifyCard(value);
    if (
      ref &&
      isResolvedCodeRef(ref) &&
      trimExecutableExtension(ref.module) === module &&
      !refs.some((r) => r.name === ref.name)
    ) {
      refs.push(ref);
    }
  }
  return refs;
}

// Cards that adopt from any of `definitions`, directly or through a subclass.
export function cardsUsingDefinitionsQuery(
  definitions: ResolvedCodeRef[],
  page: { number: number; size: number },
): Query {
  return {
    filter: { any: definitions.map((type) => ({ type })) },
    page,
  };
}
