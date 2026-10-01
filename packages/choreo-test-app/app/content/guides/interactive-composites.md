# Creating Composite Steps

A reusable animation pattern can become a component without becoming a new runtime primitive. `StepComponent` lets an author return a tree of built-in timeline nodes. The resulting composite still participates in names, anchors, interruption, and the run's clock because the compiler sees the same vocabulary it already understands.

## Returning a Node

Extend `StepComponent` with typed arguments and implement `node()`. Use `StepArgs` when the component requires a subject query, or `StepArgsBase` for common timing arguments. The method returns a `TimelineNode`: a step, block, or supported gate node.

```ts title="Component logic excerpt"
import { StepComponent, toMs } from 'glimmer-motion';
import type { StepArgs, TimelineNode } from 'glimmer-motion';

export class Reveal extends StepComponent<StepArgs & { duration?: number }> {
  node(): TimelineNode {
    return {
      kind: 'tween',
      of: this.args.of,
      name: this.args.name,
      at: this.args.at,
      delay: toMs(this.args.delay),
      ms: toMs(this.args.duration ?? 0.3),
      props: { opacity: [0, 1] },
    };
  }
}
```

The template boundary uses seconds, while node durations use milliseconds. `toMs()` performs that explicit conversion, including optional values. A composite that forgets the conversion can look instant or appear to hang even though its block structure is otherwise correct.

## Keeping Collection Stable

`node()` is called during score collection and must be pure and cheap. Do not measure DOM, mutate tracked state, or start an animation there. Keep callback identities stable too: allocating a fresh function during every collection can look like a score edit and defeat the runtime's unchanged-pass optimization.

A composite may return a named sequence or parallel block. Derive inner names from the component's public name so two instances can coexist. Preserve the caller's anchor and delay on the returned root rather than losing them inside an implementation detail.

## Providing Defaults That Can Be Overridden

Built-in composites such as Crossing use generic child steps so a specific sibling can take responsibility for a selected participant. That yield behavior lets a reusable pattern supply sensible defaults without trapping the application in an all-or-nothing animation. Study Crossing's implementation as the reference consumer of this public extension boundary.

Test the composite from outside the library: render two instances, anchor a later step against one, and override a role with a specific sibling. A custom node kind is not supported merely because a TypeScript object can be constructed; genuinely new runtime behavior needs compiler and run support. Prefer composing the established vocabulary until a real application requirement proves that boundary insufficient.

## API Coverage

**glimmer-motion**: `StepArgs`, `StepArgsBase`, `StepComponent`, `toMs`, `Step`, `TimelineNode`.

Read the implementation: [`steps.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/steps.gts), [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts).
