import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { createChoreoPlayer } from '@cardstack/choreo-player';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, styles } from 'glimmer-motion';

export class RecordableScene extends Component {
  @tracked armed = false;
  @tracked requested = 0;
  private context?: ChoreoContext;
  private disposed = false;
  private player = createChoreoPlayer({
    duration: 6,
    prepare: async () => {
      this.armed = true;
      const deadline = performance.now() + 5000;
      // c.run is a live getter, not tracked state. Observe publication after
      // the render pass; this loop waits for readiness, it does not sequence motion.
      while (!this.context?.run && !this.disposed) {
        if (performance.now() > deadline) {
          throw new Error('The scene did not publish a run');
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
      }
    },
    runs: () => (this.context?.run ? [this.context.run] : []),
  });
  @tracked distance = 240;
  get positions() {
    return [0, this.distance, this.distance, 0];
  }
  scales = [1, 1.5, 0.8, 1];
  times = [0, 0.35, 0.65, 1];
  bind = modifier((_el: HTMLElement, [context]: [ChoreoContext]) => {
    this.context = context;
  });
  renderAt = async (time: number) => {
    await this.player.renderAt(time);
  };
  play = () => {
    void this.player.play();
  };
  pause = () => {
    this.player.pause();
  };
  seek = (event: Event) => {
    this.requested = Number((event.target as HTMLInputElement).value);
    void this.renderAt(this.requested);
  };
  expose = modifier((el: HTMLElement) => {
    this.distance = el.clientWidth * 0.6;
    const capture = { renderAt: this.renderAt, duration: 6 };
    Object.assign(el, { tutorialCapture: capture });
    return () => {
      this.disposed = true;
      this.player.pause();
      Reflect.deleteProperty(el, 'tutorialCapture');
    };
  });
  <template>
    <section class="tutorial-film" aria-label="Recordable scene tutorial">
      <div class="tutorial-film-controls"><button
          type="button"
          {{on "click" this.play}}
        >Play scene</button>
        <button type="button" {{on "click" this.pause}}>Pause scene</button>
        <label>Seek (seconds)
          <input
            type="range"
            min="0"
            max="6"
            step="0.1"
            value={{this.requested}}
            {{on "input" this.seek}}
          /></label></div>
      <div class="tutorial-film-frame" data-tutorial-film {{this.expose}}>
        <h2>A scene is a function of time.</h2>
        <p>One cast. One score. Any frame.</p>
        <Choreo as |c|>
          <div class="tutorial-film-stage" {{this.bind c}}>
            <div
              class="tutorial-film-dot"
              {{motion id="dot" style=(styles borderRadius="50%")}}
            ></div>
          </div>
          {{#if this.armed}}
            <c.Parallel>
              <c.Tween
                @of={{c.id "dot"}}
                @x={{this.positions}}
                @times={{this.times}}
                @duration={{6}}
                @ease="linear"
              />
              <c.Tween
                @of={{c.id "dot"}}
                @scale={{this.scales}}
                @times={{this.times}}
                @duration={{6}}
                @ease="linear"
              />
            </c.Parallel>
          {{/if}}
        </Choreo>
        <small>CHOREO / A SIX-SECOND STUDY</small>
      </div>
      <style>
        .tutorial-film {
          font: 16px/1.5 system-ui;
          color: #f3eadf;
          color-scheme: dark;
          box-shadow: 0 0 0 1px #514337;
          border-radius: 12px 12px 0 0;
        }
        .tutorial-film-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: #302820;
          border-radius: 12px 12px 0 0;
          border-bottom: 1px solid #514337;
        }
        .tutorial-film-controls button {
          appearance: none;
          font: 500 13px/1.2 system-ui;
          color: #f3eadf;
          background: #44382e;
          border: 1px solid #79614e;
          border-radius: 7px;
          min-height: 36px;
          padding: 8px 12px;
          cursor: pointer;
        }
        .tutorial-film-controls button:hover {
          background: #584536;
          border-color: #e89866;
        }
        .tutorial-film-controls button:active {
          background: #302820;
        }
        .tutorial-film-controls button:focus-visible,
        .tutorial-film-controls input:focus-visible {
          outline: 2px solid #ff9b65;
          outline-offset: 3px;
        }
        .tutorial-film-controls label {
          display: flex;
          align-items: center;
          flex: 1 1 200px;
          gap: 10px;
          margin: 0;
          padding: 0 4px;
          font: 500 13px/1.2 system-ui;
          color: #d9c8b8;
        }
        .tutorial-film-controls input[type="range"] {
          flex: 1;
          min-width: 80px;
          width: 100%;
          height: 24px;
          margin: 0;
          accent-color: #ff8755;
          cursor: pointer;
        }
        @media (pointer: coarse) {
          .tutorial-film-controls button {
            min-height: 44px;
          }
          .tutorial-film-controls input[type="range"] {
            height: 44px;
          }
        }
        .tutorial-film-frame {
          width: 100%;
          aspect-ratio: 16 / 9;
          position: relative;
          overflow: hidden;
          background: #241e19;
          container-type: inline-size;
        }
        .tutorial-film-frame h2 {
          margin: 0;
          position: absolute;
          left: 8%;
          top: 12%;
          font-size: 4.4cqw;
        }
        .tutorial-film-frame p {
          position: absolute;
          left: 8%;
          top: 25%;
          font-size: 2.3cqw;
        }
        .tutorial-film-stage {
          position: relative;
          height: 56.25cqw;
          width: 100%;
        }
        .tutorial-film-dot {
          position: absolute;
          left: 12%;
          top: 52%;
          width: 8cqw;
          height: 8cqw;
          background: #ff6a3a;
        }
        .tutorial-film-frame small {
          position: absolute;
          bottom: 8%;
          left: 8%;
          font-size: 1.6cqw;
          letter-spacing: 0.12em;
        }
      </style>
    </section>
  </template>
}
