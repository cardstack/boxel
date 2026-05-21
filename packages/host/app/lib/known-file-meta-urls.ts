// In-memory registry of URLs that prerendered search has identified as
// file-meta (FileDef) rather than card instances. Populated as
// PrerenderedCard wrappers are constructed in `prerendered-card-search.gts`
// and consulted by `detectStackItemTypeForTarget` (stack-item.ts) and the
// operator-mode-overlays so that clicking a file row in CardsGrid /
// embedded-card overlays routes to a file stack item even when the
// file-meta resource hasn't been loaded into the store yet (prerendered
// results carry HTML only).
//
// Lives in `lib/` rather than under a component so it can be imported from
// both component-side code (which adds entries) and lib-side type detection
// (which only reads entries) without creating a lib → components cycle.
export const knownFileMetaUrls = new Set<string>();

export function clearKnownFileMetaUrls() {
  knownFileMetaUrls.clear();
}
