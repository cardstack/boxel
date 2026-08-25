import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type CameraState, Choreo, motion, spring } from 'glimmer-motion';

/**
 * The concept deck's camera rules, played straight: zoom out to reveal the
 * edges for rearranging; zoom in for in-place editing; camera moves scale
 * things proportionally but never change what a thing is — except past the
 * threshold, where the thing itself decides to be more.
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
const settle = spring({ bounce: 0.18, visualDuration: 0.42 });

/** zoomed in enough to work: past this, a boxel offers its edit form */
const EDIT_AT = 1.3;

export class Camera extends Component {
  @tracked focus: string | null = null;
  @tracked arranging = false;

  /** one number, derived from state — the Camera step reads it every pass */
  get zoom() {
    if (this.focus) {
      return 1.5;
    }
    return this.arranging ? 0.84 : 1;
  }

  pick = (id: string, event: Event) => {
    event.stopPropagation();
    this.arranging = false;
    this.focus = this.focus === id ? null : id;
  };

  clear = () => {
    this.focus = null;
  };

  /** the form's own controls end the edit; they never toggle the card */
  save = (event: Event) => {
    event.stopPropagation();
    this.focus = null;
  };

  swallow = (event: Event) => {
    event.stopPropagation();
  };

  toggleArrange = () => {
    this.focus = null;
    this.arranging = !this.arranging;
  };

  /**
   * The deck's coupling, made safe: past a zoom threshold a boxel
   * TRANSMUTES. `c.camera` is tracked and lands at step boundaries — never
   * per frame — so deriving the form from it cannot feed back into the
   * move. The camera's landing is what inserts the edit form.
   */
  transmuted = (id: string, camera: CameraState) =>
    this.focus === id && camera.zoom > EDIT_AT;

  isFocus = (id: string) => this.focus === id;

  <template>
    <div class="ex">
      <div class="cam">
        <div class="cam-bar">
        <button
          type="button"
          class={{if this.arranging "cam-mode is-on" "cam-mode"}}
          {{on "click" this.toggleArrange}}
        >
          {{if this.arranging "Done" "Arrange"}}
        </button>
      </div>

      {{! the stage clips; the ARRANGE zoom is what reveals the edges }}
      <Choreo class="cam-stage" {{on "click" this.clear}} as |c|>
        <div class="cam-board">
          {{#each boxels as |boxel|}}
            <button
              type="button"
              class={{if (this.isFocus boxel.id) "cam-card is-focus" "cam-card"}}
              {{motion id=boxel.id role="card"}}
              {{on "click" (fn this.pick boxel.id)}}
            >
              <b class="cam-name">{{boxel.label}}</b>
              <small class="cam-kicker">{{boxel.kicker}}</small>
              {{#if (this.transmuted boxel.id c.camera)}}
                <span
                  class="cam-edit"
                  {{motion id="edit" role="edit"}}
                  {{on "click" this.swallow}}
                >
                  <span class="cam-field"><em>Temp</em>{{boxel.temp}}</span>
                  <span class="cam-field"><em>Pour</em>42 of 60</span>
                  <span
                    class="cam-save"
                    role="button"
                    {{on "click" this.save}}
                  >Save</span>
                </span>
              {{/if}}
            </button>
          {{/each}}
        </div>

        {{! @steady: scales WITH the world, damped back toward readable —
            never pinned, never lost }}
        <span class="cam-hud" {{motion id="hud" role="hud"}}>
          {{zoomLabel c.camera}}
        </span>

        <c.Parallel>
          {{! ONE camera step, aimed by state. Every pass replays it toward
              wherever the app now stands — an interrupted zoom simply bends. }}
          <c.Camera
            @zoom={{this.zoom}}
            @origin={{if this.focus (c.id this.focus)}}
            @spring={{carry}}
            @steady={{c.role "hud"}}
          />
          {{! the form reflows the board: every box that moved for it — the
              transmuted card growing, its neighbours making room — tweens }}
          <c.Move @of={{c.moved "card"}} @spring={{settle}} />
          {{! the form arrives only after the camera has landed (it is the
              landing that renders it), and leaves as the camera pulls back }}
          <c.Tween
            @of={{c.inserted "edit"}}
            @opacity={{array 0 1}}
            @duration={{0.24}}
          />
          <c.Tween @of={{c.removed "edit"}} @opacity={{0}} @duration={{0.16}} />
        </c.Parallel>
      </Choreo>
      </div>
    </div>
  </template>
}

function zoomLabel(camera: CameraState) {
  return `${camera.zoom.toFixed(2)}×`;
}
