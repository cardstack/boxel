# Graph Compilation and Custom Adjustments

The film graph is an authoring layer over a compiled edit. Its extension APIs let a component contribute structured data without taking over playback. This is useful for a house style, a renderer-specific adjustment, or a tool that needs to inspect the graph before a picture is mounted.

## Understanding the Data Tree

`GraphNode` is the union of supported graph data, including group, shot, tail, eye, join, voice, attachment, and patch nodes. Their exported types describe the exact shapes the compiler accepts. `compileGraph()` turns a spine group into `CompiledGraph`; it does not query the DOM or start media playback.

`collectGraph()` is the separate DOM collection operation used by the host. It walks registered marker components in document order and preserves semantic nesting. Keeping collection separate from compilation makes it possible to test the edit as plain data.

## Writing a Provider

`GraphProvider` exposes `node()`. `GraphNodeComponent` supplies the marker lifecycle for a component implementing that contract. A patch-oriented component can extend `PatchComponent` and return a `Patch`, while Adjustment and Filter express more specific authoring intent.

```ts title="Component logic excerpt"
import { Adjustment } from '@cardstack/choreo/film';
import type { Patch } from '@cardstack/choreo/film';

export class SoftRim extends Adjustment<{ amount?: number }> {
  patch(): Patch {
    return { rim: this.args.amount ?? 0.2 };
  }
}
```

This example uses an existing picture field. It does not add a new renderer capability by itself. A genuinely new adjustment needs a typed representation and a picture implementation that consumes it; otherwise the graph would accept a word that produces no visible effect.

## Keeping Compilation Stable

Node and patch methods should be pure, inexpensive calculations of their arguments. Do not mutate tracked state, fetch assets, or measure a live scene there. The graph host schedules collection after the markers settle so edited parameters produce a coherent compiled result without backtracking renders.

Use stable names and understand the scope of defaults. A patch under a group applies to its descendant shots, while a clip look belongs to the clip actor. Merging everything into one undifferentiated settings object loses that ownership and makes direct seeking difficult to reason about.

## Verifying an Extension

Test the compiled graph before testing the pixels. Assert which beats receive the patch and which retain their defaults. Then render a direct middle-frame request with a compatible picture and confirm the visible effect. A graph test proves authoring semantics; a renderer test proves that those semantics reach the intended actor. Both matter when a new control is exposed in a parameter panel.

## API Coverage

**@cardstack/choreo/film**: `Adjustment`, `Filter`, `AttachNode`, `CompiledGraph`, `compileGraph`, `EyeNode`, `GraphNode`, `GroupNode`, `JoinNode`, `Patch`, `PatchNode`, `ShotNode`, `ToNode`, `VoiceNode`, `collectGraph`, `GraphNodeComponent`, `GraphProvider`, `PatchComponent`.

Read the implementation: [`adjust.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts), [`compile.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts), [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts).
