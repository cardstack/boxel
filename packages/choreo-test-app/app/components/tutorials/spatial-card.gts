import { type Camera3DState, Choreo } from '@cardstack/choreo';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

/** A CSS-only host. No WebGL renderer, assets, or private gallery helpers. */
export class SpatialCard extends Component {
  @tracked angled = false;
  @tracked yaw = 32;
  @tracked count = 0;
  camera: Camera3DState = { dolly: 1, yaw: 0, pitch: 0, x: 0, y: 0 };
  @tracked pose: Camera3DState = { dolly: 1, yaw: 0, pitch: 0, x: 0, y: 0 };
  turn = () => {
    this.angled = !this.angled;
  };
  increment = () => {
    this.count++;
  };
  tune = (event: Event) => {
    this.yaw = Number((event.target as HTMLInputElement).value);
  };
  receive = (pose: Camera3DState) => {
    this.pose = pose;
  };
  get targetYaw() {
    return this.angled ? this.yaw : 0;
  }
  get plane() {
    const { yaw, pitch, dolly } = this.pose;
    return htmlSafe(
      `transform: rotateX(${-pitch}deg) rotateY(${-yaw}deg) scale(${1 / dolly});`
    );
  }
  <template>
    <section class="tutorial-spatial" aria-label="Spatial card tutorial">
      <h2>One plane, one camera</h2>
      <button type="button" {{on "click" this.turn}}>Toggle perspective</button>
      <label>Yaw (degrees)
        <input
          type="range"
          min="-55"
          max="55"
          step="1"
          value={{this.yaw}}
          {{on "input" this.tune}}
        />
        {{this.yaw}}</label>
      <Choreo @camera3dFrom={{this.camera}} @onCamera3D={{this.receive}} as |c|>
        <div class="tutorial-perspective" {{motion id="stage"}}>
          <article class="tutorial-plane" style={{this.plane}}>
            <p>Real HTML in space</p><h3>Keep the interface live</h3>
            <button type="button" {{on "click" this.increment}}>Count:
              {{this.count}}</button>
          </article>
        </div>
        <c.Camera3D
          @yaw={{this.targetYaw}}
          @pitch={{if this.angled 12 0}}
          @duration={{0.7}}
        />
      </Choreo>
      <style>
        .tutorial-spatial {
          background: #201c19;
          color: #f2ebe4;
          padding: 24px;
          border-radius: 16px;
          font: 16px/1.5 system-ui;
        }
        .tutorial-spatial button {
          border: 1px solid #a78d78;
          border-radius: 8px;
          padding: 10px 16px;
          background: #41352c;
          color: #fff5e8;
          cursor: pointer;
        }
        .tutorial-spatial label {
          display: block;
          margin-top: 12px;
        }
        .tutorial-perspective {
          display: grid;
          place-items: center;
          perspective: 800px;
          min-height: 300px;
        }
        .tutorial-plane {
          width: min(300px, 80%);
          padding: 24px;
          background: #3b3029;
          border: 1px solid #ef9163;
          border-radius: 16px;
          transform-origin: center;
        }
      </style>
    </section>
  </template>
}
