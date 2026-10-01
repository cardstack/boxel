# Variants and Staggered Children

Variants let a component describe meaningful visual states instead of repeating target objects on every element. A menu can be open or closed; its children can inherit the selected label and define how they participate. This is useful when several elements respond to the same local state but do not require a changeset-based Choreo timeline.

## Naming States

A `variants` object maps labels to targets. The modifier's `initial` and `animate` arguments can select those labels. Descendants can define their own target for the same label, which means the parent chooses the state while each child owns its appearance. This preserves the component's layout and markup rather than turning an animation into an unrelated imperative routine.

```gts title="Component template excerpt"
import { motion, stagger } from 'glimmer-motion';

const group = {
  hidden: {},
  shown: { transition: { delayChildren: stagger(0.06) } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0 },
};

<template>
  <ul {{motion variants=group initial='hidden' animate='shown'}}>
    <li {{motion variants=item}}>First</li>
    <li {{motion variants=item}}>Second</li>
  </ul>
</template>
```

`stagger()` is Motion's function, re-exported by the binding. Here it provides a delay for each child's entrance. The ordering comes from the rendered motion tree, so a reordered DOM can change the visible delivery order. Do not assume an unrelated array index controls the engine's sibling ordering.

## Passing Context

Dynamic variants can use `custom` data to calculate a target. Keep that calculation about the intended visual state. Reading changing DOM geometry in a target calculation can introduce a dependency that belongs in layout measurement or Choreo's captured changeset instead. `inherit=false` gives a subtree an independent variant state when it should not respond to the ancestor's labels.

A parent with its own controlling labels establishes a new variant boundary. When a child does not animate, check whether it inherited the expected label and whether its variant object actually contains that label. This is usually more useful than adding another animation call after render.

## Knowing When to Use Choreo

Variants work well for local state propagation and ordered entrances. Use Choreo when the interaction depends on what was inserted, removed, or moved in a render pass, when one region sends an identity into another, or when a later step must address a measured destination. Those requirements describe a scene transition rather than a family of named element states.

Verify both initial mount and later state changes. Also verify that removing the subtree releases its animations. For a repeatable example, remounting the component is a clear replay boundary; repeatedly assigning the same state label may correctly leave the already-settled component unchanged.

## API Coverage

**glimmer-motion**: `stagger`.

Read the implementation: [`helpers.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts).
