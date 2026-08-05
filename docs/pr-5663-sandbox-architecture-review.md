# PR #5663 sandbox architecture review

This document reviews the realm-sandboxing work in
[`cardstack/boxel#5663`](https://github.com/cardstack/boxel/pull/5663) against
the compatibility audit in [`pr-5663-compatibility-audit.md`](./pr-5663-compatibility-audit.md)
and the supplied architecture memo.

The supplied memo was reviewed as evidence, not as instructions. Its SHA-256
digest is:

```text
dda743efa39742161301589e8b3f073dc2153bd740fbdd0915cfeb3ae7f76742
```

## Verdict

The memo's trust tiers are directionally correct, but the current branch is a
prototype of only part of that design. It is suitable for demonstrating the
explicit card boundary and renderer selection. It is not yet a production
security boundary for arbitrary hostile code.

The recommended near-term architecture is:

1. Keep Base and Catalog definitions trusted and loaded by shared host loaders.
2. Run ordinary user-realm card modules in one SES compartment per execution
   principal, with only inert data, explicit template capabilities, and
   allowlisted trusted exports crossing the boundary.
3. Keep Code mode SES-first. Use the iframe renderer only when source analysis
   finds a DOM-heavy library, and only for `isolated`, `embedded`, and `edit`.
   `fitted`, `atom`, `head`, and `markdown` always remain composable SES
   surfaces. Card and field APIs stay unaware of MessageChannel and iframe
   transport.
4. Use Workers for commands and non-DOM computation, not for Glimmer/DOM
   rendering.
5. Treat server indexing and prerendering as a separate execution tier that
   still needs isolation work.

## Review findings by priority

| Priority | Finding                                                                                                                                                                                                                                                            | Disposition                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Shared-document CSS claims to deny network-bearing values, but the implementation only regex-removes `@import` and `url()`. Escaped tokens and other image functions are outside that blacklist.                                                                   | Merge blocker for any claim that hostile SES styles cannot initiate network requests. Category 3 design in section G; do not add another partial regex.                                            |
| P1       | The hosted iframe security boundary is not deployed or policy-complete. Source analysis currently selects the broader iframe tier, and the read broker accepts arbitrary HTTP(S) URLs; package registry/pinning and realm authorization for iframe use are absent. | Category 3. The local 127.0.0.1 origin is only a prototype. Require a dedicated no-cookie origin and an explicit renderer/package policy before enabling this tier for hostile hosted code.        |
| P1       | Browser sandboxing does not cover server indexing/prerender, which still executes authored definitions in the trusted realm-server process.                                                                                                                        | Category 3. Preserve `realm-execution` only as compatibility plumbing; isolate this process before claiming end-to-end hostile-code safety.                                                        |
| P2       | Main-thread SES prevents ambient authority but cannot terminate infinite loops or bound synchronous memory/CPU use.                                                                                                                                                | Category 2/3. State this limitation and add circuit breakers/recovery; send commands and untrusted non-DOM work to terminable Workers.                                                             |
| P2       | The iframe fetch response and draft source are still read into memory without byte limits.                                                                                                                                                                         | Category 1 follow-up. Add streaming byte caps, dependency-count limits, cancellation, and total per-preview budgets.                                                                               |
| P2       | Scoped CSS still permits browser-global registrations such as `@font-face` and `@property`; selector scoping alone cannot namespace them.                                                                                                                          | Category 1/3 follow-up. Define an AST-based allow/rename/reject policy and test collisions. Do not treat selector hashing as complete CSS namespace isolation.                                     |
| Resolved | Parent-side iframe messages previously validated only `protocol` and `type`; malformed payload fields crossed the boundary.                                                                                                                                        | Fixed with structural/type/size validation and 2/2 focused tests.                                                                                                                                  |
| Resolved | The iframe carried an unused `allow-downloads` permission.                                                                                                                                                                                                         | Removed.                                                                                                                                                                                           |
| Resolved | A plain authored `<style>` survived GTS compilation and became a global stylesheet when SES reconstructed the template in the shared host document.                                                                                                                | Source policy now routes it to iframe where allowed, and SES capture independently rejects any surviving literal style before reconstruction. `<style scoped>` remains the supported SES contract. |

## What the branch actually does

| Concern                    | Current behavior                                                                                                                                                                                                                                                          | Assessment                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base and Catalog           | Trusted host imports; shared across realms.                                                                                                                                                                                                                               | Correct for the stated policy. Trust must be tied to canonical resolved URLs/build artifacts, not user-controlled aliases.                                                                                                                                                                                                               |
| Ordinary user card         | Source is evaluated in an SES `Compartment` keyed by realm principal. No raw `window`, `fetch`, `localStorage`, or full `document` is endowed.                                                                                                                            | Good prototype. Main-thread CPU/availability remains unbounded.                                                                                                                                                                                                                                                                          |
| Trusted imports inside SES | Base/Card API is a narrow facade. Runtime Common is an explicit five-export facade. Ember helpers/decorators and Boxel presentation exports are represented as trusted identities and reified by the host.                                                                | Correct direction. The allowed export surface needs a versioned registry and tests; package-prefix trust alone is too broad for production.                                                                                                                                                                                              |
| Card data boundary         | Interactive host state receives an opaque CardDef-shaped record containing JSON snapshots, type metadata, presentation metadata, and a delegated render capability.                                                                                                       | Correct direction. Continue removing constructor/loader introspection from host UI.                                                                                                                                                                                                                                                      |
| Rendering                  | SES captures Glimmer template descriptors and reconstructs inert host components. Actions/getters are invoked through scoped component handles. Only compiler-extracted `<style scoped>` dependencies may cross this boundary; a surviving literal `<style>` is rejected. | Stronger than sharing live components, but this is already a renderer protocol and should be named/versioned as one. Scoped selectors are enforced; global-name at-rules remain an open policy item.                                                                                                                                     |
| Code mode                  | Every editable preview has a private revisioned loader. Ordinary source hot-swaps its last-good SES template and prewarms all format templates from one evaluated module; source requiring browser DOM/WebGL uses a stable iframe only for isolated, embedded, or edit.   | Compatible SES template revisions adopt the marker-bearing authored DOM in place. Incompatible programs replace only the stable island contents. This is DOM-preserving HMR, not JavaScript component-instance/state preservation. Warm format switches still avoid refetch/transpile/module evaluation and retain only inert templates. |
| DOM-heavy cards            | Static imports/browser-global signals request the iframe renderer for isolated, embedded, and edit. Fitted, atom, head, and markdown remain SES and fail closed if they need ambient DOM authority.                                                                       | Useful compatibility routing, not a security decision. Obfuscated/dynamic DOM use will fail in SES rather than escape it.                                                                                                                                                                                                                |
| iframe origin              | Configured separate origin, credentialless iframe, strict MessageChannel schema, read-only host fetch broker, bounded reported height. Current sandbox includes `allow-same-origin`.                                                                                      | Safe only when the iframe origin is dedicated, cookie-free, and contains no privileged endpoints. Hosted deployment is not complete.                                                                                                                                                                                                     |
| Worker                     | Worker evaluators exist for the spike and template experiments.                                                                                                                                                                                                           | Not yet the proposed general command runner/capability broker.                                                                                                                                                                                                                                                                           |
| Server indexing/prerender  | Runs real definitions in the trusted server/render process.                                                                                                                                                                                                               | Largest remaining trust gap. Browser isolation does not protect indexing.                                                                                                                                                                                                                                                                |
| Cross-realm imports        | Fetch uses the current user's realm authorization and rejects responses that do not identify a matching Boxel realm. Dependencies execute inside the importing principal's compartment.                                                                                   | Access control is preserved, but source provenance and least-privilege dependency execution are not.                                                                                                                                                                                                                                     |

## Rubric 1: low-risk explicit-boundary fixes

These preserve existing behavior while replacing implicit object-graph access.
They are appropriate to implement on this branch.

### Implemented during the review

- Added an explicit materialization purpose: ordinary host state receives
  `host-record`; server rendering/indexing and narrowly named validation paths
  request `realm-execution`.
- Restored opaque-card persistence and identity behavior through JSON boundary
  serialization.
- Added the delegated card-render capability used by Rich Markdown and migrated
  official `instance.constructor.getComponent(instance)` consumers to the
  boundary-aware API.
- Added `CardTypeService.introspect()` as the host API for display name,
  template presence, header color, `prefersWideFormat`, fields, and type ref.
  Schema generation, AI patch schema, and field-path validation adapt opaque
  metadata rather than reaching into the authored constructor.
- Restored inert `resource.meta` on opaque instances. This keeps host-owned
  `realmInfo` presentation such as workspace background URL without exposing an
  executable definition or loader.
- Migrated host-mode wide-format checks to `CardTypeService.introspect()`.
- Registered compartment template loading with Ember's test waiter so existing
  acceptance tests settle after the explicit asynchronous render boundary.
- Made fetched live-module shims carry explicit loader provenance. The
  resulting live-component escape hatch is guarded by `isTesting()` and is not
  reachable by production network source.
- Replaced the iframe parent boundary's type-only message check with structural
  validation and payload limits for ready, resize, and fetch messages.
- Removed the unused `allow-downloads` iframe sandbox permission.
- Made Code mode SES-first and format-aware. A browser-dependent source can be
  promoted to iframe for isolated, embedded, or edit, while fitted, atom, head,
  and markdown stay in SES. Delegated renderers consume the explicit surrounding
  format so fitted galleries cannot silently fall back to isolated.
- Made iframe height an explicit renderer capability for isolated, embedded,
  and edit. Embedded additionally applies trusted
  `safeModifier('observe-size')` at the delegated root. The child sends finite
  dimensions through the existing MessageChannel, the parent clamps and
  applies the height, and per-format CSS remains authoritative for overflow.
  Authored card and FieldDef code remains unaware of the transport.
- Closed the plain-style shared-document escape hatch. Source analysis routes
  an unscoped template `<style>` to iframe for isolated/embedded/edit, while
  SES template capture rejects any literal style left after compilation.
  Legitimate `<style scoped>` is removed from the Glimmer block by
  `glimmer-scoped-css`, carried as a hashed stylesheet dependency, and remains
  supported without changing authored card code.

### Still appropriate on this branch

- Add a typed render request for delegated field/ancestor rendering:

  ```ts
  interface CardRenderRequest {
    format:
      | 'atom'
      | 'embedded'
      | 'fitted'
      | 'isolated'
      | 'edit'
      | 'head'
      | 'markdown';
    fieldName?: string;
    componentCodeRef?: ResolvedCodeRef;
  }
  ```

  The result is a render capability, never the authored constructor, `Field`,
  `Loader`, or sandbox service.

- Give the explicit type descriptor a version and make it the only code-mode,
  schema-editor, and AI schema input. Avoid growing unrelated one-off tunnels.
- Add size/count limits to iframe fetch responses and MessageChannel payloads.
  These are bounded protocol checks, not a new architecture.

## Rubric 2: intentional function changes

These should be made explicit because preserving the old behavior would expose
too much authority.

### Do not support arbitrary DOM modifiers in SES

SES cards may use the restricted `safeModifier` and approved declarative
helpers. A card that needs arbitrary DOM nodes, browser globals, canvas, WebGL,
or third-party DOM modifiers belongs in the iframe tier.

Implication: some existing cards will change tier or fail closed until their
imports are classified. This is preferable to endowing the shared host DOM.

### Do not render DOM cards in Workers

Workers remain useful for commands, parsing, validation, and other pure
computation. Glimmer, Three.js, canvas, and browser-document libraries should
not be emulated in a Worker.

Implication: the worker renderer experiment should not define the product
contract. Keep only reusable command/evaluation pieces.

### Do not preserve arbitrary constructor reflection

Properties such as `getComponent`, fields, icons, edit-template presence,
themes, and `prefersWideFormat` must cross typed APIs. Unknown static properties
do not automatically become host-visible.

Implication: a card relying on an undocumented static property needs either a
new reviewed descriptor field or must drop that integration.

### Describe code preview honestly

The current code-mode protocol keeps the outer SES renderer boundary alive and
atomically installs only a successfully evaluated newest template. The SES
renderer serializes a Glimmer island even in the live browser; on a compatible
revision it releases the old program and rehydrates the replacement program
against the same marker-bearing nodes. A real Monaco-keystroke acceptance test
asserts exact authored element identity, updated text, and the explicit
`adopted` status. If Glimmer cannot adopt the replacement program, the renderer
replaces only the contents of the stable island and records `replaced`.

This is DOM-preserving HMR, not full Vite component-state HMR: the generated
component instance is still replaced, so unmodeled JavaScript-local state is
not promised to survive. Browser-only isolated/embedded/edit previews keep
their iframe and MessageChannel alive, but the child renderer may still replace
its authored subtree.

SES format switching is deliberately a separate optimization: the selected
format paints first, then all other formats are materialized from the same
evaluated module into a per-preview template-family cache. Switching formats
can therefore be warm without retaining multiple live DOM trees or allowing
hidden formats to run card effects.

## Shared CardIsland rehydration ownership

Host Mode and SES Code mode now use the same Glimmer serialization/rehydration
primitive rather than maintaining two identity systems:

- Server prerender serializes `CardIsland` with Glimmer boundary markers.
- The HTML island declares card URL, format, and a card-island protocol version.
- Host Mode moves that exact island container into the live card slot and only
  attempts adoption when URL, protocol, format, and markers are compatible.
- A mismatch or rehydration error keeps the container but performs a safe live
  render inside it, with an explicit replacement reason.
- SES Code mode uses the same marker/adoption mechanism for replacement
  template programs produced by the private preview loader.

Protocol versioning prevents an old cached server program from being adopted
speculatively by a host with a different boundary contract. Glimmer program
shape remains the final compatibility check; a failed adoption is recoverable
and never blocks the live card.

## Rubric 3: architecture proposals

These need maintainer/product feedback before implementation.

### A. Provenance-aware execution principals

Realm location alone is not durable provenance after copying or remixing. Add a
server-issued, immutable origin record when source is installed:

```ts
interface ExecutionPrincipal {
  userSession: string;
  sourceRealm: string;
  destinationRealm: string;
  sourceDigest: string;
  trustClass: 'official' | 'standard-library' | 'user' | 'untrusted';
  grants: string[];
}
```

Cache keys include the resolved source digest, policy version, and effective
principal. A dependency from another realm is authorized for the current user,
but its code retains its own provenance. The effective capability set is the
intersection of importer grants, dependency grants, and user permissions.

Open decision: whether copied source becomes newly authored destination code or
retains install provenance. The UI needs to expose that choice.

### B. Version the renderer boundary

Formalize the existing captured-template mechanism as `SandboxRenderer/v1`:

- JSON-cloneable model and field snapshots;
- trusted component/helper identity tokens from a reviewed registry;
- scoped getter/action handles;
- style/theme bundles with size limits;
- delegated child render requests;
- typed errors, loading state, cancellation, and protocol version;
- no live host services, module namespaces, DOM nodes, or loader objects.

This is less disruptive than replacing Glimmer with a JSON virtual DOM today,
while making the current implicit protocol auditable.

### C. Worker command capability broker

Move authored command execution to a Worker with explicit capabilities:

- card read/search constrained by user and realm permissions;
- card patch through typed commands and optimistic revision checks;
- AI proxy access without exposing provider keys;
- bounded network access through a URL/method policy;
- time, memory, output-size, and request-count budgets;
- cancellation and audit log.

Commands return structured-cloneable data. They never receive the host store,
Matrix client, loader, DOM, or raw credentials.

### D. Hosted iframe renderer origin

Use a dedicated renderer origin such as
`https://<nonce>.boxelusercontent.dev`, not a path on the host origin. It must
have:

- no Boxel auth cookies or privileged same-origin endpoints;
- CSP denying navigation, forms, popups, workers, and network by default;
- `frame-ancestors` restricted to approved Boxel host origins;
- `credentialless`, `referrerpolicy=no-referrer`, and a minimal sandbox token
  set;
- opaque random instance IDs and MessageChannel-only communication;
- schema/version validation and payload limits;
- pinned renderer/package versions and integrity verification.

`allow-same-origin` is acceptable only if the dedicated origin is intentionally
the iframe's security principal and has no ambient authority. Removing it would
produce an opaque origin and requires redesigning the current origin handshake;
do not toggle it casually.

Open decision: shared renderer origin versus a unique subdomain per iframe.
Unique subdomains improve storage/cache compromise isolation but require
wildcard DNS/TLS, strict parent validation, and lifecycle controls.

The source classifier is only a compatibility router. It must not itself grant
iframe authority. Before production, realm policy must separately authorize
whether a principal may use the iframe tier, and the renderer must load only
registered, version-pinned, integrity-verified package bundles. Today an
authored module can select iframe routing by importing a known DOM-heavy package
or referencing a browser global, and the iframe fetch broker accepts arbitrary
HTTP(S) GET URLs. That is acceptable for a local prototype, not for the hosted
security contract described above.

### E. Isolate server indexing and prerender

Browser isolation does not cover the realm server. Indexing currently needs the
real definition, inheritance, fields, computed values, and templates. Move that
work to a separately killable process/Worker/container with:

- read-only source and card snapshots;
- no realm/server secrets;
- bounded CPU, memory, output, and wall time;
- deterministic result documents;
- explicit dependency and capability manifests;
- per-card failure isolation.

The local `realm-execution` purpose is a compatibility marker, not the final
security model.

### F. Availability budgets

Main-thread SES is an authority boundary, not an availability boundary. Define
budgets before enabling hostile code by default:

- module bytes, dependency count/depth, and evaluation timeout;
- render tree and style bytes;
- getter/action count and frequency;
- MessageChannel request rate and payload size;
- iframe height/update rate;
- command CPU/wall time and output bytes.

A Worker/iframe/process can be terminated. A same-thread infinite loop cannot.

### G. Shared-document CSS boundary

The SES renderer injects compiler-extracted scoped CSS into the trusted host
document. The compiler rewrites ordinary selectors (including `body`, `:root`,
and `*`) with a per-component attribute and renames keyframes. Plain `<style>`
elements are no longer accepted at the SES boundary: source policy selects an
iframe where the format allows one, and the compiled-template boundary rejects
any surviving literal style before it can enter the host DOM.

This closes the direct global-selector leak, but it is not a complete CSS
security boundary. The runtime still removes `@import` and `url()` with regular
expressions; modern CSS has other network-bearing image functions, and CSS
escaping/comment syntax makes blacklist regexes fragile. Some at-rules such as
`@font-face` and `@property` also register names globally even when their
surrounding stylesheet came from `<style scoped>`.

Do not extend the blacklist one token at a time. Before production, choose one
of these designs:

1. parse and reserialize declarations with an allowlist of non-network-bearing
   properties/value grammars; or
2. keep authored CSS inside the dedicated iframe renderer and allow only
   trusted, generated theme tokens into the shared document.

Until one is implemented and bypass-tested, the SES tier should not be
described as preventing CSS-based network requests or all CSS namespace
collisions. It does now prevent a card from placing an arbitrary literal
stylesheet in the shared document.

## Recommended merge posture

Do not merge #5663 as a blanket claim that user code is secure. It can become a
reviewable foundation PR if it is narrowed and described as:

- opaque interactive card boundary;
- explicit introspection/delegated rendering;
- SES compatibility renderer for ordinary cards;
- dedicated iframe draft preview and DOM-heavy renderer prototype;
- no claim yet for hostile-code availability, server isolation, durable
  provenance, or general command-worker isolation.

Before merge, require the focused compatibility tests in the companion audit,
package lint/type checks, hosted iframe-origin configuration tests, and a
decision on shared-document CSS. Keep server isolation, durable provenance, and
command-worker isolation as explicit follow-up designs rather than silently
expanding this PR.
