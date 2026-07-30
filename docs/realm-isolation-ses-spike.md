# Realm-isolated cards with SES

This spike demonstrates five real Boxel cards across two realms running side by
side in one browser without sharing authority. The parent realm contains one
`ArticleCard`. The child realm contains `VideoCard`, `RecipeCard` (including Ask
AI), `CommentCard`, and an intentionally hostile `SecurityProbeCard`. The
parent delegates the three editorial slots without giving child code access to
the parent's private state; the probe can also be opened independently in the
ordinary Interact UI.

The preview is available locally at:

<http://localhost:4200/_realm-isolation-spike>

## The key idea

SES is only one layer of the boundary. The important architectural decision is
that card-authored JavaScript does not execute in the Ember page's global
environment.

Each active realm security principal gets:

1. Its own Web Worker and evaluated module loader.
2. An Endo SES `Compartment` inside that worker.
3. Card-instance capability handles chosen by the host.
4. No direct `window`, `document`, `localStorage`, Matrix session, realm
   credentials, or API key.

The trusted Ember host keeps authentication, network access, storage, and DOM
ownership. A card returns plain, serializable render data; the host projects
that data into the shared DOM using trusted Ember templates.

```text
Card program in SES Compartment
        |
        | capability request / render model
        v
Per-realm-principal Web Worker
        |
        | structured-clone messages
        v
Trusted Ember host capability membrane
        |
        +--> authenticated realm read/write
        +--> realm-scoped query
        +--> allowlisted command
        +--> optional AI proxy
        |
        v
Realm server / Matrix / external service proxy
```

Two cards may therefore share a DOM visually without sharing a JavaScript
global or browser ambient authority.

## Production compatibility invariant

The production target does **not** require realm authors to rewrite existing
card definitions or templates. The existing GTS card API is the compatibility
surface. Changes belong in the card compiler/runtime and the host renderer:

1. The loader fetches ordinary realm modules but does not evaluate untrusted
   module code in the host JavaScript realm.
2. A sandbox compilation target separates the card's executable program from
   its template and emits a constrained, serializable render program.
3. The executable program, including module initialization, computed fields,
   getters, helpers, and actions, is evaluated in an SES compartment.
4. The trusted host interprets render operations and owns the real DOM. DOM
   nodes, Ember owners, services, credentials, and host closures never become
   card endowments.
5. Existing template syntax is adapted by the runtime. Unsupported syntax is a
   runtime compatibility defect to implement or diagnose, not a required
   source migration for the card author.

This is a no-iframe design. Shadow DOM may still be useful for style scoping,
but it is not treated as an authority boundary.

## Loader and worker topology

The current host uses one `LoaderService.loader` for the application session.
It caches modules from all visible realms in one host JavaScript environment
and replaces that loader on session or code invalidation. That remains useful
for trusted host modules, but it cannot be the evaluator for untrusted card
modules.

The sandbox runtime should use the following layers:

```text
Host-wide immutable compile cache (keyed by source/content hash)
        |
        +-- Realm principal A worker + SES compartment + module loader
        |       +-- Card type X evaluated once
        |       |       +-- instance X/1
        |       |       +-- instance X/2
        |       +-- Card type Y evaluated once
        |
        +-- Realm principal B worker + SES compartment + module loader
                +-- Card type X evaluated independently
                        +-- instance X/3
```

The default lifecycle is **one worker and one evaluated module loader per
active realm security principal**, not one loader per card and not one loader
per card type. A principal key includes at least:

- authenticated session identity;
- owning realm URL;
- permission/capability policy version;
- module graph generation or invalidation epoch.

All card types in that principal reuse the loader's module cache. A card type
is evaluated once and may have many instance handles. Different realms never
share evaluated module state, even when they load the same card type. Immutable
transpilation artifacts may be shared by content hash because they contain no
live objects or authority.

Capabilities are bound to a card instance or invocation, not installed as a
worker-global ambient `fetch`. This prevents a card without the AI grant from
borrowing a more privileged sibling's capability merely because both cards
share a realm worker. If two cards in the same realm truly have incompatible
principal-level policies, the principal key places them in separate sandbox
loaders.

The runtime should expose counters so loader growth and cache behavior are
observable in development and tests:

- active realm-principal workers and evaluated loaders;
- active card instances per loader;
- evaluated card types and modules per loader;
- compile-cache hits and misses;
- module invalidations and worker restarts;
- denied cross-realm imports and capability calls;
- worker terminations caused by time, memory, or message budgets.

Idle realm workers can be LRU-evicted once they have no mounted card instances.
Code changes invalidate only affected principal loaders and dependent module
graphs; session changes revoke and destroy every loader belonging to the old
session.

## Actual card topology

The editorial page is backed by real card definitions, instances, and
relationships—not one synthetic record containing several pretend modules:

```text
Parent realm
└── ArticleCard
    ├── linksTo VideoCard ──────┐
    ├── linksTo RecipeCard ─────┼── Child realm
    └── linksTo CommentCard ────┘

Child realm
└── SecurityProbeCard (standalone Interact-mode adversarial test)
```

`ArticleCard` owns the story fields and its editorial isolated template.
`VideoCard`, `RecipeCard`, and `CommentCard` each own their data and beautiful
embedded/isolated templates. Ask AI belongs to `RecipeCard`. The separate
`SecurityProbeCard` is intentionally not linked into the article; it exercises
the same child-to-parent realm boundary in a normal Interact stack item.

The existing two staging realms are migrated in place. The previous primary
record URL is retained and its type is upgraded to `ArticleCard` in the parent
and `CommentCard` in the child; this avoids leaving an extra synthetic card in
either realm. The video, recipe, and security-probe instances are added to the
child realm.

## Ordinary Interact-mode security probe

The staging probe is available through the normal application route:

<http://localhost:4200/ctse/ses-isolation-ms7jy87e-child/security-probe>

It is a real card source and card instance in the reused child realm. The
shared `CardRenderer` recognizes its sandbox profile and mounts the trusted
sandbox projection inside the normal Interact stack item—there is no special
route and no iframe. Clicking the red **Scrape all data & send it** button runs
the hostile program in the realm's SES worker. The program:

- enumerates its compartment globals;
- reads its own serialized card snapshot;
- attempts to read the parent `ArticleCard`;
- constructs a payload containing everything it found;
- attempts to POST that payload to `https://attacker.invalid/collect`.

The own-card read succeeds. `window`, `document`, and `localStorage` are absent.
The parent read fails the realm-path check. The POST is routed through the
fetch-shaped capability and fails the exact AI-proxy allowlist before a network
request is created. The card then turns red and renders the attempted payload
and each allow/deny decision.

This Interact integration is a vertical slice, not yet the universal GTS
sandbox. The ordinary store still imports the probe's schema/type module in the
host to deserialize the card, while its adversarial program and interaction run
in SES. Completing the production invariant above still requires moving every
realm module's initialization, getters, helpers, and actions into the
per-principal loader and adapting arbitrary compiled GTS templates to the
trusted render protocol. Existing cards should not need source changes when
that runtime migration is complete.

## Worker and SES setup

The worker imports `ses` and calls `lockdown()` before evaluating card code. It
then creates a `Compartment` whose globals contain only hardened endowments:

- `capabilities`, containing the host operations available to every card.
- A proxy-shaped `fetch`, but only when that card was explicitly granted AI
  proxy access.

The compartment evaluates the realm program and exposes named actions such as
`initialize`, `increment`, `saveNote`, and `renderDelegated`. Calls and results
cross the worker boundary using `postMessage`.

Because the host does not endow browser globals, the spike confirms that
`window`, `document`, and `localStorage` are `undefined`. The usual
`Function(...)` escape does not reach the page global after SES lockdown.

## Realm-scoped data access

Card code cannot call authenticated network APIs directly. It asks the host to
perform an operation such as:

- `read-own-card`
- `write-own-card`
- `read-card`
- `query-own`
- `run-own-command`
- `proxy-fetch`

Every operation is handled against the card's immutable realm configuration.
For reads and writes, the host verifies that the target has the same origin and
is under the requesting realm's URL path. A sibling realm URL is rejected
before an authenticated request is made.

Queries are also created by the trusted host and restricted to the requesting
realm. The server's realm permissions remain the authoritative security
boundary; these client checks prevent one compromised card from borrowing the
host's broader in-browser authority.

Writes are narrower than general realm access in this spike. The edit form may
only submit:

```json
{ "note": "up to 500 characters" }
```

Attempts to change `role`, `counter`, `privateValue`, or add another property
are rejected by the host. The default edit template reflects this contract:
protected fields are read-only and only the note field is editable.

The increment button does not let the card execute an arbitrary command name.
The host accepts only the known `increment` command and applies it to that
card's own resource.

## Rendering in a shared DOM

The card program owns its display description: title, subtitle, fields,
actions, editor metadata, and optional AI UI metadata. This description is
hardened, returned across the worker boundary, and rendered by the trusted
Ember host.

The security demonstration is deliberately not arbitrary HTML or direct native
GTS execution. The host controls the elements and event wiring, and Ember
escapes field values. That keeps DOM authority out of the untrusted compartment
while still letting each card decide what content and actions its view
contains.

The four definitions also contain native Boxel GTS templates so they behave as
normal cards when opened in Boxel. Those native templates are not claimed to be
SES-isolated: the current card loader executes a GTS card module in the host
Ember runtime. The spike therefore uses the hardened render-model projection
for the adversarial test. Safely executing arbitrary native card templates
would require a constrained render protocol or a separate document boundary,
not merely wrapping action code in a `Compartment`.

Each card has an independent View/Edit toggle:

- **View** renders the card-produced display model.
- **Edit** uses a trusted, host-generated default edit template based on the
  card snapshot and the allowed write contract.

An action click invokes the corresponding named function in that card's worker.
The card may request a capability during the action, and the returned render
model refreshes only that card's host projection.

## AI proxy capability

Only the child card receives a `fetch` endowment. It is not the browser's real
`fetch`; it is a hardened facade that sends a `proxy-fetch` capability request
to the host.

The host then enforces all of the following:

- The card was granted AI proxy access.
- The URL exactly matches the configured OpenRouter chat-completions endpoint.
- The method is `POST`.
- The message roles and text are valid and bounded.
- At most eight messages are forwarded.
- The model, streaming setting, and token limit are fixed by trusted code.

The actual API key is never placed in the worker, compartment, render model, or
DOM. The authenticated host/server proxy performs the external request. A card
without the grant sees `typeof fetch === "undefined"`.

### Recipe context and bounded content command

Ask AI does not receive a live card object. Before an AI request, the child
worker calls a dedicated `readRecipe` capability. The host binds that capability
to the one configured `RecipeCard` URL and returns a frozen projection containing
only the recipe's editorial fields, ingredients, and steps. The current recipe
projection is included in the AI prompt, so answers and proposed substitutions
are grounded in persisted card data.

The model may return a complete proposed recipe, but it cannot write the card
itself. The reader must click **Apply full recipe update**, which invokes the
named `update-recipe-content` command. The host accepts that command only from
the child realm configuration and targets only the configured recipe URL. Its
schema permits exactly six editorial fields: `title`, `description`, `serves`,
`time`, `ingredients`, and `steps`. It rejects extra properties and bounds the
text, ingredient count, and step count before writing. This lets a serving-size
request update both the displayed yield and proportionally scaled ingredients.
The image, card type, relationships, and all unrelated state remain outside the
command's authority. The command then updates the real `RecipeCard` source and
returns a fresh read-only projection.

This separation keeps AI generation and mutation distinct:

```text
readRecipe capability → AI proposal → explicit user approval
  → update-recipe-content command → validated RecipeCard write
```

## Parent-to-child render delegation

Delegation is explicit data passing across the worker/host membrane:

1. The parent worker returns a request naming the child renderer and a props
   object.
2. The host validates the props against an allowlist.
3. Only `message` and `parentCounter` may cross the boundary.
4. The host invokes `renderDelegated` in the child worker with the sanitized
   props.
5. The child returns a serializable render model for the parent-owned slot.

If the parent attempts to pass `privateValue`, `note`, or any unknown property,
the host rejects the delegation. The child does not receive a parent object,
closure, DOM node, capability, or callback, so it has no path for inspecting
the rest of the parent's state.

## Hostile comment mode

The embedded comment module can switch between a normal reader experience and
a hostile-card simulation. Hostile mode does not display a fabricated result:
the child program enumerates its actual SES globals, reads its own card, records
the props delegated by the parent, attempts to read the parent card, and tries
to send its data to an arbitrary external URL.

The red evidence panel shows everything the attempt can observe. The child can
see its own realm data, its safe delegated props, hardened JavaScript
intrinsics, and its allowlisted AI proxy facade. It sees no DOM globals,
credentials, or API key. The host rejects both the parent-realm read and the
arbitrary network destination. Normal-mode comment submission is persisted in
the child card's own realm and survives worker and page reloads.

## What the spike proves

- Two cards from different realms can render in one page without sharing
  browser ambient authority.
- Each card can read, query, write, and run a command within its own realm.
- A cross-realm card read is denied even though the authenticated host can see
  both cards.
- Capabilities can differ per card; only one card receives the AI proxy.
- The API key does not need to enter card-controlled JavaScript.
- A parent can delegate rendering to a child using explicit, sanitized data.
- The child cannot inspect undelegated parent state.

## What still needs production hardening

This is an architectural spike, not yet a complete untrusted-code runtime.
Production work should add:

- Runtime schemas and size limits for every message and render-model result.
- Execution time, memory, message-rate, and recursion budgets, with worker
  termination on violation.
- A sandbox compilation target and reviewed module-loading policy for ordinary
  GTS card imports rather than evaluating one special source string.
- Capability manifests tied to realm/card identity and server-issued
  permissions.
- Revocation and lifecycle handling when a card, realm permission, or session
  changes.
- Audit logs for denied capability calls and delegated-render attempts.
- Tests against malicious getters, oversized structured-clone payloads,
  prototype edge cases, confused-deputy attempts, and compromised card source.
- A compatibility matrix and implementation coverage for the constrained
  render protocol. Existing templates must be translated to safe
  components/primitives by the runtime; directly granting DOM access would
  undo the isolation shown here.

The core rule should remain: **card code receives capabilities, never ambient
credentials or ambient host authority**.

## Relevant implementation files

- `packages/host/workers/realm-isolation-spike.ts` — worker startup, SES
  lockdown, compartment endowments, and message RPC.
- `packages/host/app/lib/realm-isolation-spike.ts` — realm guards, request
  sanitizers, card/program source, and shared types.
- `packages/host/app/templates/realm-isolation-spike.gts` — worker
  orchestration, trusted capability handlers, rendering, and default edit UI.
- `packages/host/tests/unit/realm-isolation-spike-test.ts` — focused boundary
  and sanitizer tests.
