/**
 * THE LONG TAKE, AS A FILM — a sketch, not a build.
 *
 * `examples/long-take.gts` is one shot with no cuts: a laptop whose screen
 * holds a drawing that never changes, and two cameras on one list — one
 * INSIDE the screen moving the frame over the drawing (`c.Frame`,
 * `c.Aim`, `c.Pan`, `c.SlowZoom`), one OUTSIDE moving the laptop in the
 * room (`c.Camera3D`). Two regions, two runs, and a rAF loop that seeks
 * the inner one to the outer whenever they come more than a frame apart.
 *
 * The mockup showed what a film adds to a sequence: cuts and joins. The
 * long take is the opposite test. It wants NO cut and NO join, so what a
 * film gives it must be something else, and it is two things:
 *
 *   1. The board is ATTACHED, so it is driven. The film writes its clock
 *      into the board's run every frame; the sync loop, the slop band and
 *      the take counter go. Every step on the board is seekable by
 *      construction (that is what made the sync sound), so the whole film
 *      can declare `@seek="exact"` and mean it.
 *
 *   2. The inner camera is a LANE of the shot, not a second score. A shot
 *      carries its outer pose as its own arguments and its inner moves as
 *      steps addressed to the board — so "one list, two cameras" stops being a
 *      discipline the shot list enforces and becomes what a shot IS.
 *
 * Every pose, fill, move and hold is the demo's own (`long-take/shots.ts`).
 * What is new to the vocabulary is logged in REVISIONS.md: `f.Lane @in`,
 * a spine with no `@join`, `@lens="still"`, the resume rule on the handle.
 */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Film, Player } from '@cardstack/choreo/film';
import { Board } from 'test-app/components/long-take/board';
import { LaptopStage } from 'test-app/components/long-take/stage';

// Unchanged from long-take.gts: the GLB and its loader, the CSS3D
// mapping, the gloss, the still and its frozen matrices (REF), the pads.
// SHOTS, RUNTIME and the sync modifier are gone: the shots are the
// template and the sync is the attachment.
import * as D from './long-take-data';
const { STILL, REF, BOARD } = D;

export class LongTake extends Component {
  /** flat by default: the 3D engine is not downloaded until it is asked for */
  @tracked lens: '3d' | 'still' = 'still';
  @tracked cameraOn = true;
  @tracked roomy = true;

  <template>
    <div class="lt-page" data-mode={{this.lens}}>
      <Film
        @name="long-take"
        {{! EXACT, AND CHEAPLY. No changeset, no cue, no spring anywhere
            in this film; every camera step is a function of the clock. }}
        @seek="exact"
        @lens={{this.lens}}
        @mute={{if this.cameraOn (array) (array "camera")}}
        @ease={{array 0.65 0 0.35 1}}
        @end="loop"
        @autoplay={{this.roomy}}
      >
        <:picture>
          <LaptopStage @gloss={{0.12}} />
        </:picture>
        {{! A STILL IS A LENS. Flat, the picture is a photograph of the
            round one at its rest pose (its screen a transparent hole the
            board composites through), the film stands at its head, and
            there is nothing to transport. }}
        <:still>
          <img src={{STILL}} width={{REF.w}} height={{REF.h}} alt="A MacBook Pro at rest, the drawing on its screen" />
        </:still>

        <:default as |f|>
        {{! THE SCREEN. One region, attached for the whole film and driven
            by it. Nothing in it mounts, moves or animates on its own; its
            camera is written from the shots below. }}
        <f.Attach @name="board" @to={{f.head}} @for={{f.runtime}}>
          <Board @size={{BOARD}} />
        </f.Attach>

        {{! THE SPINE HAS NO JOIN. One shot runs into the next by travel;
            a boundary is where the next pose begins, and nothing else. }}
        <f.Spine>
          {{! ESTABLISH. Wide, and turned enough that the lid has a
              thickness. Inside: fit the whole drawing, then a breath. }}
          <f.Shot @name="establish" @for={{3.6}} @yaw={{-19}} @pitch={{-4}} @dolly={{1.3}}>
            <f.Lane @in="board" as |b|>
              <b.Frame @of={{b.id "board"}} @padding={{1}} @duration={{1.4}} />
              <b.SlowZoom @by={{1.04}} />
            </f.Lane>
          </f.Shot>

          {{! IN on the capsule: the one big magnification change in the
              film, and the laptop swings round WITH it. Every push-in is
              paid for with a turn. }}
          <f.Shot @name="capsule" @for={{3.9}} @yaw={{-24}} @pitch={{5}} @dolly={{0.84}}>
            <f.Lane @in="board" as |b|>
              <b.Frame @of={{b.id "capsule"}} @padding={{0.58}} @duration={{2.0}} />
              <b.SlowZoom @by={{1.05}} />
            </f.Lane>
          </f.Shot>

          {{! ACROSS to the preamp — an AIM, so the scale is untouched and
              the eye reads travel, not another zoom. The outer camera
              crosses the other way. }}
          <f.Shot @name="preamp" @for={{3.3}} @yaw={{-6}} @pitch={{7}} @dolly={{0.82}}>
            <f.Lane @in="board" as |b|>
              <b.Aim @of={{b.id "preamp"}} @duration={{1.6}} />
              <b.SlowZoom @by={{1.04}} />
            </f.Lane>
          </f.Shot>

          {{! ...and on to the converter. Same move, same scale: a walk. }}
          <f.Shot @name="converter" @for={{3.1}} @yaw={{14}} @pitch={{9}} @dolly={{0.8}}>
            <f.Lane @in="board" as |b|>
              <b.Aim @of={{b.id "converter"}} @duration={{1.5}} />
              <b.SlowZoom @by={{1.04}} />
            </f.Lane>
          </f.Shot>

          {{! THE HIGH ANGLE. The inner camera drifts off the signal path
              while the outer one climbs until the deck opens up — the
              shot where you remember this is a laptop. }}
          <f.Shot @name="deck" @for={{3.6}} @yaw={{22}} @pitch={{21}} @dolly={{0.92}}>
            <f.Lane @in="board" as |b|>
              <b.Pan @x={{150}} @y={{-40}} @duration={{1.6}} />
              <b.SlowZoom @by={{1.03}} />
            </f.Lane>
          </f.Shot>

          {{! DOWN to the desk — the widest block on the board, so the
              frame pulls back out to hold it. }}
          <f.Shot @name="desk" @for={{4.0}} @yaw={{-16}} @pitch={{8}} @dolly={{0.82}}>
            <f.Lane @in="board" as |b|>
              <b.Frame @of={{b.id "desk"}} @padding={{0.82}} @duration={{1.9}} />
              <b.SlowZoom @by={{1.06}} />
            </f.Lane>
          </f.Shot>

          {{! ACROSS to the monitors, scale held again, and the deepest
              turn of the film underneath it. }}
          <f.Shot @name="monitors" @for={{3.2}} @yaw={{-26}} @pitch={{4}} @dolly={{0.78}}>
            <f.Lane @in="board" as |b|>
              <b.Aim @of={{b.id "monitors"}} @duration={{1.5}} />
              <b.SlowZoom @by={{1.05}} />
            </f.Lane>
          </f.Shot>

          {{! OUT. Back to the whole drawing, and the laptop settles
              square-ish for the loop to start from somewhere calm. }}
          <f.Shot @name="out" @for={{4.0}} @yaw={{10}} @pitch={{-6}} @dolly={{1.28}}>
            <f.Lane @in="board" as |b|>
              <b.Frame @of={{b.id "board"}} @padding={{1}} @duration={{2.4}} />
              <b.SlowZoom @by={{1.02}} />
            </f.Lane>
          </f.Shot>
        </f.Spine>

        {{! UI, OFF THE TIMELINE. The camera button is f.pause / f.play —
            RESUME, never restart: a run standing right there with a clock
            on it is pressed on, and only an ended one is cut again. The
            pads hand a pose to the picture and call f.mute "camera". Flat,
            there is no transport, because a still does not play. }}
        {{#if (eq this.lens "3d")}}
          <Player @film={{f}} @rail={{false}} @menu={{false}} @controls={{array "camera"}} />
        {{/if}}
        </:default>
      </Film>

      <div class="lt-chrome">
        <div class="lt-seg" role="group" aria-label="Presentation">
          <button type="button" aria-pressed="{{eq this.lens 'still'}}" {{on "click" (fn this.pick "still")}}>2D</button>
          <button type="button" aria-pressed="{{eq this.lens '3d'}}" {{on "click" (fn this.pick "3d")}}>3D</button>
        </div>
      </div>
    </div>
  </template>
}
