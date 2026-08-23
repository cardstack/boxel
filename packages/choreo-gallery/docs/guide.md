# glimmer-motion, from a Glimmer card

The [README](../README.md) is a fidelity document: it says what Motion does and where each piece
went. This is the other thing — how you actually write motion in a `.gts` file, in the order you
meet the problems.

You do not need to know React. Where a React name survives it is because it is the right name
(`animate`, `exit`, `layoutId`), not because this is a translation.

1. [One element](#1-one-element)
2. [Things arriving and leaving](#2-things-arriving-and-leaving)
3. [One thing in two places](#3-one-thing-in-two-places)
4. [A whole scene](#4-a-whole-scene)
5. [A point on the page](#5-a-point-on-the-page)
6. [Three rules Glimmer adds](#6-three-rules-glimmer-adds)
7. [Testing it](#7-testing-it)
8. [Reduced motion](#8-reduced-motion)

---

## 1. One element

Animation is a modifier. It goes on whatever element you already have — a `div`, an `li`, an SVG
`circle` — and it does not ask you to wrap anything.

```gts
import { motion, to, spring } from 'glimmer-motion';

<template>
  <article
    class='card'
    {{motion
      initial=(to opacity=0 y=12)
      animate=(to opacity=1 y=0)
      transition=(spring visualDuration=0.4 bounce=0.2)
    }}
  >
    {{yield}}
  </article>
</template>
```

`initial` is where it starts, `animate` is where it goes, `transition` is how. `to`, `spring` and
`tween` are plain functions used as helpers — no registration, no `helper()` wrapper. `(hash …)`
works too and always will; the helpers exist so Glint knows what a transition is and can tell you
that `stifness` is not a thing.

A target you use more than once is better as a module constant than as a helper call in the
template, and the gallery is written that way throughout:

```gts
const soft = spring({ bounce: 0.14, visualDuration: 0.48 });
const rise = to({ opacity: 1, y: 0 });
```

Three things are worth knowing on day one.

**`animate` re-runs when its value changes.** It is a target, not an event. Give it a getter and the
element animates whenever the getter's answer changes.

```gts
{{motion animate=(to x=this.offset)}}
```

**Transforms are first-class values.** `x`, `y`, `scale`, `rotate`, `skewX` are properties you
animate, not strings you compose. The engine writes one `transform` and owns it.

**CSS goes through the modifier, not a `style` attribute.** This is rule 1 below, and it is the one
that costs people an afternoon.

---

## 2. Things arriving and leaving

An element that Glimmer has removed is gone — there is no frame left in which to animate it. So
leaving is a component's job: `<Presence>` keeps a removed item rendered until its `exit` has
finished, then lets it go.

```gts
import { motion, Presence, to } from 'glimmer-motion';

const keyOf = (todo) => todo.id;

<template>
  <ul>
    <Presence @items={{@todos}} @key={{keyOf}} as |todo handle|>
      <li
        {{motion
          presence=handle
          initial=(to opacity=0 x=-20)
          animate=(to opacity=1 x=0)
          exit=(to opacity=0 x=20)
        }}
      >{{todo.title}}</li>
    </Presence>
  </ul>
</template>
```

`@key` is how identity is decided — the same job `key` does in an `{{#each}}`. The block yields the
item and a **handle**; the handle goes into `presence=` on the element that owns the exit, and
`handle.isPresent` tells you whether this copy is on its way out.

`@mode` decides what happens while something leaves:

| mode               | what it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `"sync"` (default) | leavers and newcomers animate at the same time                          |
| `"wait"`           | the newcomer does not start until the leaver has finished               |
| `"popLayout"`      | the leaver is taken out of flow at once, so the rest close up around it |

---

## 3. One thing in two places

Give two elements the same `layoutId` and the engine treats them as one thing that moved. It
measures where the old one was, puts the new one there, and animates it to where it now is.

```gts
{{! the thumbnail }}
<button {{motion layoutId='shot-4'}}>…</button>

{{! and, when it is open, the big one }}
<figure {{motion layoutId='shot-4'}}>…</figure>
```

Only one of the two is ever on screen. This is the tabs indicator, the thumbnail-to-lightbox, the
list-row-to-detail-page.

`layout=true` is the same machinery for one element that stays put in the tree but changes size or
position — a grid item whose column changed, a panel that grew.

> **`layoutId` pairs two real elements and morphs one into the other.** That is why it is the wrong
> tool for "fly this row into the bin": the bin would stretch into a row shape on the way. See §5.

---

## 4. A whole scene

`{{motion}}` and `layoutId` animate elements one at a time, each deciding for itself. Some
transitions are not like that. "The rows close up **after** the deleted one has faded, and the
header slides **while** they do" is a statement about a render pass, not about an element.

`<Choreo>` is a region that watches its own render passes. Each pass it works out what was
**inserted**, **removed** and **kept** — with everyone's bounds before and after — and plays the
timeline you declared inside it against that.

```gts
import { Choreo, motion, spring } from 'glimmer-motion';

<template>
  <Choreo as |c|>
    {{#each @rows key='id' as |row|}}
      <article {{motion id=row.id role='row'}}>{{row.subject}}</article>
    {{/each}}

    <c.Sequence>
      <c.Tween @of={{c.removed 'row'}} @opacity={{0}} @ms={{160}} />
      <c.Move
        @of={{c.moved 'row'}}
        @spring={{spring stiffness=300 damping=24}}
      />
    </c.Sequence>
  </Choreo>
</template>
```

Read it as a script. `id` is identity, `role` is the group a step selects. `c.removed 'row'` is
every row that left this pass; `c.moved 'row'` is every row that is still here and whose box
changed. `<c.Sequence>` runs its children one after another, `<c.Parallel>` at once.

A removed element is kept alive, locked where it stood, for exactly as long as its part of the
timeline lasts — then dropped. You do not manage that.

A `<Choreo>` inside another `<Choreo>` is a separate scene: the outer one does not see the inner
one's participants, and does not collect its steps. [docs/choreography.md](choreography.md) is the
full design; [docs/nested-choreo.md](nested-choreo.md) is the nesting model.

---

## 5. A point on the page

Sometimes the destination is not an element that animates — it is a place. A row flies to the trash;
the trash must not move, stretch or take part.

```gts
<span class='trash' {{beacon 'trash'}}>🗑 {{this.binned}}</span>

<Choreo as |c|>
  …
  <c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} @spring={{toss}} />
</Choreo>
```

A beacon claims a name for its element's box. It is never inserted, kept or removed; it takes no
part in any changeset; moving it starts nothing. Other sprites borrow it as a start they never had
or an end they never reach.

The registry is document-global on purpose: in a real app the trash is in a toolbar and the list is
in an outlet, and they are separate regions precisely so their changesets stay apart.

---

## 6. Three rules Glimmer adds

**Motion owns a motion element's inline style.** In React the `style` prop belongs to Motion, which
merges your CSS with the transforms it writes. In Glimmer a bound `style="…"` attribute is yours,
and Glimmer rewrites the whole declaration whenever the bound value changes — wiping out the
transform Motion wrote a millisecond ago. The symptom is quiet and awful: a card that will not drag
while the drag code runs perfectly around it.

```gts
{{! ✗ the next re-render erases the transform }}
<div class='card' style={{this.accent}} {{motion drag=true}}></div>

{{! ✓ Motion applies these itself, custom properties included }}
<div class='card' {{motion style=this.accent drag=true}}></div>
```

**A leaving child stays live.** React keeps the element tree it captured before the diff, so a
leaving child cannot re-render. A Glimmer block re-runs from live tracked state for as long as the
leaver is on screen. So anything the exit needs — the label the panel was showing, the row the modal
flew from — has to ride on the item `<Presence>` yields, not be read back out of state that has
already moved on.

```gts
<Presence @items={{this.open}} @key={{keyOf}} as |panel h|>
  {{! ✓ panel.title is the value this copy was created with }}
  <section {{motion presence=h exit=(to opacity=0)}}>{{panel.title}}</section>
</Presence>
```

**Declare what you want tweened.** A layout animation moves and resizes by transform, so a growing
element scales everything inside it — including its corners. The engine corrects for that on
`borderRadius` and `boxShadow`, but it can only correct a value it holds, and a radius that lives in your
stylesheet is not one. A square tile growing into a wide hero comes out with oval corners, worst exactly
where it is most visible: a narrow viewport and a heavily rounded tile.

```gts
{{! ✗ .card { border-radius: 14px } — the engine never sees it }}
<article class='card' {{motion layout=true}}></article>

{{! ✓ corrected per frame, against whatever scale is in force }}
<article class='card' {{motion layout=true style=(styles borderRadius='14px')}}></article>
```

The same applies to anything you want animated, corrected or measured: it goes through the modifier.
This is rule 1 from the other side — Motion owns the inline style, so use that ownership.

There is a matching move for text. A parent scaling non-uniformly smears whatever it contains, and the
fix is to give the child its own `layout`: it is then measured in its own right and projection undoes the
parent's scale.

```gts
<article {{motion layout=true}}>
  {{! measured in its own right, so it animates between two real font sizes
      instead of being rubber-sheeted by the box around it }}
  <span {{motion layout=true}}>{{@title}}</span>
</article>
```

---

## 7. Testing it

Never `sleep(200)`. A sleep encodes a duration your test does not own: change a spring and every
sleep in the suite becomes either flaky or slow, and you find out on someone else's machine.

```ts
import {
  setupMotion,
  animationsSettled,
  bounds,
} from 'glimmer-motion/test-support';
```

```gts
module('the inbox', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a deleted row flies to the bin', async function (assert) {
    await render(<template><Inbox /></template>);
    await animationsSettled();

    await click('[data-test-delete="row-2"]');
    await animationsSettled();

    assert.dom('[data-test-row="row-2"]').doesNotExist();
    assert.deepEqual(bounds(find('[data-test-row="row-3"]')).top, 0);
  });
});
```

- **`setupMotion(hooks)`** resets what outlives an owner: the beacon registry, the far-match
  barrier, the motion speed.
- **`animationsSettled()`** resolves when every motion element, layout animation and `<Choreo>`
  timeline in the document has stopped. When it times out it names what was still moving.
- **`bounds(el)`** measures relative to `#ember-testing`, not the viewport — QUnit moves and scales
  its container, so a raw `getBoundingClientRect()` answers a different question depending on how
  many tests have run.
- **`shape(el)`** is the cumulative 2×2 transform. It is how you assert that a label did not get
  stretched by its parent's scale, which reading `x` will never tell you.
- **`orphanCount()`** and **`strandedTransforms()`** are the two invariants worth asserting after
  any interruption: nothing parked in a `<Choreo>` orphan layer, nothing wearing a transform that
  nobody is animating.

`animationsSettled()` is something a test asks for, not something `settled()` does on its own. That
is deliberate: a blocking test waiter would silently turn "click again while it is still moving"
into "wait for it to finish", and every interruption test in a suite would go green by no longer
testing anything.

Use `data-test-*` attributes as your hooks, not class names. Class names are the designer's; a
rename should not break a test, and a test should not stop a rename.

---

## 8. Reduced motion

`prefers-reduced-motion: reduce` is honoured by default. Someone who has asked their operating
system for less movement gets transform and layout animation switched off; opacity and colour still
animate, because those were never the problem.

That is the platform default, not a feature to opt into. If you are porting a React app that relied
on Motion's own default of ignoring the setting, it is one attribute:

```gts
<MotionConfig @reducedMotion='never'>…</MotionConfig>
```

`"always"` forces reduced motion on — useful for a visual-regression run, or for a switch in your
own settings UI.

---

## Where to go next

- [README](../README.md) — the whole API surface, and the React translation table
- [docs/choreography.md](choreography.md) — `<Choreo>`'s design, and the boxel-motion lineage
- [docs/nested-choreo.md](nested-choreo.md) — regions, nesting, and far matching
- `test-app` — every example in the gallery is a real component you can read
