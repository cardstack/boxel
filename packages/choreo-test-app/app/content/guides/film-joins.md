# Joins and Transition Presentations

A join explains the change between shots. It may be a direct cut, a dissolve, a wipe, or a custom presentation. The important contract is that the incoming shot is correctly prepared while the outgoing representation is held and revealed according to the transition's progress.

## Naming the Join

Put `f.Join` before the shot it enters, or establish a default on the surrounding group. `JoinInto` is the exported graph component behind that vocabulary. Its presentation can be a built-in name or a component supplied by the application, with an explicit duration for a custom presentation.

```gts title="Component template excerpt"
<f.Join @presentation='wipe' @secs={{0.7}} @over='everything' />
<f.Shot @name='next' @ticks={{3}}
  @dolly={{1}} @yaw={{40}} @pitch={{12}} @lookY={{0}}>
  <f.Type @mode='lower' @word='A new perspective' />
</f.Shot>
```

Built-in names include cut, blend, blur, defocus, dip, flash, iris, luma, melt, sweep, whip, and wipe. Not every name uses the same rendering mechanism: some belong to the camera or light, some can run inside the picture's own glass, and others composite a still in the DOM.

## Choosing the Coverage

`Over` distinguishes picture-only transitions from transitions over everything. A picture-only join leaves typography and other foreground layers outside its coverage, so their timing must avoid describing the incoming scene over an outgoing still. An everything join can cover those layers together and reveal an incoming composition already underway.

`PRESENTATIONS`, `JOIN_SECS`, and `STILL_JOINS` describe the registered behavior. `Joins` renders the chosen presentation. The exported presentation components include Blend, Blur, Dip, Flash, Iris, Luma, Melt, and Wipe; helpers such as seamShape, inGlass, and retire support their integration.

## Extending the Vocabulary

A custom presentation implements `PresentationSignature`, receiving the still and timing information it needs. It should not independently move the main camera or decide when a different shot begins. A shader-based transition instead belongs to a seam declared by the picture and driven through `SeamSpec` progress.

## Inspecting the Boundary

Review several frames before, during, and after the join. Confirm the outgoing still is decoded before the incoming camera snaps, and verify that titles do not show over the wrong subject. Test interruption by another cut while a still is preparing. A smooth-looking transition on a warm browser cache can hide a decode race that appears on a phone or a cold load. The seam readiness guide explains that failure and the dedicated gate that prevents it.

## API Coverage

**glimmer-motion**: `FilmJoin`.

**glimmer-motion/film**: `JoinInto`, `Blend`, `Blur`, `Dip`, `Flash`, `inGlass`, `Iris`, `JOIN_SECS`, `Joins`, `Luma`, `Melt`, `Presentation`, `PresentationComponent`, `PRESENTATIONS`, `PresentationSignature`, `retire`, `seamShape`, `STILL_JOINS`, `Wipe`, `Join`, `JoinName`, `Over`, `SeamSpec`.

**FilmVocabulary**: `f.Join`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts), [`joins.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
