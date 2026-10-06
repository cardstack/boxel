# Shots, Tail Poses, and Eye-Level Views

A shot should establish a subject and a useful way of seeing it. The film graph's `Shot`, `To`, and `Eye` components describe the camera's editorial intent without requiring the author to write a renderer loop. The film converts those facts into the camera path used by its score.

## Describing the Head

A Shot requires a name, ticks, and an orbit pose: dolly, yaw, pitch, and lookY. The `Cam` type also supports ground focus coordinates and an off-center frame. These terms belong to the film's renderer convention, so a new picture adapter should document how its subject is framed at dolly one.

```gts title="Component template excerpt"
<f.Shot @name='detail' @ticks={{4}}
  @dolly={{1.2}} @yaw={{25}} @pitch={{10}} @lookY={{1}}>
  <f.To @dolly={{1.35}} @yaw={{32}} @pitch={{12}} @lookY={{1.2}} />
</f.Shot>
```

The tail pose adds a deliberate movement during the shot. Without a tail, the shot can hold its framing. A hold is still a useful authored choice: narration or an interaction may deserve the viewer's attention more than a continuously changing angle.

## Changing the Viewpoint

`Eye` supplies an eye-level camera position, field of view, and optional destination using `Pt3` coordinates. This is useful for a ground-level walk or a view whose meaning depends on standing within the scene rather than orbiting its center. The host must implement the corresponding picture behavior; merely compiling an Eye node does not give an arbitrary renderer a walking camera.

Additional shot facts such as hold, follow, lift, bob, and a callout target affect the reference picture's direction. Apply them when they explain the subject, and verify the exact renderer supports the requested behavior. They are not all interchangeable with Camera3D's simpler pose fields.

## Allocating Screen Time

Ticks determine how much of the path the shot occupies. One film tick is two seconds in the current schedule. Changing ticks can retime the narration window, overlays, and camera relationship together. Use the schedule helpers to inspect the actual beat start rather than assuming every cue starts at a raw cumulative duration.

Review a shot in context with its predecessor and successor. A close-up can look excellent in isolation but cause a violent change of direction when inserted between two wider views. Check the head, tail, and transition boundary at the target frame rate, then confirm that the subject remains readable while any demo action is taking place.

## API Coverage

**@cardstack/choreo/film**: `Eye`, `Shot`, `To`, `Beat`, `Cam`, `Pt3`, `ShotState`.

**FilmVocabulary**: `f.Eye`, `f.Shot`, `f.To`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
