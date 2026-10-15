# Replace alias-form base references in host, base and runtime-common

## Goal

No listed site names the base realm through the `https://cardstack.com/base/` alias (ADR 002 §1.4). The two comparisons that give wrong answers against prefix-form code refs — the CardDef skip in type-summaries and `Component` detection in module-contents / create-specs — compare against the prefix form and are covered by regression tests.

## Changes

### Imports and specifiers

- `runtime-common/helpers/ai.ts`: `loader.import('@cardstack/base/commands/search-card-result')`.
- `host/app/services/matrix-service.ts`: `importResource` for `card-api` and `file-api`.
- `host/app/services/ai-assistant-panel-service.ts`: `importResource` for `command`.
- `runtime-common/etc/eslint/missing-invokables-config.js`: the `enumOptions` / `enumValues` autofix inserts `@cardstack/base/enum`.

### Comparisons and ids

- `host/app/resources/type-summaries.ts`: skip CardDef by comparing `unresolveURL(ref.module)` and `ref.name` against `baseCardRef`. The initial types can come from a "Find instances" ref built from a served URL, or from a chooser `baseFilter` written in card code, so the module is canonicalized first.
- `host/app/services/module-contents-service.ts`: `isComponentDeclaration(declaration, virtualNetwork)` compares `unresolveURL(super.module)` against `baseRRI('card-api')`. `super.module` is the raw import specifier, so realm source still importing from the alias keeps working. `detail-panel.gts` passes the host's virtual network.
- `host/app/tools/create-specs.ts`: `SpecTypeGuesser.isComponent` reuses `isComponentDeclaration` and keeps its name fallbacks.
- `host/app/components/search/result-tile.gts`: `defaultResultsCardRef` is `baseCardRef`.
- `host/app/routes/render/meta.ts`: the searchable dependency is `baseRRI('searchable')`.
- `base/cards-grid.gts`: highlight card ids are built from `baseRealmRRI`.

## Tests

- Unit (`tests/unit/is-component-declaration-test.ts`): `isComponentDeclaration` recognises `Component` from `@cardstack/base/card-api` and from the alias, and a Glimmer component; it rejects `Component` from another module.
- Acceptance (code-submode inspector): "Find instances" on the base `CardDef` leaves the type picker on "Any".
- Existing: create-spec tests, code-submode inspector tests, cards-grid highlights.
- Lint host, base, runtime-common.

## Out of scope

- Widening or enabling `no-url-form-base-imports`.
- Legitimate alias tolerance: `equivalentURLForms`, `internalKeysFor`, the definition-lookup fallback, the base realm's identity constant.
