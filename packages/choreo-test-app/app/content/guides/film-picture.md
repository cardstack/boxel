# Registering a Picture and Its Capabilities

A film owns the edit; a picture draws the scene. `IframePicture` registers the source, assets, initial state, and renderer-specific capabilities that the film needs. Keeping those settings with the picture prevents a general camera score from acquiring unrelated knowledge about one model's weather, construction clock, or lighting rig.

## Registering the Specification

Place IframePicture inside Film's picture block and pass the registrar yielded by that block. Its required information includes the source, asset root, accessible title, and standing time. A seat callback can establish the picture's initial state before playback.

```gts title="Component template excerpt"
<Film @name='study' @menuTitle='A motion study' @seek='exact'>
  <:picture as |register|>
    <IframePicture @register={{register}} @src={{this.sceneURL}}
      @assets={{this.assetRoot}} @title='Motion study'
      @standing={{0}} />
  </:picture>
  <:default as |f|>
    {{! The film graph belongs here. }}
  </:default>
</Film>
```

Import both components from `@cardstack/choreo/film`. The source must implement the picture contract expected by the film; an arbitrary webpage at that URL is not automatically a compatible renderer. The component registers a specification rather than directly drawing a second iframe of its own.

## Describing the Renderer

`PictureSpec` includes optional rig framing, named grades and looks, LUT amount, poster atmosphere, world typography, accents, and declared seams. A host that cannot navigate directly to a raw HTML page may supply srcdoc. Resolve subordinate models, textures, audio, and fonts against the intended asset root rather than an accidental development-server path.

The `Picture` interface describes the renderer operations the film consumes. It is broader than a generic camera setter because the reference pictures expose lighting, atmosphere, annotations, and capture behavior. Check the interface and actual adapter together before promising that a new renderer supports every adjustment.

## Respecting Readiness

Registration occurs after render to avoid tracked writes during the pass that reads the spec. It does not mean every asset is decoded. The renderer must report when it can show the requested state, and exact capture must wait for that stronger condition.

Test a direct cold load, a missing subordinate asset, a frame request before ordinary playback, and destruction followed by remount. The registration must clear on teardown so an old picture cannot keep receiving commands. Keep private deployment coordinates out of reusable specifications and documentation; use configurable URLs so the same composition can run locally or under a different host.

## API Coverage

**@cardstack/choreo/film**: `IframePicture`, `IframePictureSignature`, `PictureSpec`, `Picture`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`picture.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/picture.gts).
