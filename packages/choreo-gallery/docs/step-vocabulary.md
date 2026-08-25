# The step vocabulary, opened

> **Status: design, part 1 landed.** This is the second of the
> three gaps the 2026-08-23 superset audit left standing, and the one that
> blocks the next-generation Boxel work — the audit's line was "no custom
> step kind, which also blocks `follow` / derived tweens (one cue reading
> another's live value)."

The parent document is [choreo-constructs.md](choreo-constructs.md).

- [What is actually closed](#what-is-actually-closed)
- [Two asks wearing one name](#two-asks-wearing-one-name)
- [Part 1 — a block can be named](#part-1--a-block-can-be-named)
- [Part 2 — composite steps, in public](#part-2--composite-steps-in-public)
- [Part 3 — `c.Follow` and the derived cue](#part-3--cfollow-and-the-derived-cue)
- [What derive must not do](#what-derive-must-not-do)
- [Sequencing](#sequencing)
- [Open questions](#open-questions)

## What is actually closed

Less than the audit's sentence suggests, and in a more interesting place.

**The tree is already open.** `collect()` walks the region's DOM and asks
a `WeakMap<Element, Provider>` for each marker it finds; a provider is
anything with `node(): TimelineNode`. Any component can put itself in that
map and contribute to the timeline. Nothing about the tree is a fixed list.

**The vocabulary is closed in three places, in descending order of how
much they matter:**

1. `Step` is a nine-member union in `types.ts`, and `Cue.kind` is
   `Step['kind']`.
2. `resolveStep` switches on `step.kind` to produce cues (`compile.ts`).
3. The run reads cue fields it knows by name — `cue.camera`, `cue.tether`,
   `cue.hold`, `cue.target` — in `evaluate()`.

And the thing that makes this feel closed to an author is none of those:
**`StepComponent` is `abstract class` without `export`, and `TimelineNode`
is not in the public index.** `Query`, `Sprite`, `Rect`, `Easing` and
`SpringSpec` already are. The door is unlocked and unmarked.

The proof is `c.Crossing`, which is already a composite step: its `node()`
returns a plain `Block` of four built-in steps with a private `generic`
flag on each. It uses no library privilege that an author could not have.
It is simply on the inside of a file boundary.

## Two asks wearing one name

Pull them apart, because they want different mechanisms and carry very
different risk.

**A composite step** is a macro: a new word that expands into the built-in
vocabulary. `c.Crossing` is one. So would be `c.Reveal`, `c.Emphasise`, a
house `c.Enter` that every card in an app agrees on. This needs no engine
change at all — it needs exposure, a contract, and one missing feature
(below).

**A derived cue** is a genuinely new engine capability: a value computed
per frame from something else in the scene, rather than interpolated
between two keyframes. `follow` is this. So is a connector endpoint, a
label that stays upright under a rotating parent, a shadow whose blur
tracks lift height. The precedent already exists — `c.Tether` computes an
SVG path every frame from two sprites' rects — but it is a one-off, and
what it computes can only be a path in a layer the run owns.

Conflating them is what makes the gap look bigger than it is. Most of the
value is in the macro layer, and almost all of the risk is in the other.

## Part 1 — a block can be named

> **Landed.** `Block` carries `name`, `at` and `delay`; `c.Sequence` and
> `c.Parallel` take them as args; `measure` splits into
> `extent` (a node's own length) and `measure` (what it contributes to its
> parent's flow), and `place` resolves a block's anchor with the same
> arithmetic a step uses. Two contract tests pin it. One correction the
> tests produced: an anchored block lifts out of the FLOW, not out of the
> score — it still lengthens the run if it is the longest thing in it,
> exactly as an anchored step does.

The smallest change, and the one that makes composites first-class.

`StepBase` carries `name`, `at` and `delay`. `Block` carries neither:

```ts
export interface Block {
  children: TimelineNode[];
  kind: 'parallel' | 'sequence';
}
```

So a composite step is invisible to the anchor system. `c.Crossing` works
around this by naming an inner child `'__crossing-flight'` and anchoring
its own arrivals against that — a private string, reachable by an author
only by accident. An author's `<MyReveal @name='reveal' />` cannot be
anchored at all, and `{{after 'reveal'}}` from a sibling step is a compile
error naming a step that does exist, in the shape the author wrote it.

Give `Block` the same three fields. `place()` already computes a block's
`total` via `measure()`; recording that span in `names` under the block's
name, and honouring `at` on a block the way it honours it on a step, is
the whole change. An anchored block lifts out of its parent's flow exactly
as an anchored step does — the §4.2 rule is already written for this and
would simply apply one level up.

This is independent of everything else here, small, and testable on its
own: a named parallel, anchored against, with a sibling starting at 60% of
its span.

## Part 2 — composite steps, in public

Export what `c.Crossing` uses, and write down what it means.

```ts
export { StepComponent } from './choreo/steps.gts';
export type { Block, GateNode, Step, TimelineNode } from './choreo/types.ts';
```

An author's step is then a component:

```gts
export class Reveal extends StepComponent<
  StepArgsBase & { rise?: number; stagger?: number }
> {
  node(): TimelineNode {
    const { rise = 12, stagger = 0.06 } = this.args;
    return {
      kind: 'parallel',
      name: this.args.name,
      children: [
        { kind: 'tween', of: this.args.of, props: { opacity: [0, 1] }, … },
        { kind: 'tween', of: this.args.of, props: { y: [rise, 0] }, … },
      ],
    };
  }
}
```

**The contract, which is the actual deliverable:**

- `node()` is called on **every pass**, and its result is fingerprinted
  (`treePrint`) to decide whether an edit replays the run. It must be
  **pure and cheap**: no measurement, no DOM writes, no tracked writes. A
  tracked write inside `node()` re-renders, which replays the pass, which
  calls `node()` — the build-order transport documents this loop from the
  other side.
- Functions in the tree print by WeakMap identity, so a `node()` that
  allocates a fresh closure per call declares an edit on every pass and
  defeats the fast keep. Hoist them.
- `generic: true` is the yield rule (§4.7): a canned child surrenders any
  sprite a specific sibling step also names. A composite that ships
  opinionated defaults should mark its children generic, so an author can
  override one role with a plain `<c.Tween>` beside it. This is the flag
  that makes a composite feel like a default rather than a cage — it
  should be public and documented, not spelled `__` and hidden.
- Names must be unique across the whole tree, so a composite that names an
  inner child must derive that name from its own `@name` rather than a
  fixed string, or two of them in one timeline collide.

**The acceptance test writes itself:** rewrite `c.Crossing` against the
public contract, with no library privileges, and delete the private
spelling. If it survives that, the contract is real. If it needs one
private escape hatch, that hatch is the actual design problem and this
part is not done.

## Part 3 — `c.Follow` and the derived cue

The engine change, and the one to build last.

```gts
{{! the badge rides the card, wherever the card's own flight takes it }}
<c.Follow @of={{c.id 'badge'}} @to={{c.id 'card'}} @read={{corner}} />
```

```ts
const corner = ({ self, sources: [card] }: DeriveContext) => ({
  x: card.x + card.width - self.width - 8,
  y: card.y - 8,
});
```

The cue grows one field, in the shape `tether` already has:

```ts
/** derive: compute this sprite's values from the scene, every frame */
derive?: {
  read: (ctx: DeriveContext) => Record<string, PropValue>;
  /** what each written property is at rest, so a measure pass can undo it */
  rest: Record<string, PropValue>;
  sources: Sprite[];
};
```

```ts
interface DeriveContext {
  camera: CameraState;
  /** 0..1 across the cue's own window */
  p: number;
  /** the driven sprite's rect, in the region's space */
  self: Rect;
  sources: Rect[];
  /** seconds on the run's clock */
  t: number;
}
```

`c.Tether` then becomes a special case of this — draw a path between two
rects — rather than a sibling of it, which is the sign the abstraction is
the right one rather than a second one.

## What derive must not do

These are not invented constraints. Each falls out of machinery that is
already load-bearing, and each is a way this feature can quietly break
things that work today.

**It must be pure.** The run supports `time = t` in both directions and
re-asserts a still on the two frames after entering one (`restill`). A
derived value that integrates — a spring, a smoothed follow, anything with
memory — makes a scrub irreversible: seeking back to 1.4s would not
reproduce the frame that was at 1.4s. `read` must be a function of its
context and nothing else. A `@debug` lint can check it cheaply: call it
twice at the same `t` and compare.

**It cannot be accelerated.** Every derived write is main-thread, per
frame, by construction — exactly like `tether`, and unlike everything else
the run hands to WAAPI. That is the price, and it belongs in the docs
beside the feature, not in a footnote. Thirty followers is a budget
decision; three is free.

**It must declare a rest.** `releaseForMeasure` jumps moved values to
`rest ?? 0` before a measure and `reassert()` puts them back. A derived
cue with no declared rest would either leave its last computed value
standing during the measurement — poisoning the very `final` boxes the
next run is built from — or be guessed at zero, which is wrong for
`scale`. Hence `rest` is required, not optional.

**It must evaluate after what it reads.** A follower reading a flying
card's live rect has to run after that card's own cue in the same frame,
or it is always one frame stale. `evaluate()` walks `tracks` in cue order,
so derived cues sort last — and a derived cue reading another derived
cue's sprite is a cycle to reject at compile time, not to resolve.

**It must not write layout.** As of the fast keep's layout fingerprint, a
pass is declined outright only when every participant stands in the same
`offsetLeft/Top/Width/Height` it compiled in. A derived cue writing real
width or height would change that print every frame, fail the fast keep
every frame, and put the region back into release-and-reassert per frame —
which is precisely the jitter that path exists to prevent. Derived writes
should be restricted to transform, opacity and filter-class properties; if
a layout-writing follower is ever wanted, it pays the slow path knowingly.

## Sequencing

Three landings, each shippable alone, in this order:

1. **Blocks get `name` / `at` / `delay`.** Self-contained, one test.
2. **The public contract**, with `c.Crossing` rewritten against it as the
   proof. No engine change; the risk is all in what the contract promises,
   so the promise is what gets reviewed.
3. **The derived cue**, behind its own tests: purity, scrub round-trip,
   release-and-reassert, ordering, and a fast-keep test that asserts a
   region with a follower aloft still declines a volatile pass.

`follow` is the reason the Boxel line wants this, but it is also the only
part that can hurt what already works. Landing 1 and 2 first means the
macro layer — most of the value — is available while 3 is still being
argued with.

## Open questions

**Should a custom step be able to emit cues directly?** This design says
no: `node()` returns nodes, and only the library turns nodes into cues.
That keeps every invariant — release, reassert, seek, gates, stills,
velocity inheritance — inside code that knows about them. The cost is that
a genuinely new _behaviour_ (not a new arrangement of existing ones) still
requires a library change. Part 3 exists because `follow` is exactly such
a behaviour, and the bet is that there are few of them. If that bet is
wrong, the answer is more derived-cue shapes, not an open cue interface.

**Is `follow` a step or a modifier?** `<c.Follow>` is a step, which means
it has a window, a place in the score, and can be anchored — a badge that
follows only during the flight, then stops. The alternative is `@follow=`
on an existing step, which composes with a tween's own values but has no
independent window. The step reads better against everything else in the
language, but the modifier is what an author reaches for when they want a
tween whose target is derived rather than fixed. They may both be wanted.

**Does a composite step get to see the changeset?** Today `node()` sees
only its own args. A composite that wanted to branch on "is anything
actually departing?" cannot. Handing it the changeset would make `node()`
depend on measurement, which the purity rule above forbids — so the honest
answer is probably no, and a composite that needs that branch belongs in
the app, gated by app state, the way `crossingActive()` gates the
crossing's own timeline today.
