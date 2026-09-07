# Entering and Leaving

A normal conditional removes an element as soon as its condition changes. An exit animation needs the element to stay in the document a little longer. `Presence` keeps a leaving item mounted until its animation finishes.

## Animating a List

Suppose a parent component passes a list of notifications as `@messages`. Each message has a stable `id` and a `text` value.

```gts title="app/components/message-list.gts"
import type { TOC } from '@ember/component/template-only';
import { motion, Presence, to } from 'glimmer-motion';

type Message = { id: string; text: string };
interface Signature {
  Args: { messages: Message[] };
}

const messageKey = (message: Message) => message.id;

<template>
  <ul>
    <Presence @items={{@messages}} @key={{messageKey}} as |message handle|>
      <li
        {{motion
          presence=handle
          initial=(to opacity=0 y=8)
          animate=(to opacity=1 y=0)
          exit=(to opacity=0 y=-8)
        }}
      >
        {{message.text}}
      </li>
    </Presence>
  </ul>
</template> satisfies TOC<Signature>;
```

The block yields both the message and a presence handle. Passing that handle to `presence` connects the element's exit animation to the item's lifetime. Removing a message from the array now fades it out before removing its element.

## Keeping Identity Stable

The key identifies the message across updates. Use a persistent ID rather than an array index. Otherwise, removing the first message can make every later message appear to have changed identity.

Read the label from the yielded `message`, as this example does. A leaving Glimmer block can render again while its exit is running. Reading its text from a selection that has already changed can replace the old label during the exit.

## Choosing an Order

The default `sync` mode lets arrivals and departures animate together. `wait` holds the arriving item until the departure finishes. `popLayout` removes the leaving item from layout immediately so its siblings can close the gap.

Compare these behaviors in the [presence modes demo](/presence). If you need to order exits, layout movement, and entrances across a whole region, use [a Choreo timeline](/docs/interactive-timelines).

## Testing Replacement and Teardown

Give each item a stable key so the presence model can distinguish a changed item from a new one. The block yields the retained item separately from its PresenceHandle, which exposes whether it is still present; render departure content from that retained item. Test replacing the selected item while the prior one is still leaving, not only removing the final item from an otherwise empty list. Confirm that the onExitComplete callback follows the intended exit lifecycle and that teardown releases the retained DOM. Nested presence and propagation should be chosen deliberately so a parent departure does not silently suppress an inner exit that the design depends on.

## API Coverage

**glimmer-motion**: `Presence`, `PresenceHandle`.

Read the implementation: [`presence.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/presence.gts), [`presence-types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/presence-types.ts).
