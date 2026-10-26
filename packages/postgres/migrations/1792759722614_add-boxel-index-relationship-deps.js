exports.shorthands = undefined;

// The card and file URLs a row's own relationships name, as dependency forms.
//
// A card+json GET assembles `included` from the card's relationships at read
// time, so the served document depends on every card it links, whether or not
// its index visit read that card. `deps` records only what the index visit
// read. A link the card merely renders is recorded on the HTML channel, in
// `prerendered_html.deps`, and only once the `prerender_html` job for the card
// has run. Until then the link is recorded nowhere, and a change to the linked
// card in that window does not reach the linking card: its `indexed_at` stays,
// so its validator, and the card document cache keyed on it, keep serving the
// linked card as it was, or a deleted one.
//
// This column closes that window. The index pass writes it with the row, from
// the relationships it serialized, and the invalidation fan-out reads it as a
// render edge: a card reached only through it is stamped and re-rendered, not
// re-indexed, the same as one reached through `prerendered_html.deps`.
//
// Nullable, with no default and no backfill. A row a pass wrote before this
// column existed already has its HTML rendered, so `prerendered_html.deps`
// carries its rendered links. Adding such a column is a catalog edit and is
// instant; the GIN index the fan-out's containment predicate needs is built
// by the next migration, concurrently.
//
// `boxel_index_pending` takes the column too: a commit copies every
// production column out of the pending row.
exports.up = (pgm) => {
  for (let table of ['boxel_index', 'boxel_index_pending']) {
    pgm.addColumn(table, {
      relationship_deps: { type: 'jsonb' },
    });
  }
};

exports.down = (pgm) => {
  for (let table of ['boxel_index', 'boxel_index_pending']) {
    pgm.dropColumn(table, 'relationship_deps');
  }
};
