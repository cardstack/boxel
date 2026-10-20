# CS-14090: Host AI tools accept realm-prefix identifiers

## Goal

Host AI tools take identifier inputs (`StringField`s documented as
identifiers), so a model can send a prefix-form id such as
`@cardstack/catalog/…`. The tools below parse those inputs with `new URL()`,
which throws on the prefix form (or, with a base, builds a URL that points
nowhere). Keep the inputs as identifiers and resolve them only at the network
boundary, as ADR 002 §1.2 requires and as `show-file`, `read-text-file` and
`read-source` already do.

## Steps

1. card-service: widen `saveSource`, `copySource`, `deleteSource` and
   `executeAtomicOperations` to take `RealmResourceIdentifier | URL`
   (`RealmIdentifier | URL` for the atomic realm), passing the identifier to
   `authedFetch` and resolving through the virtual network only where a URL is
   needed (the save subscriber, the loader's module check).
2. store: widen `__dangerousCreateFromSerialized`'s `relativeTo` to
   `RealmResourceIdentifier | URL`, matching the private method it wraps.
3. runtime-common `ModuleSyntax.addField`: widen `outgoingRelativeTo` /
   `outgoingRealmURL` to the identifier types `maybeRelativeReference` takes.
4. Tools: brand inputs with `rri()` / `ri()`, join with `RealmPaths.fileRRI`,
   and pass identifiers through:
   - `execute-atomic-operations`, `copy-file-to-realm`, `copy-source`,
     `add-field-to-card-definition`, `create-specs`, `generate-example-cards`,
     `check-correctness`, `run-realm-code` (show, `saveCards`, save/delete).
   - `evaluate-module`, `instantiate-card`: replace `assertHttpOrHttpsUrl` and
     the origin/path comparison with one shared check that resolves the module
     and the realm through the virtual network, requires http(s), and requires
     the module to be inside the realm.
5. software-factory skill docs: say the evaluate-module / instantiate-card
   identifiers may be URLs or prefix-form ids.

Out of scope: `sync-openrouter-models.ts` and `create-submission-workflow.ts`
(sibling ticket).

## Testing

Host integration tool tests that pass prefix-form ids for
`execute-atomic-operations`, `copy-file-to-realm`, `instantiate-card`,
`evaluate-module` and `run-realm-code` (`saveCards`), using a test prefix
registered on the test virtual network and removed afterwards.
`pnpm lint` in `packages/host` (and `packages/runtime-common`).
