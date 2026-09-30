# Authoring a Film Graph

A film graph expresses an edit as nested components: a spine contains chapters and sequences, and those groups contain shots with their narration, framing, and adjustments. The structure is compiled into data before playback. This lets a person or agent edit the composition without scattering camera changes across event handlers.

## Starting With a Spine

`Film` yields the graph vocabulary in its default block. `FilmGraph` can also host that vocabulary independently and report the compiled result through `@onCompile`. A spine establishes the ordered shot structure and default join. Chapters add named navigation points; sequences group shots under shared defaults without necessarily creating a chapter.

```gts title="Component template excerpt"
<FilmGraph @onCompile={{this.inspectGraph}} as |f|>
  <f.Spine @join='dip'>
    <f.Chapter @n='01' @title='A living interface'>
      <f.Shot @name='opening' @ticks={{3}}
        @dolly={{1}} @yaw={{20}} @pitch={{12}} @lookY={{0}}>
        <f.Type @mode='title' @word='Choreo' />
      </f.Shot>
    </f.Chapter>
  </f.Spine>
</FilmGraph>
```

Import FilmGraph from `glimmer-motion/film`. This example compiles a graph; it does not mount a picture renderer. A complete film adds the picture block and the film's identity, as described in the picture guide.

## Understanding Defaults

Groups can establish defaults such as a join, hold behavior, or camera breath. A shot can override the values relevant to that shot. Adjustments placed beneath a group apply to its shots, while an adjustment beneath a shot is local to that shot. The nesting is therefore semantic, not just a way to organize long markup.

Use unique shot names because narration assets, inspection tools, and compiled rows use them as identity. Renaming a shot may require updating its associated audio file or duration metadata. Keep that relationship visible in review.

## Compilation and Rendering

Graph components register hidden markers. The host collects them after render and compiles the tree into a `CompiledGraph`. It avoids writing tracked state inside the render pass that produced the markers. This scheduling detail matters when a parameter editor changes a graph argument: the update should produce a new coherent graph, not a loop of partial compilations.

The `FilmVocabulary` and `VOCABULARY` exports expose the same typed component set used by Film. The compiled Beat and Chapter data remain useful for tests and tooling, but new film templates should use the graph authoring surface. Compare the compiled schedule before and after an edit to see whether it changed only presentation settings or also changed the film's timing.

## API Coverage

**glimmer-motion**: `FilmChapter`.

**glimmer-motion/film**: `FilmGraph`, `FilmGraphSignature`, `FilmVocabulary`, `VOCABULARY`, `GraphChapter`, `Sequence`, `Spine`, `Chapter`.

**FilmVocabulary**: `f.Chapter`, `f.Sequence`, `f.Spine`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts), [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts).
