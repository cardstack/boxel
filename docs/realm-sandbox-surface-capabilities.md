# Surface capabilities for sandboxed cards

## Decision

Boxel should expose one versioned family of `surface-*` capabilities for UI
operations that currently tempt card code to import `ember-modifier` or reach
for `window`, `document`, or `navigator`.

These capabilities do not make browser objects safe. They replace ambient
browser authority with narrow Host-owned operations. A capability is always:

- attached to one registered surface root;
- limited to that root and its descendants;
- invoked with cloneable, size-bounded data;
- revoked when the surface generation is destroyed;
- implemented by the Host in SES and by the same protocol over MessageChannel
  in an iframe;
- observable and individually denyable by policy.

An external package that must execute with a real `Window`, `Document`,
`Navigator`, `Element`, browser observer, WebGL context, or unrestricted event
object runs in an iframe. We do not emulate the DOM inside SES.

## Authored API

New card and surface code imports capabilities from one audited standard
library module:

```gts
import {
  surfaceRoot,
  surfaceLifecycle,
  surfaceObserve,
  surfaceFocus,
  surfacePointer,
  surfacePresentation,
  surfaceStyle,
  surfaceTransition,
  surfaceSchedule,
  surfaceClipboard,
  surfaceHaptics,
  surfaceSlot,
} from '@cardstack/boxel-ui/surface';
```

The `surface` prefix is part of the security contract. It makes authority
visible to authors, static analysis, reviewers, and the runtime facade.

### DOM-bound modifiers

```gts
<section
  {{surfaceRoot this}}
  {{surfaceLifecycle this.connect}}
  {{surfaceObserve 'size' this.sizeChanged}}
>
  <button
    {{surfaceFocus 'on-insert'}}
    {{surfacePointer 'drag' this.dragChanged capture=true}}
  >
    Move
  </button>
</section>
```

Callbacks receive frozen records, never browser objects:

```ts
type SurfaceSize = { width: number; height: number };

type SurfacePointerUpdate = {
  phase: 'start' | 'move' | 'end' | 'cancel';
  pointerId: number;
  x: number;
  y: number;
  buttons: number;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
};
```

`surfacePointer` owns listener installation, pointer capture, coordinate
normalization, rate limiting, and cleanup. It cannot query outside the
registered surface root.

### Data and effect capabilities

```ts
let timer = surfaceSchedule.interval({ milliseconds: 1000 }, () => {
  this.advanceReplay();
});

await surfaceClipboard.writeText(this.shareText, {
  userActivation: event.activation,
});

surfaceHaptics.pulse({ milliseconds: 30 });
```

`surfaceSchedule` returns a revocable handle rather than a platform timer ID.
All scheduled work is cancelled when the owning surface generation is
destroyed. Clipboard, fullscreen, file picker, and similar operations require
a Host-issued user-activation token from the triggering projected event.

### Presentation capabilities

```gts
<article
  {{surfacePresentation containerBackground='match'}}
  {{surfaceStyle
    backgroundColor=this.statusColor
    transform=this.positionTransform
  }}
  {{surfaceTransition @model.id}}
></article>
```

`surfacePresentation` is the first shipped capability in this proposed module
family and is the transport-neutral counterpart to the existing CardDef
`headerColor` presentation metadata. Both values travel through the same
trusted, data-only presentation boundary, but they describe different
Host-owned regions:

- `headerColor` colors the Boxel card title bar and remains type metadata;
- `containerBackground` colors the Host container behind the rendered format
  and belongs to the mounted surface generation.

The initial background contract accepts `transparent`, a validated solid CSS
color, or `match`. With `match`, the trusted modifier reads the attached
surface root's computed solid `background-color` and publishes only the
canonical color value. Gradients, images, CSS variables, selectors, and
URL-bearing values never cross the boundary. If the root has no opaque solid
background, the Host keeps its ordinary container background.

This is intentionally not body cloning. Cloning DOM or CSS would duplicate
layout and asset behavior, cannot work across the intended unique iframe
origins, and would expose far more structure than placement requires. The
surface message carries one bounded presentation value and is revoked with the
surface generation.

`surfaceStyle` accepts a property bag, not arbitrary CSS text. The Host
allowlists properties and validates each value. URL-bearing properties,
stylesheet injection, selectors, and custom-property names outside an approved
namespace are rejected. `surfaceTransition` produces a Host-owned, render-slot
namespaced transition identity rather than accepting a global name.

### Host placement capabilities

```gts
<WorkerControls {{surfaceSlot 'card-toolbar'}} />
```

`surfaceSlot` does not return a Host element. It asks the Host to render a
declared surface contribution in a named slot. The Host decides whether the
slot exists, whether the card is allowed to contribute, and which projected
arguments and actions cross the boundary.

## Capability catalog

| Capability             | Replaces                                                | Authority retained by Host                         |
| ---------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `surface-root`         | ad hoc root discovery and DOM identity                  | surface id, generation, containment, teardown      |
| `surface-lifecycle`    | lifecycle-only `ember-modifier` callbacks               | insertion/removal and cleanup invocation           |
| `surface-observe`      | `ResizeObserver`, `IntersectionObserver`                | observer object, target element, throttling        |
| `surface-focus`        | `element.focus()`, `scrollIntoView()`                   | focus target validation and focus policy           |
| `surface-pointer`      | pointer listeners, pointer capture, drag modifiers      | live events/elements, capture, coalescing          |
| `surface-style`        | dynamic `style={{...}}`, direct style mutation          | property/value validation and application          |
| `surface-presentation` | Host container color and other placement presentation   | bounded values for Host-owned chrome and backdrop  |
| `surface-transition`   | `viewTransitionName`, document transitions              | namespacing and transition lifecycle               |
| `surface-schedule`     | `window.setTimeout`, `setInterval`, task delays         | timers, cancellation, quotas                       |
| `surface-clipboard`    | `navigator.clipboard`                                   | permission and user-activation checks              |
| `surface-haptics`      | `navigator.vibrate`                                     | availability, duration limits, user policy         |
| `surface-slot`         | portals and `document.querySelector()` into Host chrome | Host layout, slot allowlist, contribution lifetime |

Network, persistence, Realm queries, AI proxy requests, and commands are not
surface capabilities. They remain separate data capabilities because their
authority is a principal and Realm, not a DOM surface.

## One protocol across SES and iframe

The logical request is transport-neutral:

```ts
interface SurfaceCapabilityRequest {
  protocol: 'boxel-surface-capabilities/1';
  requestId: string;
  surfaceId: string;
  generation: number;
  capability: string;
  operation: string;
  args: unknown;
  activation?: string;
}
```

In SES, a trusted template token calls the Host dispatcher directly. In an
iframe, the same request crosses the iframe's private MessageChannel. The Host
validates the surface id, generation, granted capability, argument schema,
principal, rate limit, and optional activation token before executing it.

Responses and notifications use data-only records. Late messages from a stale
generation are ignored. Destroying the render slot revokes every observer,
listener, timer, pointer capture, slot contribution, and pending request owned
by that generation.

## Legacy compatibility

Existing staging cards should not be rewritten merely to enter SES. The Host
maintains an audited adapter registry for common existing imports:

```ts
interface LegacySurfaceAdapter {
  module: string;
  exportName: string;
  capability: string;
  adapterVersion: number;
}
```

An adapter does not execute the original modifier with a DOM element. It
recognizes an existing supported contract and reifies equivalent
`surface-*` behavior in the trusted renderer. Examples include a lifecycle
modifier whose element argument is unused, a focus modifier, and a bounded
resize callback.

No adapter is allowed when the package's behavior depends on arbitrary DOM
traversal, a real browser object, prototype identity, synchronous DOM return
values, or undocumented side effects. That package requires an iframe.

## Classifier rules

Classification operates on requested authority, not merely package names:

| Source behavior                                                                                                                                    | Tier                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Imports only audited `surface-*` capabilities                                                                                                      | SES                                                        |
| Uses a registered legacy adapter whose complete behavior is expressible as a surface capability                                                    | SES                                                        |
| Uses local variables or types named `document`, `window`, or `Element` without an unbound browser-global reference                                 | SES                                                        |
| Imports a pure external package with no browser authority                                                                                          | SES, subject to normal import policy                       |
| Imports an external package that must execute with `window`, `document`, `navigator`, a DOM node, WebGL, WebGPU, media device, or browser observer | iframe                                                     |
| Contains an unbound browser-global use not matched by a reviewed compatibility rule                                                                | iframe                                                     |
| Uses dynamic loading, evaluation, or syntax the authority analysis cannot classify                                                                 | iframe or fail closed when the format cannot use an iframe |

An authored CardDef may make one one-way request for a stronger boundary:

```gts
export class ImmersiveScene extends CardDef {
  static prefersFullSandbox = true;
}
```

`prefersFullSandbox` is strict per-CardDef metadata captured by the compartment
introspection boundary. For iframe-capable authored formats (`isolated`,
`embedded`, and `edit`), it means “run my renderer in an origin-isolated
iframe,” even when source analysis would otherwise allow SES. Dense formats
that intentionally cannot compose as iframe pills (`fitted`, `atom`, `head`,
and `markdown`) retain their existing confined Capsule or trusted Base fallback
path.

This descriptor is deliberately asymmetric. A card can ask for more isolation,
but `false` cannot weaken a decision made by source analysis, trusted package
metadata, a Realm policy, or Host policy. The request belongs to the CardDef
being rendered and does not propagate to cards that merely import its module.

The card cannot choose a weaker tier with a URL parameter, query parameter,
manifest assertion, or runtime value. Source analysis, the literal
`prefersFullSandbox` descriptor, trusted package metadata, the compatibility
registry, and Host policy make the final decision.

## Initial mapping for the five real-card probes

| Card                 | Surface capabilities                                                       | Separate data capabilities                | Remaining iframe-only portion                                         |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Scrabble Stream      | lifecycle, schedule                                                        | authenticated AI/Realm proxy              | none after its lifecycle adapter is proven element-free               |
| Tier Maker           | lifecycle, pointer, focus, style, transition, clipboard, haptics, schedule | none                                      | none if all drag behavior stays inside its surface root               |
| Assistant Run        | lifecycle, style, slot                                                     | Host commands and Realm runner operations | any third-party toolbar package that itself traverses Host DOM        |
| Signet Proposal      | lifecycle, pointer/ink or a delegated canvas surface                       | commands and persistence                  | third-party signature/canvas packages requiring a real canvas context |
| Invoice Billing Form | style                                                                      | Store mutation and save                   | none for its current color-only FieldDefs                             |

## Implementation order

1. Create `@cardstack/boxel-ui/surface` as the single authored entry point and
   make the existing `safeModifier` operations aliases of the corresponding
   surface capabilities.
2. Add the Host dispatcher, grant table, generation-based cleanup registry,
   schemas, quotas, and structured diagnostics.
3. Implement lifecycle, observe, focus, pointer, style, transition, and
   schedule; these unlock the largest portion of ordinary cards.
4. Add user-activation tokens and clipboard/haptics effects.
5. Add named Host slots without exposing portal elements.
6. Carry the identical protocol over the iframe MessageChannel.
7. Add reviewed legacy adapters one at a time, with a source fixture and a
   behavioral acceptance test for each.
8. Change the classifier from blanket import/global signals to
   operation-aware capability and package decisions.

## Security and compatibility gate

A new capability or legacy adapter is acceptable only when its test proves:

- no browser object crosses into authored code;
- targets cannot escape the registered surface root;
- arguments and results are validated and bounded;
- cleanup occurs on rerender, format switch, navigation, and failure;
- user-activation and permission requirements are enforced;
- SES and iframe transports have the same observable semantics;
- an unchanged representative staging card works through the adapter;
- an external package that genuinely requires ambient DOM authority remains in
  the iframe tier.
