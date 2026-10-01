import type { TOC } from '@ember/component/template-only';

/**
 * The deep dive for the Mockup demo: how a 3D camera becomes a Choreo
 * step, and why the screen is DOM rather than a texture.
 */
export const MockupNotes: TOC<object> = <template>
  <section class="note">
    <h3>A screen that is still a screen</h3>
    <p>
      Every 3D mockup tool renders the phone's display as a
      <em>texture</em>: the UI is painted into an offscreen canvas and uploaded
      to the GPU. That is why you can never click anything in one. Here the
      display is real DOM — six apps, each with its own
      <code>&lt;Choreo&gt;</code>
      region — standing exactly where the 3D camera says the glass is. Tap
      Unread inside Mail while the shot is moving and the rows really filter.
    </p>
    <p>
      The mapping is three pure functions over a 4x4 matrix, lifted from
      three.js's
      <code>CSS3DRenderer</code>
      and stripped of everything else it does:
      <code>perspective()</code>,
      <code>cameraCss()</code>,
      <code>objectCss()</code>. Thirty-two lines, no imports. Choreo already has
      a subtree and a clock; the only thing it lacked was the transform that
      puts them where the camera looks.
    </p>
    <p class="note-rule">
      One world unit is one CSS pixel.
      <code>perspective</code>
      and the camera's
      <code>translateZ</code>
      are written in px, so a scene authored at "2.6 units for a whole phone"
      projects nothing like the WebGL one. It looks nearly right at small
      angles, which is the trap; the giveaway is the DOM's projected rect
      running to five figures and hit-testing quietly failing.
    </p>

    <h3>c.Camera3D: the pose, not the picture</h3>
    <p>
      <code>c.Camera</code>
      moves a region's own frame, which is a 2D transform on real DOM. A 3D
      scene has no such frame — its camera belongs to whatever renders it. So
      <code>c.Camera3D</code>
      carries only the pose: yaw and pitch in degrees, dolly as a multiple of
      the host's framing. The region hands it to
      <code>@onCamera3D</code>
      and the host applies it to three.js, to a CSS 3D stage, to anything that
      takes three numbers.
    </p>
    <p>
      What Choreo keeps is the part it is good at. The pose is a pure function
      of the clock, so a scrub lands the shot exactly where playing there would,
      and
      <code>@by</code>
      resolves against the pose in force the way
      <code>Pan</code>
      and
      <code>SlowZoom</code>
      do.
    </p>
    <p class="note-rule">
      The shot is FOLDED, not remembered — and that distinction was a real bug.
      Every other cue owns an element and can be rewound in place; a camera cue
      owns one shared triple. Seeking back from cue two into cue one ran cue
      one's lerp correctly, then cue two's rewind restored the pose cue two had
      inherited, and the later write won. Every backwards seek landed on the
      boundary value. It is recomputed from the score on every evaluate now:
      start where the run began, walk the cues in order, let each pass through,
      lerp or land. A relative cue resolves against what the walk accumulated,
      which IS "the pose at cue start" — so a seek equals a play by construction
      rather than by bookkeeping.
    </p>

    <h3>One score, two lenses</h3>
    <p>
      The film's beats are identical in both modes: the same
      <code>c.Perform</code>
      cues open and close the same apps on the same counts. Only the camera
      differs —
      <code>c.Camera3D</code>
      flies the orbit in 3D,
      <code>c.Camera</code>
      zooms the platter in 2D. That symmetry is the argument for making the 3D
      camera a step rather than a callback: the direction reads the same either
      way, and both are seekable because both are sampled from the clock.
    </p>
    <p>
      Two tracks, two switches, because they answer to different intents. A drag
      means "let me look" and stops the camera. A tap on the screen means "let
      me use it" and stops the app cues. Either can be handed back without
      disturbing the other.
    </p>

    <h3>What a projection still costs</h3>
    <p>
      A flight inside the tilted plane is measured through the projection. The
      engine divides out the total scale between page and region, which is exact
      for a uniform scale — a region inside a
      <code>scale(1.5)</code>
      card used to start its flights 1100px from where they belonged, and now
      lands within half a pixel. But a perspective is not a scale, and no single
      number inverts one: at a 54° tilt a measured flight still starts about
      40px out.
    </p>
    <p>
      Which is why the icon-to-app flight here names both poses instead of
      measuring them. Open is the screen, closed is the tile, both arithmetic on
      the authored grid — no measurement, and therefore nothing a camera can
      make wrong. The repair for the general case is to measure in plane-local
      space; layout metrics are invariant under every tilt, which is also why
      the focus spotlight lands on the right icon at any angle.
    </p>
  </section>
</template>;

export default MockupNotes;
