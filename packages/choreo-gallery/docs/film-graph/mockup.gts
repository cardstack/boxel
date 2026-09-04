/**
 * THE MOCKUP, AS A FILM — a sketch, not a build.
 *
 * `examples/mockup.gts` is a phone whose screen is live DOM, six apps on
 * it, and one looping score: an app opens, the camera locks on three
 * things worth looking at, something gets pressed, the app closes. The
 * same poses drive a 3D orbit or a 2D zoom. Today it is a smooth
 * sequence — every camera move is a glide, because that is all a
 * sequence of `c.Camera3D` steps can say.
 *
 * Written as a film it gains what a sequence cannot say: a JUMP CUT on
 * the press (the straightened read lands, it does not arrive), a JOIN
 * between apps where the hallway is not wanted, and a shot that is
 * RELATIVE to whatever the last one left. Every pose, hold and tap is
 * the demo's own; the cuts and joins are the only additions, marked.
 *
 * What is new to the vocabulary here, and logged in REVISIONS.md:
 * `f.Cue` (a triggered command, folded), `f.Shot @by` (relative),
 * shots in seconds, `@picture` as a region, `@lens`, `@tracks`,
 * `@end="loop"`.
 */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Film, Player } from 'glimmer-motion/film';
import { PhoneStage } from 'test-app/components/mockup/stage';

// Unchanged from mockup.gts: the six apps and their authored grid, the
// CSS3D mapping, the GLB and its loader, the pads and the stick. SCENES,
// HOME_SHOT, TRAVEL, RETURN and GLIDE are gone: they are the template.
import * as D from './mockup-data';
const { APPS } = D;

export class Mockup extends Component {
  /** 2D by default: the 3D engine is not downloaded until it is asked for */
  @tracked lens: '2d' | '3d' = '2d';
  /** a drag means "let me look"; a tap on the screen means "let me use it" */
  @tracked cameraOn = true;
  @tracked cuesOn = true;
  /** a gallery card does not run a film */
  @tracked roomy = true;
  /** the tracks a gesture has taken: 'camera' after a drag, 'cues' after a tap */
  get muted(): ('camera' | 'cues')[] {
    return [...(this.cameraOn ? [] : ['camera' as const]), ...(this.cuesOn ? [] : ['cues' as const])];
  }

  <template>
    <div class="mg-page" data-mode={{this.lens}}>
      <Film
        @name="mockup"
        @seek="exact"
        {{! ONE SCORE, TWO LENSES. The same shots compile to c.Camera3D
            in 3D and to c.Camera in 2D; the poses do not change. }}
        @lens={{this.lens}}
        {{! TRACKS THAT MUTE WITHOUT RETIMING. The demo swapped each step
            for a Wait by hand, twice, in the template. }}
        @mute={{this.muted}}
        @ease={{array 0.65 0 0.35 1}}
        @end="loop"
        @autoplay={{this.roomy}}
      >
        {{! THE PICTURE IS A REGION, not a page in an iframe. The stage
            owns the canvas, the CSS3D plane and the six app regions on
            the screen; its port is two calls, pose() and tint(), and it
            declares no adjustments. }}
        <:picture>
          <PhoneStage @apps={{APPS}} />
        </:picture>

        <:default as |f|>
        <f.Spine @join="cut">
          {{! THE OPENER. Hard left and wide: meet the device before the
              app. Six scenes, one grammar: TURN WIDE, STRAIGHTEN AND
              PUSH, ACCENT on the press, TURN AWAY. }}
          <f.Sequence @name="mail" @join="blend">
            {{! HOME, WITHOUT GOING BACK TO THE BEGINNING: a RELATIVE shot
                that only pulls back, from whatever angle the last scene
                left. }}
            <f.Shot @name="mail-hall" @for={{0.5}} @by={{true}} @dolly={{1.22}} @y={{-0.03}} />
            <f.Shot @name="mail-wide" @for={{2.2}} @dolly={{1.24}} @pitch={{-12}} @x={{0.04}} @y={{0.02}} @yaw={{-30}}>
              <f.Cue @action="open" @target="mail" />
            </f.Shot>
            {{! THE PRESS IS A JUMP CUT. The sequence glided onto the
                header; the film lands there and presses. }}
            <f.Shot @name="mail-read" @for={{2.8}} @cut={{true}} @dolly={{0.94}} @pitch={{-4}} @x={{0.01}} @y={{0.18}} @yaw={{-8}}>
              <f.Cue @action="tap" @target="mail" @payload="Unread" @via="text" />
            </f.Shot>
            {{! then simply fall down the list that just changed }}
            <f.Shot @name="mail-list" @for={{2.6}} @dolly={{0.9}} @pitch={{-1}} @x={{0}} @y={{-0.08}} @yaw={{-2}}>
              <f.Cue @action="close" @target="mail" @at={{f.tail}} />
            </f.Shot>
          </f.Sequence>

          {{! SWING THE OTHER WAY. A map is a surface, so come down onto
              it. A blend between apps instead of the hallway: the phone
              stays where it is and the screen changes under the lens. }}
          <f.Join @presentation="blend" />
          <f.Sequence @name="maps">
            <f.Shot @name="maps-wide" @for={{2.4}} @dolly={{1.2}} @pitch={{9}} @x={{-0.02}} @y={{0.04}} @yaw={{26}}>
              <f.Cue @action="open" @target="maps" />
            </f.Shot>
            <f.Shot @name="maps-read" @for={{3.0}} @cut={{true}} @dolly={{0.92}} @pitch={{2}} @x={{0.02}} @y={{0.02}} @yaw={{10}}>
              <f.Cue @action="tap" @target="maps" @payload="Transit" @via="text" />
            </f.Shot>
            {{! settle level on the sheet, which is where the answer is }}
            <f.Shot @name="maps-sheet" @for={{2.6}} @dolly={{0.88}} @pitch={{-2}} @x={{-0.05}} @y={{-0.14}} @yaw={{0}}>
              <f.Cue @action="close" @target="maps" @at={{f.tail}} />
            </f.Shot>
          </f.Sequence>

          {{! HIGH AND LEFT, then a vertical move: art, transport, queue. }}
          <f.Sequence @name="music">
            <f.Shot @name="music-hall" @for={{0.5}} @by={{true}} @dolly={{1.22}} @y={{-0.03}} />
            <f.Shot @name="music-wide" @for={{2.4}} @dolly={{1.18}} @pitch={{-15}} @x={{0.03}} @y={{0.12}} @yaw={{-22}}>
              <f.Cue @action="open" @target="music" />
            </f.Shot>
            <f.Shot @name="music-play" @for={{2.6}} @cut={{true}} @dolly={{0.9}} @pitch={{0}} @x={{0}} @y={{0.02}} @yaw={{-4}}>
              <f.Cue @action="tap" @target="music" @payload="play" @via="text" />
            </f.Shot>
            {{! tip down to the queue as it starts playing }}
            <f.Shot @name="music-queue" @for={{2.8}} @dolly={{0.94}} @pitch={{7}} @x={{0.02}} @y={{-0.18}} @yaw={{7}}>
              <f.Cue @action="close" @target="music" @at={{f.tail}} />
            </f.Shot>
          </f.Sequence>

          {{! A QUIET ONE. Barely moves: open a note and let it be read.
              No cut here on purpose; the glide IS the quiet. }}
          <f.Sequence @name="notes">
            <f.Shot @name="notes-hall" @for={{0.5}} @by={{true}} @dolly={{1.22}} @y={{-0.03}} />
            <f.Shot @name="notes-wide" @for={{2.2}} @dolly={{1.1}} @pitch={{-7}} @x={{0}} @y={{0.03}} @yaw={{17}}>
              <f.Cue @action="open" @target="notes" />
            </f.Shot>
            <f.Shot @name="notes-read" @for={{3.0}} @dolly={{0.92}} @pitch={{-2}} @x={{0.01}} @y={{0.12}} @yaw={{4}}>
              <f.Cue @action="tap" @target="notes" @payload="Dinner, Saturday" @via="text" />
              <f.Cue @action="close" @target="notes" @at={{f.tail}} />
            </f.Shot>
          </f.Sequence>

          {{! FRONT ON. You watch numbers square, not at an angle. Two
              presses in one shot: the second is placed inside it. }}
          <f.Join @presentation="dip" @to="#000" />
          <f.Sequence @name="clock">
            <f.Shot @name="clock-wide" @for={{2.0}} @dolly={{1.06}} @pitch={{-5}} @x={{0}} @y={{0.02}} @yaw={{-13}}>
              <f.Cue @action="open" @target="clock" />
            </f.Shot>
            <f.Shot @name="clock-timer" @for={{1.6}} @cut={{true}} @dolly={{0.9}} @pitch={{0}} @x={{0}} @y={{0}} @yaw={{-2}}>
              <f.Cue @action="tap" @target="clock" @payload="Timer" @via="text" />
            </f.Shot>
            {{! and hold on the dial once it is running }}
            <f.Shot @name="clock-run" @for={{2.6}} @dolly={{0.88}} @pitch={{2}} @x={{0}} @y={{-0.02}} @yaw={{2}}>
              <f.Cue @action="tap" @target="clock" @payload="Start" @via="text" />
              <f.Cue @action="close" @target="clock" @at={{f.tail}} />
            </f.Shot>
          </f.Sequence>

          {{! THE SIGN-OFF. Turn away and pull out; the film ends on the
              object. }}
          <f.Sequence @name="photos">
            <f.Shot @name="photos-hall" @for={{0.5}} @by={{true}} @dolly={{1.22}} @y={{-0.03}} />
            <f.Shot @name="photos-open" @for={{1.6}} @dolly={{1.12}} @pitch={{-8}} @x={{0}} @y={{0.06}} @yaw={{22}}>
              <f.Cue @action="open" @target="photos" />
            </f.Shot>
            <f.Shot @name="photos-away" @for={{2.2}} @dolly={{1.32}} @pitch={{-13}} @x={{-0.02}} @y={{0}} @yaw={{31}}>
              <f.Cue @action="close" @target="photos" @at={{f.tail}} />
            </f.Shot>
          </f.Sequence>
        </f.Spine>

        {{! UI, OFF THE TIMELINE. The lens switch, the transport and the
            pads belong to the viewer, not to the shot: outside the
            region, above the camera, never moved by it. A drag on the
            phone calls f.mute "camera"; a tap on the screen calls
            f.mute "cues"; the film's own taps do not count as touches. }}
        <Player @film={{f}} @rail={{false}} @menu={{false}} />
        </:default>
      </Film>

      <div class="mg-chrome">
        <div class="mg-seg" role="group" aria-label="Presentation">
          <button type="button" aria-pressed="{{eq this.lens '2d'}}" {{on "click" (fn this.pick "2d")}}>2D</button>
          <button type="button" aria-pressed="{{eq this.lens '3d'}}" {{on "click" (fn this.pick "3d")}}>3D</button>
        </div>
      </div>
    </div>
  </template>
}
