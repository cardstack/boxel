import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type CameraState, Choreo, motion, spring } from 'glimmer-motion';

/**
 * The concept deck's camera rules, played straight: zoom out to see the
 * whole floor, zoom in to work on one kiln — and the camera never changes
 * what a thing is, only how close you are standing.
 */
const boxels = [
  { id: 'atlas', kicker: 'Night shift', label: 'Atlas', temp: '1280°' },
  { id: 'ember', kicker: 'Kiln floor', label: 'Ember', temp: '1310°' },
  { id: 'flux', kicker: 'Cooling rack', label: 'Flux', temp: '860°' },
  { id: 'halo', kicker: 'Foundry glass', label: 'Halo', temp: '1150°' },
];

/** a camera has weight: it carries the whole scene, so it never snaps */
const carry = spring({ bounce: 0.12, visualDuration: 0.62 });

/** the boxels' own boxes, when the edit form reflows the board */
const settle = spring({ bounce: 0.22, visualDuration: 0.42 });

export class Camera extends Component {
  @tracked focus: string | null = null;
  @tracked mapped = false;

  /** one number, derived from state — the Camera step reads it every pass */
  get zoom() {
    if (this.focus) {
      return 1.5;
    }
    return this.mapped ? 0.84 : 1;
  }

  pick = (id: string, event: Event) => {
    event.stopPropagation();
    this.mapped = false;
    this.focus = this.focus === id ? null : id;
  };

  clear = () => {
    this.focus = null;
    this.mapped = false;
  };

  /** the form's own controls end the edit; they never toggle the card */
  save = (event: Event) => {
    event.stopPropagation();
    this.focus = null;
  };

  swallow = (event: Event) => {
    event.stopPropagation();
  };

  toggleMap = (event: Event) => {
    event.stopPropagation();
    this.focus = null;
    this.mapped = !this.mapped;
  };

  isFocus = (id: string) => this.focus === id;

  <template>
    <div class="ex">
      <div class="cam">
        {{! the cursor is the affordance: zoom-in over a kiln, zoom-out on
            the floor once you are close — no toolbar, the world explains }}
        <Choreo
          class={{if this.focus "cam-stage is-zoomed" "cam-stage"}}
          {{on "click" this.clear}}
          as |c|
        >
          <div class="cam-board">
            {{#each boxels as |boxel|}}
              <button
                type="button"
                class={{if
                  (this.isFocus boxel.id)
                  "cam-card is-focus"
                  "cam-card"
                }}
                {{motion id=boxel.id role="card"}}
                {{on "click" (fn this.pick boxel.id)}}
              >
                <b class="cam-name">{{boxel.label}}</b>
                <small class="cam-kicker">{{boxel.kicker}}</small>
                {{! the transmute rides the SAME pass as the zoom: the form
                    arrives, the card grows and the camera dives together —
                    one changeset, one timeline. Each field is its own
                    participant, so the arrival is a delivery ladder. }}
                {{#if (this.isFocus boxel.id)}}
                  <span
                    class="cam-edit"
                    {{motion id="edit-panel" role="edit"}}
                    {{on "click" this.swallow}}
                  >
                    <span
                      class="cam-field"
                      {{motion id="edit-temp" role="edit"}}
                    ><em>Temp</em>{{boxel.temp}}</span>
                    <span
                      class="cam-field"
                      {{motion id="edit-pour" role="edit"}}
                    ><em>Pour</em>42 of 60</span>
                    <span
                      class="cam-save"
                      role="button"
                      {{motion id="edit-save" role="edit"}}
                      {{on "click" this.save}}
                    >Save</span>
                  </span>
                {{/if}}
              </button>
            {{/each}}
          </div>

          {{! the readout and the map live IN the world, and both are
              @steady: they scale with the floor, damped back toward
              readable — never pinned, never lost }}
          <span class="cam-hud-group">
            <button
              type="button"
              class={{if this.mapped "cam-map is-on" "cam-map"}}
              {{motion id="hud-map" role="hud"}}
              {{on "click" this.toggleMap}}
            >{{if this.mapped "close" "map"}}</button>
            <span class="cam-hud" {{motion id="hud-zoom" role="hud"}}>
              {{zoomLabel c.camera}}
            </span>
          </span>

          <c.Parallel>
            {{! ONE camera step, aimed by state. Every pass replays it
                toward wherever the app now stands — an interrupted zoom
                simply bends. }}
            <c.Camera
              @zoom={{this.zoom}}
              @origin={{if this.focus (c.id this.focus)}}
              @spring={{carry}}
              @steady={{c.role "hud"}}
            />
            {{! the form reflows the board: every box that moved for it —
                the card growing, its neighbours making room — tweens }}
            <c.Move @of={{c.moved "card"}} @spring={{settle}} />
            {{! the fields climb in as the camera dives, a short ladder;
                everything leaves at once when it pulls back }}
            <c.Tween
              @of={{c.inserted "edit"}}
              @opacity={{array 0 1}}
              @stagger={{0.07}}
              @duration={{0.2}}
            />
            <c.Tween
              @of={{c.removed "edit"}}
              @opacity={{0}}
              @duration={{0.14}}
            />
          </c.Parallel>
        </Choreo>
      </div>
    </div>
  </template>
}

function zoomLabel(camera: CameraState) {
  return `${camera.zoom.toFixed(2)}×`;
}
