import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion, styles } from 'glimmer-motion';
import { tuneNumber } from 'test-app/lib/demo-tuning';

const ID = 'circle-loop';
const times = [0, 0.12, 0.28, 0.39, 0.5, 0.63, 0.78, 0.91, 1];
const palette = [
  '#8a81ce',
  '#8bb6ce',
  '#d3af7b',
  '#c778c9',
  '#89cfc8',
  '#8fcea1',
  '#a2b8db',
  '#d4df87',
  '#cf9389',
];
const cluster = [
  [-38, -35, 1.05],
  [-36, 36, 1.3],
  [29, -28, 1.15],
  [15, 65, 0.85],
  [42, 24, 1],
  [3, -70, 0.5],
  [67, -1, 0.62],
  [-68, 0, 0.64],
  [-2, 0, 0.54],
];
function settings() {
  return {
    duration: tuneNumber(ID, 8, 'Cycle duration', 4, 16, 0.1),
    zoom: tuneNumber(ID, 2.8, 'Zoom (×)', 1, 4, 0.1),
    spacing: tuneNumber(ID, 95, 'Grid spacing (px)', 60, 120, 1),
    scatter: tuneNumber(ID, 160, 'Scatter radius (px)', 80, 230, 1),
    haze: tuneNumber(ID, 0.42, 'Field opacity', 0.1, 0.7, 0.01),
  };
}
settings();
export class CircleLoop extends Component {
  @tracked ready = false;
  @tracked reduced = true;
  mount = modifier(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      this.reduced = preference.matches;
    };
    const frame = requestAnimationFrame(() => {
      update();
      this.ready = true;
    });
    preference.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener('change', update);
    };
  });
  times = times;
  get score() {
    const { duration, zoom, spacing, scatter, haze } = settings();
    const circles = Array.from({ length: 45 }, (_, i) => {
      const hero = i < 9;
      const [cx, cy, size] = cluster[i % 9]! as [number, number, number];
      const gx = ((i % 3) - 1) * spacing;
      const gy = (Math.floor((i % 9) / 3) - 1) * spacing;
      const angle = i * 2.399963;
      const radius = scatter * Math.sqrt((i + 1) / 45);
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius;
      const still = this.reduced;
      return {
        id: `circle-${i}`,
        style: styles({
          backgroundColor: palette[i % 9]!,
        }),
        x: still ? times.map(() => cx) : [cx, cx, sx, gx, gx, gx, sx, cx, cx],
        y: still ? times.map(() => cy) : [cy, cy, sy, gy, gy, gy, sy, cy, cy],
        scale: still
          ? times.map(() => (hero ? size : 0.12))
          : hero
            ? [size, size, 0.65, 1.65, 1.65, 1.65, 0.65, size, size]
            : [0.12, 0.12, 0.45, 0.45, 0.45, 0.45, 0.45, 0.12, 0.12],
        opacity: still
          ? times.map(() => (hero ? 1 : 0))
          : hero
            ? [1, 1, 0.7, 1, 1, 1, 0.7, 1, 1]
            : [0, 0, haze, 0, 0, 0, haze, 0, 0],
      };
    });
    return {
      duration: this.reduced ? 0.001 : duration,
      repeat: this.reduced ? 0 : Infinity,
      disc: this.reduced ? times.map(() => 1) : [1, 1, 0, 0, 0, 0, 0, 1, 1],
      circles,
      zoom: this.reduced
        ? times.map(() => 1)
        : [1, 1, zoom, zoom, 1, 1, zoom, 1, 1],
    };
  }
  <template>
    <div
      class="circle-loop-stage"
      data-test-circle-loop
      {{this.mount}}
      aria-label="Circle study: cluster, field, grid, and return"
    >
      {{#let this.score as |score|}}
        <Choreo class="circle-loop-region" as |c|>
          <div class="circle-loop-plane" {{motion id="circle-plane"}}>
            <div class="circle-loop-disc" {{motion id="circle-disc"}}></div>
            {{#each score.circles key="id" as |circle|}}
              <div
                class="circle-loop-dot"
                data-test-circle={{circle.id}}
                {{motion id=circle.id style=circle.style}}
              ></div>
            {{/each}}
          </div>
          {{#if this.ready}}<c.Parallel>
              <c.Tween
                @of={{c.id "circle-disc"}}
                @opacity={{score.disc}}
                @times={{this.times}}
                @duration={{score.duration}}
                @repeat={{score.repeat}}
                @ease="easeInOut"
              />
              <c.Tween
                @of={{c.id "circle-plane"}}
                @scale={{score.zoom}}
                @times={{this.times}}
                @duration={{score.duration}}
                @repeat={{score.repeat}}
                @ease="easeInOut"
              />
              {{#each score.circles key="id" as |circle|}}
                <c.Tween
                  @of={{c.id circle.id}}
                  @x={{circle.x}}
                  @y={{circle.y}}
                  @scale={{circle.scale}}
                  @opacity={{circle.opacity}}
                  @times={{this.times}}
                  @duration={{score.duration}}
                  @repeat={{score.repeat}}
                  @ease="easeInOut"
                />
              {{/each}}
            </c.Parallel>{{/if}}
        </Choreo>
      {{/let}}
      <span class="circle-loop-caption">CLUSTER / FIELD / GRID</span>
    </div>
  </template>
}
