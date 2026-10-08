# @cardstack/choreo

**Motion, choreographed.** `<Choreo>` watches a region's render passes, hands each one's changeset
(inserted, removed and kept participants, with their bounds before and after) to a timeline declared
inside it, and plays that timeline on the [Motion](https://motion.dev) engine. It is built on
[`glimmer-motion`](../glimmer-motion), whose `{{motion}}` elements are the participants.

```gts
import { Choreo } from '@cardstack/choreo';
import { motion } from 'glimmer-motion';

<template>
  <Choreo as |c|>
    {{#each @messages key='id' as |message|}}
      <article {{motion id=message.id role='message'}}>
        {{message.subject}}
      </article>
    {{/each}}
    <c.Sequence>
      <c.Tween @of={{c.removed 'message'}} @opacity={{0}} @duration={{0.2}} />
      <c.Move @of={{c.kept 'message'}} />
    </c.Sequence>
  </Choreo>
</template>
```

## Install

```
pnpm add @cardstack/choreo glimmer-motion
```

Peers: `glimmer-motion` at exactly the same version (the two packages release together), `motion-dom` /
`motion-utils` in the same ranges glimmer-motion declares, so both packages share one engine,
`ember-modifier`, `@glimmer/component`, `ember-source >= 5.4`. A v2 addon with
TypeScript types and Glint signatures.

## Entry points

| import                           | what                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cardstack/choreo`              | `Choreo` and its yielded vocabulary, `beacon`, anchors (`at`, `after`), `createArming`, easings, the region registry, plane-space helpers, `StepComponent` and the timeline types |
| `@cardstack/choreo/film`         | the film construct: `Film`, its clips, joins, overlays, player and graph                                                                                                          |
| `@cardstack/choreo/test-support` | `setupChoreo(hooks)`, `advanceGate()`, `seekTo()`, `live()`, `orphanCount()`, `strandedTransforms()`                                                                              |

Deep imports (`@cardstack/choreo/compile`, `@cardstack/choreo/film/math`, …) are the same modules.

## How it plugs into glimmer-motion

A region is a glimmer-motion participant host: `{{motion}}` elements with an `id` or `role` join the
nearest region when they mount, and a region can claim a leaving element to keep it on screen for as long
as the timeline names it. The region's in-flight runs count toward glimmer-motion's settle checks through a
busy probe, and `setupChoreo(hooks)` is glimmer-motion's `setupMotion(hooks)` with Choreo's document-wide
state (beacons, the far-match barrier, gesture samples) added to the resets it runs.

## License

MIT.
