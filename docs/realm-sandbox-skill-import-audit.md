# Realm sandbox skill-import audit

Status: captured for later distillation and upstreaming to `boxel-skills`.

This document records what Boxel's shipped skills teach realm card authors to
import, how those imports map onto the SES realm sandbox, and which skill
instructions need to change. The checked-in
`packages/boxel-cli/plugin/skills` directory is generated from a pinned
`boxel-skills` release. Do not fix the generated copy in this repository;
distill these findings and apply them to the upstream skill source.

## Sources and method

The primary declared contract is:

- `boxel-patterns/references/libraries.md`

Supporting evidence came from all 53 curated
`boxel-patterns/patterns/**/example.gts` files plus the Boxel card, command,
file, Markdown, theme, UI, and glossary skills. Generic application and test
examples in `ember-best-practices` were excluded from the frequency counts;
they describe ordinary Ember applications, not necessarily realm cards.

Counts below are unique curated example files containing the import family:

| Import family                             | Files |
| ----------------------------------------- | ----: |
| `https://cardstack.com/base/*`            |    48 |
| `@cardstack/boxel-ui/*`                   |    18 |
| `@cardstack/boxel-icons/*`                |     7 |
| `@cardstack/runtime-common*`              |    14 |
| `@cardstack/boxel-host/tools/*`           |    12 |
| `@glimmer/component`                      |     6 |
| `@glimmer/tracking`                       |    15 |
| `@ember/helper`                           |     7 |
| `@ember/modifier`                         |    18 |
| `@ember/object`                           |     9 |
| `ember-modifier`                          |     6 |
| `ember-concurrency`                       |     6 |
| `ember-resources`                         |     1 |
| `https://esm.run/*` or `https://esm.sh/*` |     5 |

## Pulled workspace import inventory

The skill corpus is only the authored contract. On 2026-07-30 we also scanned
the pulled staging-realm source under
`/Users/chris/boxel-workspaces/realms-staging.stack.cards` so the compatibility
work is driven by cards people actually wrote.

The scan covered 3,072 `.gts`, `.gjs`, `.ts`, `.js`, and `.mjs` files and
found:

- 16,852 static runtime import/export-from occurrences;
- 1,415 distinct runtime module specifiers;
- 477 explicit type-only occurrences across 65 specifiers (not runtime grants);
- 77 literal dynamic-import occurrences across 27 specifiers.

Computed dynamic imports are intentionally not counted because their target is
not statically knowable. Two very large generated scene bundles exceeded
PCRE2's JIT stack only during the follow-up export-name breakdown; their module
specifiers were included by the primary inventory.

### Runtime imports by authority family

| Family                       | Occurrences | Distinct specifiers | Sandbox implication                                   |
| ---------------------------- | ----------: | ------------------: | ----------------------------------------------------- |
| Base                         |       6,219 |                  55 | trusted schema/presentation identities                |
| Relative/local realm modules |       3,816 |                 826 | evaluate under the importing realm principal          |
| Ember/Glimmer                |       3,202 |                  33 | explicit compartment facades or declarative protocols |
| Boxel icons                  |       1,707 |                 363 | trusted presentation identities                       |
| Boxel UI                     |       1,264 |                   4 | trusted presentation identities                       |
| Other bare packages          |         230 |                  66 | vet as pure code or keep denied                       |
| Boxel host commands/tools    |         157 |                  26 | revocable capability protocol required                |
| Runtime Common               |         143 |                   2 | export-by-export pure/capability classification       |
| ESM CDNs                     |          36 |                  13 | pinned module-service policy required                 |
| Catalog                      |          33 |                   4 | trusted schema/presentation identities                |
| Other absolute URLs          |          30 |                  19 | realm-authenticated graph or deny                     |
| Node builtins                |          15 |                   4 | deny in browser card compartments                     |

The most common concrete runtime modules were:

| Module                                                  | Occurrences |
| ------------------------------------------------------- | ----------: |
| `https://cardstack.com/base/card-api`                   |       2,108 |
| `https://cardstack.com/base/string`                     |       1,583 |
| `https://cardstack.com/base/number`                     |         902 |
| `@cardstack/boxel-ui/helpers`                           |         850 |
| `@glimmer/tracking`                                     |         680 |
| `@ember/modifier`                                       |         667 |
| `@ember/helper`                                         |         549 |
| `@cardstack/boxel-ui/components`                        |         377 |
| `@glimmer/component`                                    |         345 |
| `https://cardstack.com/base/boolean`                    |         297 |
| `ember-modifier`                                        |         270 |
| `@ember/object`                                         |         251 |
| `https://cardstack.com/base/markdown`                   |         238 |
| `https://cardstack.com/base/text-area`                  |         196 |
| `https://cardstack.com/base/enum`                       |         161 |
| `https://cardstack.com/base/url`                        |         151 |
| `https://cardstack.com/base/datetime`                   |         150 |
| `https://cardstack.com/base/date`                       |         150 |
| `@cardstack/runtime-common`                             |         142 |
| `ember-concurrency`                                     |         124 |
| `@ember/template`                                       |          79 |
| `@cardstack/boxel-host/commands/send-request-via-proxy` |          69 |

### Export-level priorities from real cards

The high-frequency Ember/Glimmer imports are concentrated rather than open
ended:

- `@glimmer/tracking`: `tracked` (673), `cached` (30);
- `@ember/object`: `action` (248), `get` (1);
- `@ember/modifier`: `on` (665);
- `@ember/helper`: `fn` (451), `concat` (141), `get` (103), `hash` (33),
  `array` (30), then a small tail;
- `ember-modifier`: `modifier` (135 named-import occurrences; default imports
  are counted at module level);
- `ember-concurrency`: `restartableTask` (96), `timeout` (30), `task` (29),
  `perform` (2);
- `@ember/template`: `htmlSafe` (77);
- `@ember/destroyable`: `registerDestructor` (25);
- `ember-provide-consume-context`: `consume` (36), `provide` (34).

`@cardstack/runtime-common` is not safe as a barrel. Real cards import both
pure identities and authority-bearing/runtime objects: `Command` (52),
`realmURL` (26), `codeRef` (17), `getField` (16), `Query` (11), and smaller
uses including `Loader`. Each export needs its own classification; the barrel
must not cross wholesale.

The complete current list can be regenerated read-only with multiline `rg`
over the pulled realm tree. Keep counts split into runtime, explicit
`import type`, and literal dynamic imports so erased types do not accidentally
become sandbox grants.

## Import classification for the sandbox

An import appearing in a skill is evidence that compatibility matters. It is
not evidence that the full host module can safely enter a compartment.

| Skill-taught surface                                   | Boundary form                                                                         | Current status                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Base and Catalog definitions                           | trusted schema or presentation identity                                               | importable; metadata and field identities supported, with no live host card instance            |
| Boxel UI and icons                                     | trusted host presentation identity reconstructed into template scope                  | supported                                                                                       |
| `@glimmer/component`                                   | compartment-owned base class                                                          | supported                                                                                       |
| `@ember/helper` structural helpers                     | trusted template identities                                                           | `array`, `concat`, `fn`, `get`, and `hash` supported                                            |
| pure `@cardstack/runtime-common` values                | explicit pure facade                                                                  | `baseRRI`, `codeRef`, `getMenuItems`, `realmURL`, and `searchEntryWireQueryFromQuery` supported |
| local and cross-realm modules                          | authenticated module fetch into the importing principal's compartment                 | supported when the user can read the resource and the response identifies a valid Boxel realm   |
| `@glimmer/tracking` and `@ember/object` actions        | compartment-owned persistent instances plus action handles and rerender notifications | decorator syntax and initial state supported; persistent action/rerender protocol missing       |
| `@ember/modifier` `on`                                 | trusted modifier identity plus compartment action handle                              | identity supported; interactive handler protocol missing                                        |
| `ember-modifier` and destroyables                      | declarative lifecycle/measurement protocol                                            | missing; raw callbacks must not receive shared-document elements                                |
| `ember-concurrency`                                    | compartment task scheduler, cancellation, projected task state, and rerender protocol | missing                                                                                         |
| `ember-resources`                                      | compartment resource lifecycle protocol                                               | missing                                                                                         |
| `getCard`, `getCards`, Store, and searches             | realm-scoped read/query capability                                                    | missing except the trusted search-results presentation component                                |
| edit/save/create APIs                                  | permission-derived, field- or card-scoped mutation handles                            | missing                                                                                         |
| `@cardstack/boxel-host/tools/*` and Catalog commands   | revocable command capability with validated JSON input/output                         | missing                                                                                         |
| Lodash and similar utilities                           | vetted pure facade or compartment-owned implementation                                | missing                                                                                         |
| ESM CDN modules                                        | pinned/vetted module service                                                          | intentionally denied today; arbitrary CDN fetch is not a realm-authorized module graph          |
| `window`, `document`, storage, `fetch`, `AudioContext` | narrow named capabilities, never ambient globals                                      | intentionally denied                                                                            |

## Skill defects and ambiguities to upstream

### 1. Stale menu API names

The generated skill corpus contains 31 references across eight files to:

```ts
getCardMenuItems
GetCardMenuItemParams
https://cardstack.com/base/card-menu-items
```

Current source exports are:

```ts
import { getMenuItems } from '@cardstack/runtime-common';
import type { GetMenuItemParams } from 'https://cardstack.com/base/menu-items';
import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';
```

The upstream skill source should update the pattern, command references,
glossary, and screenshot/thumbnail examples together. The sandbox exposes the
inert `getMenuItems` symbol so these modules can define the standard hook, but
the returned menu actions still need a declarative action-handle protocol.

### 2. “Always available” conflates importability with authority

The library catalogue currently presents Base, npm modules, host commands,
and CDN modules as portable tiers. The sandbox needs two additional dimensions:

- whether the module can be resolved inside a sandbox;
- what authority, if any, the resulting exports carry.

For example, a Base field can be an inert schema identity, a Boxel UI export
can be a trusted presentation identity, and a host command import must become
a capability token. These are all “importable” but are not equivalent grants.

### 3. DOM modifier examples assume shared-document authority

Several patterns teach `modifier((element) => ...)`, direct `document` access,
view transitions, canvas/WebGL setup, or DOM event listeners. Passing the
actual shared-document element to realm code defeats the SES shared-DOM tier.
These imports now also serve as renderer-selection evidence: an existing card
that genuinely needs document/canvas/WebGL behavior can run unchanged in the
separate-origin iframe `CardRenderer` tier. Skills should distinguish that tier
from declarative shared-DOM adapters such as:

- event/action binding;
- element size and intersection observation;
- focus and scroll requests;
- canvas or media surface handles;
- cleanup registration by opaque handle.

The iframe choice is runtime/host policy, not authored card syntax. A card or
`FieldDef` must not import an iframe helper, open a `MessageChannel`, or report
its own outer height. `CardRenderer` owns delegation, authenticated module
reads, lifecycle, and intrinsic sizing.

### 4. CDN imports need an explicit policy

The skills call ESM CDN URLs a portable tier. The current sandbox accepts
authenticated Boxel realm modules and rejects arbitrary non-realm responses.
Before restoring CDN examples in sandboxed cards, Boxel needs a pinned and
vetted module service, integrity/version policy, cache semantics, and a clear
decision about whether third-party code shares the realm principal or receives
an even narrower compartment.

### 5. Data and command examples need capability language

The skills teach `getCard`, `getCards`, Store access, `Command`, and host tool
classes as ordinary imports. Updated guidance should say that these APIs are
permission-bearing capabilities:

- reads are scoped to realm permissions and explicit query/card descriptors;
- writes are scoped to target realm, operation, and card/field;
- commands receive validated JSON and return JSON or opaque resource handles;
- no loader, Store, Ember owner, live card, secret, or host service crosses the
  boundary.

## Proposed upstream skill format

Every public import entry should carry a compact compatibility record:

```yaml
module: '@cardstack/boxel-host/tools/save-card'
realmCard: true
sandbox:
  status: capability
  authority: write-card
  scope: target realm and card id
  transport: validated JSON request/result
fallback: render disabled action with reason
```

Recommended status values:

- `pure`: compartment-owned or immutable data transform;
- `presentation`: trusted host identity usable only in reconstructed template scope;
- `capability`: revocable host operation with declared authority;
- `realm-module`: evaluated as user code under the importing principal;
- `unsupported`: fails closed with a named missing-contract diagnostic.

The skills should also separate type-only imports from runtime imports. A type
appearing in `.gts` source is erased and does not require a runtime facade.

## Distillation checklist

- Update the upstream menu-item API names and validate the example against the
  current runtime exports.
- Add sandbox status and authority columns to the library catalogue.
- Mark direct DOM/browser patterns as iframe-tier or unsupported in the
  shared-DOM tier; keep CDN authority explicit.
- Replace raw Store and host-service language with scoped capability language.
- Add one canonical sandbox-safe interactive card pattern once persistent
  state/action handles land.
- Add one canonical sandbox-safe command pattern once command capabilities
  land.
- Add a generated audit that verifies every runtime import used by a curated
  `example.gts` is present in the library catalogue with a sandbox status.
- Keep fail-closed diagnostics actionable: name the import and the missing
  protocol rather than reporting only “Failed to fetch.”

## Runtime changes informed by this audit

This branch adds the safe, immediately useful subset without widening ambient
authority:

- `baseRRI` and the inert `getMenuItems` symbol in the explicit
  `@cardstack/runtime-common` facade;
- `array`, `concat`, `fn`, `get`, and `hash` as trusted `@ember/helper`
  presentation identities;
- compartment-owned `CardDef`, `FieldDef`, and `Component` base classes so
  normal schema modules can evaluate without receiving the live Base realm
  constructors;
- inert `tracked`, `cached`, and `action` decorators, which preserve class
  initialization while withholding shared Ember state and host callbacks;
- focused tests proving these imports evaluate inside the compartment.

Everything with state, DOM, data, network, write, or command authority remains
fail-closed until its boundary protocol exists.

## Worker-tier learning

Moving the same evaluator into a worker exposed two host-only dependency leaks
that a main-thread compartment did not reveal:

- `Loader` reached `runtime-common/index.ts` for logging, environment detection,
  and executable-extension constants. That broad barrel pulled the GTS compiler
  and its top-level-await WebAssembly bootstrap into the worker bundle. These
  dependencies are now imported from narrow leaf modules.
- The sandbox import policy reached Ember's host environment configuration.
  The host now serializes an explicit exact/prefix policy into the worker at
  initialization; the worker does not import Ember configuration or learn a
  package resolver.

This suggests an upstream rule for Boxel skills and runtime APIs: a surface can
be safe to expose inside SES while its implementation module is still unsafe to
bundle into an isolated execution environment. Import compatibility records
should distinguish `workerSafe` from `sandbox` authority, and runtime facades
should depend on narrow, browser-neutral leaf modules rather than broad barrels.

The worker boundary also makes presentation timing explicit. Synchronous Ember
getters cannot call into a worker. Derived values must be projected to JSON at
render time, or updated later through an asynchronous action/state message that
causes the host to reconstruct or refresh the inert view.

Two source-compatibility details also became explicit under the worker:

- relative module and generated `*.glimmer-scoped.css` specifiers must remain
  relative until the importing module URL resolves them; treating them as bare
  packages loses the realm principal and breaks card styling;
- compiled GTS can contain authored HTML-comment markers inside serialized
  template data. SES rejects raw `<!--` and `-->` tokens at parse time, so the
  evaluator escapes the token spelling without changing the resulting template
  string.

## Iframe-tier learning

The pulled realms contain cards whose public contract is inseparable from a
real browser document: canvas modifiers, WebGL/Three.js renderers, media APIs,
pointer controls, and download creation. Reimplementing each one as an inert
shared-DOM template would change existing card code and still recreate a large
DOM capability surface.

The compatibility answer is a separate-origin `CardRenderer` tier. The runtime
delegates the same card, field name, component reference, format, and container
choice to a child renderer. A native `MessageChannel` carries named services;
the authored card has no iframe or messaging API. The first two services are:

- authenticated read-only card/module fetch, with credentials granted only by
  Boxel realm challenges and omitted for public dependencies;
- intrinsic size reporting, measured by the child renderer and applied by the
  parent renderer.

The Tribeca SignMaker is the first realistic acceptance fixture. Its unchanged
source imports Three.js 0.160, OrbitControls, STLExporter, SVGLoader,
`three-bvh-csg`, JSZip, Boxel UI, Boxel icons, Base fields, relative realm
modules, and an imperative canvas modifier. It renders its real canvas and
interactive controls through the generic iframe `CardRenderer` path.

This adds two fields to the proposed skill compatibility record:

```yaml
rendererTier: iframe
requires:
  - document
  - canvas-webgl
```

`rendererTier` describes host selection, not an import or instruction for card
authors. Browser process placement is an implementation detail; the guaranteed
boundary is separate origin plus iframe sandboxing and explicit capabilities.
