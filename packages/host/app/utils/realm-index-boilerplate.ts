// Placeholder content the host returns as `isolatedHTML` when it
// decides to skip the full isolated render for the realm's default
// CardsGrid index card. The decision is made per-render in
// `card-prerender.gts` based on the card URL, its adoptsFrom chain,
// and the realm's `includePrerenderedDefaultRealmIndex` config field
// — see the realm-index opt-in PR for the surrounding rationale.
//
// The boilerplate is intentionally minimal. Anywhere the placeholder
// could be visible (the published-realm SSR injection slot, the
// error-page `lastKnownGoodHtml` fallback for an erroring realm
// index, or any future consumer reading `isolated_html` directly) is
// out of the search-result hot path; we just need valid HTML that
// the Ember runtime can replace cleanly on hydration. The wrapper
// shape matches what `withTimeout` in
// `packages/realm-server/prerender/utils.ts` captures from a real
// render so downstream consumers don't see a structurally different
// payload.
export const REALM_INDEX_BOILERPLATE_HTML = `<section data-prerender>
  <div
    class="boxel-cards-grid-shell"
    data-boxel-cards-grid-index
    aria-busy="true"
  >
    Prerendered HTML for default realm index is disabled (can be configured in realm.json)
  </div>
</section>
`;
