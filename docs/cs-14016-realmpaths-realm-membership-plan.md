# Realm membership through RealmPaths in base and runtime-common

## Goal

Four sites check realm membership or resolve paths with `new URL` or
`startsWith` and assume card ids are URLs. For a realm registered under a
prefix (`@scope/name/`) a card id is canonical RRI in prefix form while the
realm meta (`card[realmURL]`) is the realm's URL, so these checks misfire.
Route each through `RealmPaths` or `resolveRRIReference`, comparing in one form.

## Approach

- `instanceRealmId(instance)` in `packages/base/card-api.gts`: the instance's
  realm folded through its own store's `canonicalizeId`, so it is in the same
  form as the instance's id. Card code uses it for same-form `RealmPaths` checks
  without holding the realm mappings.
- `isRealmIndexCardId` (`packages/runtime-common/realm-index-card.ts`): takes
  `RealmResourceIdentifier` / `RealmIdentifier | URL`. Without a VirtualNetwork
  it compares same-form; with one it brings both sides to URL form first. The
  host callers brand their ids with `rri()` / `ri()`.
- `packages/base/menu-items.ts`: the index-card delete and Create Listing guards
  pass the card's id with `instanceRealmId(card)`.
- `packages/base/realm-config.gts`: the policy-standing self-check is
  `RealmPaths(instanceRealmId(config)).local(id) === 'realm'`.
- `packages/base/query-field-support.ts`: the fallback when the store can't
  place a reference is `new RealmPaths(realmURL).inRealm(reference)`.
- `packages/base/code-ref.gts`: a relative module resolves with
  `resolveRRIReference(module, rri(cardURL))`, so it is valid on a prefix-form
  card and is stored in RRI form.

## Tests

- `tests/unit/realm-index-card-id-test.ts`: prefix-form cases, same-form and
  through a mapped network.
- `tests/unit/card-def-menu-items-test.ts`: Delete is omitted for the index card
  of a prefix-mapped realm, and offered for another card in it.
- `tests/integration/components/card-basics-test.gts`: a relative code ref on a
  card loaded from a prefix-mapped test realm validates and stores
  `@test/cards/person`.
- `tests/integration/realm-config-policy-standing-test.gts`: the config card of a
  prefix-mapped realm is recognised as its own and its policy standing is asked.
