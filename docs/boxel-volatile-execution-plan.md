# Volatile execution: promoting cards into an editable runtime

Directional plan for the workstream after sandbox HMR
([boxel-sandbox-hmr-extraction.md](boxel-sandbox-hmr-extraction.md)). Status:
design intent, pre-implementation.

## The product premise

Boxel is a platform where users — and increasingly agents on their behalf —
vibecode cards iteratively. But active, iterative source editing is the rare
state: in a steady-state deployment (a CRM inside a company), virtually every
mounted card is running stable, unedited code and should pay nothing for
editability. The two states want different runtimes:

- **Stable** (default): classifier-decided tier, shared per-principal
  runtimes, shared loaders, cacheable module identity, prerender placeholders.
  Cheap, warm, boring.
- **Volatile** (edit session): a card whose source is being actively and
  iteratively changed — by a person in code submode or by an agent applying
  edits. Needs draft buffers, HMR generations, acknowledgements,
  last-known-good retention, and module identity that can churn every few
  seconds without disturbing anything else.

Volatility is a **mode orthogonal to tier**, not a tier. A volatile card still
renders in Capsule or Sandbox per its classification; execution-tier rule 9
holds (promotion may strengthen isolation, never grant Direct).

## Promotion is one-way for the session

Promote a mounted card to volatile when editing intent is observed:

- code submode opens on a module in the card's graph;
- the AI assistant / an agent begins a source-edit session touching the
  module;
- an explicit author affordance requests it.

There is no demotion. Once a module goes volatile it stays volatile in the
loader until the tab closes; the next fresh session starts stable again from
persisted state. This deletes the frozen branch's quiet-period lease
machinery (`VolatileModuleRegistry`'s 90s renewable lease) and its
lease-expiry-mid-save race entirely — the volatile registry simply retains
entries for the session lifetime. The cost is bounded: a volatile session's
extra state is per-tab and evaporates with it, and the stable-graph isolation
below guarantees the rest of the workspace never pays for it.

## Isolation requirement: volatility must not leak

The core cost to avoid: an edit session invalidating loaders or module
identity shared with other mounted cards. Editing one card in a workspace
must not re-render, re-fetch, or flash the neighbors.

- A volatile session gets its own module registry that **shadows only the
  edited modules** over the stable graph (the frozen branch's detached child
  Loader + volatile buffer pattern). Unedited dependencies resolve through the
  shared stable cache.
- Stable consumers of the same module keep the last persisted generation
  until the session commits (save → acknowledgement) — the draft is visible
  only inside the volatile session's own render.
- On commit, the ordinary realm invalidation path updates stable consumers
  once, not per keystroke.

## Vite-like HMR as the quality bar

"Reload the iframe" is the floor, not the target. The refresh/flash budget:

- module-level hot replacement: invalidate exactly the edited module and its
  importers within the session registry, nothing else;
- re-render only the affected component islands; card data/document state is
  reused unchanged across generations (the dossier's finding: this is what
  makes focus preservation free);
- DOM survives whenever the template's identity survives; last-known-good
  stays mounted under a floating error overlay when a generation fails;
- zero resize messages when layout is unchanged (height service reports
  deltas only);
- the iframe, its origin, and its browsing context are never recreated for
  an ordinary edit (RP-15.3); only the explicit hard-reload path remints.

An accept-boundary refinement (a module declaring it can hot-swap without
re-render, vite-style `import.meta.hot` semantics) is a candidate follow-on
once basic generations ship; it must be designed against the Capsule/Sandbox
boundary rules rather than copied from vite.

## Sequencing

1. Sandbox HMR generations per the extraction dossier (in progress).
2. Volatile promotion: session-lifetime shadowing module registry,
   stable-graph isolation, routing input to the execution policy.
3. Capsule-tier volatile support (needs the DOM-adoption dossier the
   extraction analysis explicitly deferred).
4. Accept-boundary / vite-like refinements; agent-facing affordances (an
   agent can open and close a volatile session explicitly, so vibecoding
   sessions get HMR without the user leaving the canvas).

## Protocol implications

This un-defers more of RP-17.1 and will need spec sections + conformance
statements for: volatile promotion as a routing input (RP-6 extension),
generation acknowledgement semantics shared with HMR, and the
isolation guarantee that a volatile session cannot invalidate a stable
consumer's render (a negative conformance test).
