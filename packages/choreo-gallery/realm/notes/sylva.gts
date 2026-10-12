import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Sylva demo.
 */
const SylvaNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>Live DOM, hole-punched into a shader world</h2>
      <p class='dive-lede'>
        The cards are not textures — they are real DOM under the canvas, each
        shown through a hole the scene cuts at its exact pose, so a branch
        nearer the camera hides a card the way it hides anything else. The field
        buttons are live: occluded by moss and still pressable, and pressing one
        reaches back into the world. Over it all runs a camera that never stops
        — one spline for the shape, a cascaded spring for the mass — which is
        most of what this page is really about.
      </p>
    </header>

    <section class='dd'>
      <h3>The world, briefly</h3>
      <div class='dd-col'>
        <p>
          The scene is "Living Green" by
          <a
            href='https://x.com/MengTo'
            target='_blank'
            rel='noopener noreferrer'
          >Meng To</a>, from
          <a
            href='https://threeui.com/browse'
            target='_blank'
            rel='noopener noreferrer'
          >threeui</a>, his library of three.js interface work — vendored whole
          on its own pinned three r149. Two moss roots swept along centrelines
          traced off the original artwork; ~45,000 instanced blades planted on
          whatever faces the light; all lighting written in the shaders — there
          is not a single
          <code>THREE.Light</code>, so you cannot brighten this world, only
          drive it. A pointer-fed sway field doubles as wind, a spore pool
          sprays along the cursor, and a butterfly runs a four-state flight loop
          with a spook radius around your hand.
        </p>
        <p>
          One lucky alignment carries everything below: the scene's camera is
          authored in pixels —
          <code>fov = 2·atan((H/2)/DIST)</code>
          — so one world unit is one CSS pixel. The DOM layer and the GL camera
          share matrices verbatim, with no unit conversion to drift. Even the
          page behind the canvas is the original's: the near-flat
          <code>#4a4d44</code>
          sky, its two soft radials, and the floor of light the root stands in,
          ported line for line so the tile, the theater and the inline frame
          read as one continuous world.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Three claims, one world</h3>
      <div class='dd-col'>
        <p>
          Every earlier stage put DOM behind a hole a model already owned — a
          phone's display, a laptop's screen — and got occlusion free, because
          the mesh hiding the DOM was already in the file and already in front.
          This world proves the free-floating cases. A card anchored to a bare
          point in a scene, with a hole-punch proxy we author: a rounded-rect
          <code>NoBlending</code>
          mesh, cut to the card's own silhouette, corners included — a square
          hole behind a 14px-radius card leaks a dark notch at each corner, the
          one hard right angle in a scene with none.
        </p>
        <p>
          Several at once, which needs the DOM's paint order re-sorted to match
          view depth every frame — the browser has no idea two
          absolutely-positioned cards sit at different depths, and without the
          sort a far card paints over a near one. And input, where a press on an
          occluded card is raycast against the wood first: if the root is nearer
          along that ray than the card, the press belongs to the moss.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>One writer per agreement</h3>
      <div class='dd-col'>
        <p>
          The ugliest bug here was not a tuning problem but a topology problem.
          The card's grow-out-of-the-dot entrance was Motion's — a spring on the
          shell's transform — while the hole was slaved to a
          <code>getComputedStyle</code>
          read of it from the host's loop. Two rAF callbacks, no ordering
          guarantee: whenever the host's frame ran first, the hole wore
          <em>last</em>
          frame's pose, and a dark notch chased the card's leading corner at
          spring speed.
        </p>
        <p>
          The fix generalises into the rule the whole world obeys: for every
          pair that must agree, appoint one writer and hand both consumers the
          same numbers in the same frame. The host integrates the entrance
          spring itself and writes the shell's style and the hole's pose from
          one
          <code>&#123;scale, dx, dy&#125;</code>. The pin and the card wear one
          anchor matrix. The leader line is drawn in the scene from the same
          anchor to the card's edge, growing with the same entrance scalar — and
          depth-tested, so a branch cuts the line exactly where it cuts the
          card. Smoothness is never asked of two systems at once; it is computed
          once and worn twice.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Why a chain of tweens cannot be smooth</h3>
      <div class='dd-col'>
        <p>
          The obvious tour is
          <code>fly to A, then to B</code>
          — each leg a from→to lerp under an ease. The problem is at the seams,
          and it is mathematics, not taste: any ease that "settles" has zero
          slope at its ends, so a tour assembled from settling eases halts at
          every boundary. Fly, park, fly, park — a slideshow wearing a camera
          move.
        </p>
        <p>
          The first fix — a curve with matched non-zero boundary slopes —
          removes the stop but not the kink. Matched slope in
          <em>normalised</em>
          time is not matched velocity in pose space: when one leg travels 152°
          of yaw and the next travels 20°, equal normalised slopes are a
          seven-to-one real-velocity step at the join. The camera no longer
          stops; it flinches. Continuity is a property of the whole path, so the
          whole path has to be one primitive.
        </p>
        <p>
          That primitive is
          <code>@through</code>: one
          <code>c.Camera3D</code>
          step over N waypoints, sampled along a cardinal spline in pose space,
          so the camera
          <em>crosses</em>
          every waypoint with continuous velocity — it never arrives at one.
          <code>@tension</code>
          is the operator's grip: 0 is classic Catmull-Rom, lively and loose
          enough to sway; 1 collapses to piecewise-linear; the default 0.5 is a
          steady hand that still curves. The ease over the path is linear on
          purpose — the spline is the shape, and an ease on top of it is a
          second opinion. One catch worth naming: a spline knows nothing about
          circles, so yaw is unwrapped by the author — fern at 172° to wren at
          −168° is a 340° swing back around the front of the scene unless the
          score says 192°.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The cascade: derivatives the score cannot see</h3>
      <div class='dd-col'>
        <p>
          Even a velocity-continuous spline leaves discontinuities the eye reads
          — a lap's restart, an interruption, an aim cue that jumps to a new
          target. And velocity is not the bar: cinematic motion needs the second
          and third derivatives bounded too. A real rig gets this from physics —
          a dolly has mass, a fluid head has damping; you cannot jerk iron.
        </p>
        <p>
          The digital equivalent is the Drift demo's doctrine —
          <em>a score for the scene change, a loop for the simulation</em>
          — the lens chases the score instead of obeying it. One
          critically-damped spring is not enough: velocity crosses every seam,
          but the acceleration term reads the goal directly, so a goal that
          jumps lands straight in the second derivative and the frame flinches.
          Two stages in series bound the jerk — the second spring only ever sees
          a target that is already curving. The pose runs at
          ω&nbsp;=&nbsp;20&nbsp;→&nbsp;13 (framing must never be late for a
          card); the aim at 7&nbsp;→&nbsp;4.5, because its goal is a step
          function and needs the most rounding. A hand on the camera snaps both
          stages to zero lag — a chaser between a finger and its camera reads as
          broken. The price, accepted knowingly, is random access: an
          integrator's pose depends on history, so a scrub only agrees with
          playback walked in order.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The aim is part of the pose</h3>
      <div class='dd-col'>
        <p>
          A five-number orbit pose has an implied centre, and an implied centre
          is a one-subject assumption. The moment a scene has several subjects
          the centre must move on the same clock as everything else — which is
          <code>@look</code>: the orbit centre carried in the tweened pose,
          splined through the waypoints with yaw and dolly, carried in force
          like any unnamed component, reconstructible by a scrub. Its first
          draft was a
          <code>c.Perform</code>
          side-channel with an easing of its own, and the timeline could not see
          it — the difference is the difference between choreography and
          puppetry.
        </p>
        <p>
          Two geometric corollaries surfaced the moment the camera was free:
          orbit the
          <em>target</em>, not the scene origin — no origin-orbit can frame a
          card at the far end of the root from behind — and truck in the view's
          own right/up basis, because a world-X truck pushes the frame the wrong
          way once the camera stands behind the scene.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Presented mid-flight, swapped never cut</h3>
      <div class='dd-col'>
        <p>
          The cards are 2D springs; the camera is 3D. They read as one gesture
          because of
          <em>when</em>
          things fire. Opens are cues clipped into the flight —
          <code>@at</code>
          a named step plus
          <code>@delay</code>
          — so each card grows out of its dot while the frame still carries real
          speed, instead of blooming at the camera's slowest instant. There is
          no per-card close: the next open
          <em>swaps</em>, the leaver's exit and the arrival's entrance running
          simultaneously mid-flight — a cross-fade, and incidentally the
          "several cards at once" claim exercised at every seam. One targetless
          close, clipped into the going-home leg, puts away the lap's last card.
        </p>
        <p>
          The narration is a 2D layer on the same beats — and its type is
          DELIVERED, not faded: the wordmark's characters pop centre-out on an
          overshoot (<code>@by='character'</code>
          <code>@order='center'</code>), the lines land word by word, the small
          print follows as staggered blocks, and a chapter swap drops the old
          type in one quick fall. Every entrance is score vocabulary; nothing is
          hand-keyed.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Input closes the loop</h3>
      <div class='dd-col'>
        <p>
          Occlusion that only affects pixels is a picture; occlusion that
          affects clicks is a world. The DOM knows nothing about what the canvas
          drew over it, so
          <code>swallow</code>
          raycasts every card press against the wood first and gives the moss
          the clicks that belong to it. In the other direction, the cards'
          triggers drive systems the scene already owns — the shaders cannot be
          lit, so a cue must speak their language. "Run a hand through" is the
          scene's own fingertip uniform, radius flared, swept the length of the
          flank. "Loose the spores" seeds the spray pool in a disc. "Flush the
          moth" tips the butterfly's state machine into takeoff. The wren's song
          is the one thing a shader cannot draw, so the stage synthesises it —
          four falling chirps and a dry trill, oscillators and envelopes, no
          asset.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Three faces, one world</h3>
      <div class='dd-col'>
        <p>
          Forty-five thousand blades do not belong in a gallery grid, so the
          tile is a photograph — the original's own frame — with a play control
          over it that opens this page straight into theater. On the page the
          world runs in a frame of its own: its own document, its own compositor
          budget, no main thread shared with a Magic Move, torn down whole when
          the page goes.
        </p>
        <p>
          Theater is the same frame brought to the front of the page and given
          the window's height. The frame never moves in the DOM — re-parenting
          an iframe reloads it — so the page re-orders around it, the site's bar
          steps out, and one door,
          <em>How This Is Built</em>, leads back down to these notes.
        </p>
      </div>
    </section>
  </section>
</template>;

export default SylvaNotes;
export { SylvaNotes };
