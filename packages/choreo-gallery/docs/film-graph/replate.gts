/**
 * REPLATE, AS A FILM — a sketch, not a build.
 *
 * The Cursor agent's `examples/replate.gts` (in the uncommitted
 * choreo-gallery checkout, cut-2 "on the glass"): a stock over-the-shoulder
 * plate of Premiere; our own clips (Venice, Chicago, A B A B) warped onto
 * the program-monitor picture through a keyframed keystone; his scrub
 * read off the cyan timecode every fifth of a second and stretched onto
 * our composite, so a scrub back is a scrub back; Film grades landing on
 * the overlay only. Today it is an `exact` <Film> whose seven beats hold
 * a still camera and carry nothing but `grade` — the beat table used as a
 * grade schedule, and the keystone, the clock remap and the A/B cut all
 * living in the picture page where the construct cannot see them.
 *
 * IS IT AN ADJUSTMENT? Partly, and the parts are worth naming exactly:
 *
 *   the grade      — a FILTER on the overlay: a frame op on one attached
 *                    clip, not the plate. A clip filter, not an
 *                    adjustment layer (the plate is untouched). Chapter II
 *                    "The grade" is that filter on a chapter. CONFIRMED,
 *                    as the frame-op kind.
 *   the keystone   — not an adjustment. It is WHERE the attachment sits:
 *                    an anchor the picture publishes per frame (the
 *                    monitor's four corners, read off the plate), the way
 *                    Sylva's cards hang on anchors. A moving beacon.
 *   the clock remap— not an adjustment. It is the attachment's TIME MAP:
 *                    parent time → source time as a curve, the thing every
 *                    tool in the survey has (AE Time Remap, FCP timeMap,
 *                    OTIO time warp, Lottie tm, Rive remap) and the one
 *                    thing the sketches' Attach was missing.
 *   the A/B/A/B    — a reel: four clips with in/out points, concatenated,
 *                    attached whole.
 *
 * So: one filter, one anchor, one time map, one reel. The film itself
 * shrinks to a spine of two chapters over a plate, and the picture page
 * gives up the three things it was hiding.
 */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Film, Player, Video } from 'glimmer-motion/film';
import { PremierePlate } from './replate-plate';

// Unchanged from the picture page: the four corners of the program
// monitor over time (MONITOR, read off the 4K plate: the slide right at
// 7.5 s, the Fit shrink at 12 s) and his playhead over time (SCRUB, the
// cyan timecode sampled every 0.2 s and stretched onto twenty seconds).
// They stop being the page's private tables and become what they are: an
// anchor the picture publishes, and a time map on an attachment.
import { MONITOR, SCRUB } from './replate-data';

export class Replate extends Component {
  @tracked dimOn = false;
  @tracked zoomOn = false;

  <template>
    <div class="replate">
      <Film @name="replate" @title="Replate" @seek="exact" @end="card">
        {{! THE PLATE is the picture: a video actor. It publishes one
            anchor, `monitor`, whose corners it reads off the keyframed
            table per frame — a beacon that moves — and two actions, dim
            and zoom. It declares one filter, Look, and no adjustments. }}
        <:picture>
          <PremierePlate @src="nle/plate.mp4" @monitor={{MONITOR}} @secs={{31.88}} />
        </:picture>

        <:default as |f|>
          {{! THE OVERLAY is a reel of four clips attached to the monitor,
              for the whole plate, and DRIVEN THROUGH A TIME MAP: his scrub
              is our scrub. `@map` is parent time → source time, a pure
              curve; in, out and rate are its linear special case. Past the
              plate's end the map runs out and the reel plays on at rate 1. }}
          <f.Attach @name="ours" @to={{f.picture.anchor "monitor"}} @at={{0}} @for={{f.runtime}} @map={{SCRUB}} @end="hold">
            <f.Spine>
              <Video @src="nle/venice.mp4" @in={{0}} @out={{5}} />
              <Video @src="nle/chicago.mp4" @in={{0}} @out={{5}} />
              <Video @src="nle/venice.mp4" @in={{5}} @out={{10}} />
              <Video @src="nle/chicago.mp4" @in={{5}} @out={{10}} />
            </f.Spine>
          </f.Attach>

          {{! THE FILM: two chapters over a still camera. The only thing a
              beat ever carried here was a grade, and a grade is a filter
              on the overlay — so it goes on the chapter (an adjustment
              layer over "ours", not over the plate) and on the one shot
              that crushes it. Seven beats become three lines of direction. }}
          <f.Spine @tick={{2}}>
            <f.Chapter @n="I" @title="The scrub">
              <f.Shot @name="hold" @ticks={{2}} />
              <f.Shot @name="back" @ticks={{1}} />
              <f.Shot @name="cut-b" @ticks={{2}} />
              <f.Shot @name="arc" @ticks={{3}} />
            </f.Chapter>
            <f.Chapter @n="II" @title="The grade">
              <f.ours.Look @preset="grade" />
              <f.Shot @name="grade" @ticks={{2}} />
              <f.Shot @name="jog" @ticks={{3}}>
                <f.ours.Look @preset="crush" />
              </f.Shot>
              <f.Shot @name="last" @ticks={{3}} />
            </f.Chapter>
          </f.Spine>

          {{! TOOLS, off the timeline: Dim outlines the hole, Zoom punches
              into it. Actions on the picture, not on the clock. }}
          <div class="rp-tools">
            <button type="button" class="rp-tool {{if this.dimOn 'is-on'}}" {{on "click" (fn this.tool f "dim")}}>Dim</button>
            <button type="button" class="rp-tool {{if this.zoomOn 'is-on'}}" {{on "click" (fn this.tool f "zoom")}}>Zoom</button>
          </div>
          {{! THE TWO CLOCKS, read not reported: the film's own time and
              the attachment's mapped time are outputs on the handle, so
              the curve panel needs no postMessage. }}
          <ReplateClocks @film={{f.time}} @clip={{f.at "ours"}} @map={{SCRUB}} />
          <Player @film={{f}} @rail={{false}} @menu={{false}} />
        </:default>
      </Film>
    </div>
  </template>

  tool = (f: FilmHandle, which: 'dim' | 'zoom') => {
    if (which === 'dim') this.dimOn = !this.dimOn; else this.zoomOn = !this.zoomOn;
    f.send('picture', which);
  };
}
