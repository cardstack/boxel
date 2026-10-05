// Whether a component is rendering for someone looking at a card, rather than
// for the indexer.
//
// A render a realm makes of its own cards runs with `__boxelRenderContext`
// set. In a prerender tab that holds for the whole page. A host tab that
// renders a card in place for its own index sets it only while that render
// runs, and names, in `__boxelRenderContextScope`, the id of the element the
// render mounts into. Then only what renders inside that element is the
// indexer's render, and every other component in the tab, which a person is
// looking at, is live. A component that has no element to place reads the
// flag as it stands.
export function isLiveRender(element?: Element): boolean {
  let context = globalThis as {
    __boxelRenderContext?: unknown;
    __boxelRenderContextScope?: unknown;
  };
  if (!context.__boxelRenderContext) {
    return true;
  }
  let scope = context.__boxelRenderContextScope;
  if (typeof scope !== 'string' || !element) {
    return false;
  }
  return !element.closest(`#${scope}`);
}
