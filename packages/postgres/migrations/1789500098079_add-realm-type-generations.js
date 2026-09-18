exports.shorthands = undefined;

// Per-card-type freshness watermarks, the type-scoped counterpart of
// `realm_generations`. A live search folds these into its cache key instead of
// the realm-wide generation, so a write only unreaches the cached searches
// whose types it could have moved.
//
// One row per (realm, type key), where the key is the `internalKeyFor`
// spelling `boxel_index.types` stores. `index_generation` tracks the index
// channel and `html_generation` the prerendered-HTML channel — both ride the
// key because search excludes rows with an effective error and a render error
// lands on the HTML channel, so scoping only the index leg would leave the
// realm-wide HTML watermark advancing on every render anywhere in the realm.
//
// `type_key = '*'` is the catch-all row every lookup folds in: it carries the
// watermark for a pass that could not enumerate its types and for a
// from-scratch rebuild, where a type whose last row vanished is named by
// nothing else. A realm with no row at all for a queried key reads as
// generation 0, which is sound — the first write that touches that type
// creates the row and moves the key.
exports.up = (pgm) => {
  pgm.createTable('realm_type_generations', {
    realm_url: { type: 'varchar', notNull: true },
    type_key: { type: 'varchar', notNull: true },
    index_generation: { type: 'integer', notNull: true, default: 0 },
    html_generation: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint(
    'realm_type_generations',
    'realm_type_generations_pkey',
    { primaryKey: ['realm_url', 'type_key'] },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('realm_type_generations');
};
