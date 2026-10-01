/**
 * SYLVA, AS A FILM — a sketch, not a build.
 *
 * `sylva-stage.gts` is a moss world with four live cards hole-punched into
 * it and a camera that never stops: one `c.Camera3D @through` over eleven
 * waypoints (a title drift, four reading swings, the way home), presents
 * clipped into the flight so a card grows out of its dot while the frame
 * still carries speed, hand-offs as cross-fades, a narration lower third
 * on the same beats, and a lap that goes round again.
 *
 * It is the film that DERIVES its shots. Nobody typed the reading poses:
 * each is computed from the card's anchor and its normal by the scene, and
 * the swing either side of square-on is one rule applied four times. The
 * design record asked for exactly this — "a film should be able to hand
 * the construct a waypoint provider" — and the graph answers it with the
 * composite-step contract that already exists: `Read` below is a shot
 * kind written in the app, with five published handles and no library
 * privilege, and its pose comes from a QUERY on the picture the way a
 * board shot's comes from `b.id`.
 *
 * What is new is logged in REVISIONS.md: a custom shot kind, picture
 * anchors as 3D beacons, `@tick` on the spine (Sylva's uniform segment IS
 * the two films' tick), `f.Plane` with a replace policy for the cards and
 * the lower third, `@until` on an attachment, `f.send` on the handle.
 */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { at } from 'glimmer-motion';
import { Film, Player, Shot, type ShotArgs } from 'glimmer-motion/film';
import { FieldCard } from 'test-app/components/sylva/field-card';
import { MossWorld } from 'test-app/components/sylva/world';

// Unchanged from sylva-stage.gts: the four SPOTS (anchor fraction, tilt,
// the card's offset from its pin, the field action, the story line), the
// vendored scene, the hole-punch proxies, the depth sort, the raycast
// guard. REST, SWING, the lap arithmetic and `legs` are gone: REST is the
// spine's opening pose, SWING is Read's handles, the arithmetic is @tick.
import { SPOTS } from './sylva-data';

/**
 * A READ — the one-task shot this film is made of, with its handles.
 *
 * Approach the card slightly BEFORE square-on and pan slowly THROUGH it to
 * slightly past, easing the dolly in a touch: the card is presented by a
 * frame that never stops moving and is exactly square at the middle of
 * its own read. The reading pose is not an argument; it is asked of the
 * picture (`@of` is an anchor, a 3D beacon), and yaw is unwrapped against
 * the pose in force so the tour walks round the tree rather than 340°
 * back across the front of it — the library's job now, not the film's.
 */
class Read extends Shot<
  ShotArgs & { of: SylvaAnchor; push?: number; swing?: number; truck?: number }
> {
  node() {
    const { of, swing = 7, push = 0.05, truck = 0.018 } = this.args;
    const read = of.reading; // the pose the scene derives from the normal
    return this.shot({
      name: this.args.name,
      ticks: 2,
      look: of.point,
      from: { ...read, yaw: read.yaw - swing, dolly: read.dolly + push, x: read.x - truck },
      to: { ...read, yaw: read.yaw + swing, dolly: read.dolly - push * 0.6, x: read.x + truck },
    });
  }
}

export class SylvaStage extends Component<{ Args: { theater?: boolean } }> {
  /** tile, stage, theater, embed: the same film, four rooms */
  @tracked context: 'stage' | 'theater' | 'tile' = this.args.theater ? 'theater' : 'tile';
  /** `?film` strips the controls: nothing on screen but the world and the words */
  readonly film = /[?&]film\b/.test(location.search);

  <template>
    <Film
      @name="sylva"
      @seek="exact"
      {{! THE CLOCK IS THE SPLINE. Eleven waypoints in 31 seconds, so one
          tick is 2.82 s and a shot's length is its waypoint count — the
          rule the two films call `ticks`, with the tick as a spine
          parameter instead of a constant. }}
      @end="loop"
      @lens={{if (eq this.context "tile") "still" "3d"}}
      @chrome={{not this.film}}
      @autoplay={{true}}
    >
      <:picture>
        <MossWorld @spots={{SPOTS}} @gloss={{0.12}} />
      </:picture>
      <:still>
        <img src="/sylva-poster.webp" alt="" />
      </:still>

      <:default as |f|>
        {{! TWO PLANES, one policy: a newcomer replaces whoever is up, and
            its entrance is the leaver's exit — the cross-fade mid-flight
            that the spike calls a hand-off. Nothing closes; the next one
            opens. }}
        <f.Plane @name="cards" @z={{1}} @policy="replace" />
        <f.Plane @name="narration" @z={{2}} @policy="replace" />

        <f.Spine @tick={{2.82}} @dolly={{1.34}} @pitch={{4}} @y={{-0.12}} @yaw={{0}}>
          {{! THE TITLE SCENE: two wide waypoints before any card — the
              camera drifts across the whole root while the title reads,
              never resting, going nowhere in particular yet }}
          <f.Shot @name="title" @ticks={{2}} @dolly={{1.3}} @yaw={{-6}} @look={{array 0 0 0}}>
            <f.To @dolly={{1.26}} @yaw={{5}} />
            <f.Type @mode="title" @kicker="A field survey" @word="Sylva" @reading="Step into the living world"
              @gloss="One moss root, four residents — patient design, native planting, a deeper kind of stewardship."
              @plane="narration" />
          </f.Shot>

          {{! FOUR READS. Each is the same shot with a different anchor;
              its card is presented 0.9 s before the reading waypoint is
              crossed, airborne, and stays up until the next card takes
              its plane. The narration swaps on the same beat and holds
              across the travel, so the series title never flashes
              between legs. }}
          {{#each SPOTS as |spot index|}}
            <Read @name={{spot.id}} @of={{f.picture.anchor spot.id}}>
              <f.Attach @plane="cards" @at={{at spot.id 0.5 -0.9}} @until={{f.next "cards"}}>
                <FieldCard @spot={{spot}} @send={{f.send}} />
              </f.Attach>
              <f.Type @mode="lower" @plane="narration" @at={{at spot.id 0.5 -0.9}} @until={{f.next "narration"}}
                @kicker="{{spot.kind}} · {{pad index}} / 04" @says={{array spot.story}} />
            </Read>
          {{/each}}

          {{! HOME. Back to the rest pose; the last card lets go a beat
              into the pull-out, and the narration hands back to the title. }}
          <f.Shot @name="home" @ticks={{1}} @look={{array 0 0 0}}>
            <f.Attach @plane="cards" @at={{at "home" 0.2}} />
            <f.Type @mode="title" @plane="narration" @at={{at "home" 0.2}} @kicker="A field survey" @word="Sylva" />
          </f.Shot>
        </f.Spine>

        {{! THE DOTS, off the timeline. A dot pauses the film, opens its
            card and flies the hand-camera to it: a visit is a seize, and
            two askers each own one thing. `?film` hides them. }}
        {{#if f.chrome}}
          <div class="sy-dots">
            <button type="button" class="sy-dot sy-play" {{on "click" f.toggle}}>{{if f.playing "Pause" "Tour"}}</button>
            <button type="button" class="sy-dot" {{on "click" f.restart}}>Title</button>
            {{#each SPOTS as |spot|}}
              <button type="button" class="sy-dot" {{on "click" (fn this.visit f spot)}}>{{spot.name}}</button>
            {{/each}}
          </div>
        {{/if}}
        <Player @film={{f}} @rail={{false}} @menu={{false}} @transport={{false}} />
      </:default>
    </Film>
  </template>

  /** a visit: stop the tour, put the card up, hand the camera to the hand */
  visit = (f: FilmHandle, spot: Spot) => {
    f.pause();
    f.send('cards', 'open', spot.id);
    f.send('picture', 'fly', spot.id);
  };
}
