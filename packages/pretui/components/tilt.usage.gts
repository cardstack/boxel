// Pretui — Tilt usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Tilt } from './tilt';
import {
  PLACES,
  SUPPLIERS,
  TEAS,
  pick,
  seedFrom,
} from '../examples';

// ── Tilt ─────────────────────────────────────────────────────────────────
class TiltUsage extends Component {
  @tracked max = 8;
  @tracked reverse = false;
  @tracked perspective = 900;
  @tracked glare = true;
  @tracked plate = true;
  @tracked press = true;
  setMax = (v: number | null) => (this.max = v ?? 8);
  setReverse = (v: boolean) => (this.reverse = v);
  setPerspective = (v: number | null) => (this.perspective = v ?? 900);
  setGlare = (v: boolean) => (this.glare = v);
  setPlate = (v: boolean) => (this.plate = v);
  setPress = (v: boolean) => (this.press = v);
  get tea() {
    return pick(seedFrom('tilt'), 0, TEAS);
  }
  get place() {
    return pick(seedFrom('tilt'), 3, PLACES);
  }
  get supplier() {
    return pick(seedFrom('tilt'), 5, SUPPLIERS);
  }
  get usage() {
    let bits = [`@max={{${this.max}}}`];
    if (this.reverse) bits.push('@reverse={{true}}');
    if (this.perspective !== 900) {
      bits.push(`@perspective={{${this.perspective}}}`);
    }
    if (!this.glare) bits.push('@glare={{false}}');
    if (!this.plate) bits.push('@plate={{false}}');
    if (!this.press) bits.push('@press={{false}}');
    return `<Tilt ${bits.join(' ')}>\n  … card content …\n</Tilt>`;
  }
  <template>
    <FreestyleUsage
      @name='Tilt'
      @description='A perspective tilt tracking the hover position, ported from motion-primitives Tilt. Stated plainly, because Law 8 names this component as the canonical cut: AN IDLE TILT ENCODES NOTHING. It is decoration. It ships because five reference kits converged on it, and it earns its place on exactly two grounds, both real in a still frame — @plate makes the tilted thing an actual Pretui surface (card radius, --pretui-shadow-card at rest lifting to --pretui-shadow-raised on engage), so the screenshot shows an elevated card with the tilt as garnish; and @press tips the plate toward the ACTUAL press point and sinks it, which does encode a state transition (pressed, and here). If you keep one behavior of this component, keep @press. Improvements on upstream besides those: default max is 8° rather than a toy-like 15°, coarse pointers get no rotation (a tilt under a fingertip is invisible and reads as drift), focus flattens the plate so a focused control is never read at an angle, and reduced motion removes the rotation entirely — this is the most vestibular of the four — leaving the flat elevated plate as the end state.'
      @source={{this.usage}}
    >
      <:example>
        <Tilt
          @max={{this.max}}
          @reverse={{this.reverse}}
          @perspective={{this.perspective}}
          @glare={{this.glare}}
          @plate={{this.plate}}
          @press={{this.press}}
        >
          <div class='tilt-card'>
            <p class='tilt-eyebrow'>{{this.supplier}}</p>
            <h4 class='tilt-title'>{{this.tea}}</h4>
            <p class='tilt-meta'>{{this.place}}
              · 240 kg · arrives week 14</p>
            <Button @size='xs' @appearance='outlined'>Open lot</Button>
          </div>
        </Tilt>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='max'
          @defaultValue={{8}}
          @value={{this.max}}
          @min={{0}}
          @max={{20}}
          @step={{1}}
          @description='Maximum rotation in degrees at the corners. Upstream defaults to 15, which reads as a toy; 8 reads as a surface.'
          @onInput={{this.setMax}}
        />
        <Args.Bool
          @name='reverse'
          @defaultValue={{false}}
          @value={{this.reverse}}
          @description='Invert the rotation so the surface leans away from the pointer instead of toward it.'
          @onInput={{this.setReverse}}
        />
        <Args.Number
          @name='perspective'
          @defaultValue={{900}}
          @value={{this.perspective}}
          @min={{300}}
          @max={{2000}}
          @step={{50}}
          @description='Perspective depth in px — larger is flatter. Below ~500 the same max angle becomes cartoonish.'
          @onInput={{this.setPerspective}}
        />
        <Args.Bool
          @name='glare'
          @defaultValue={{true}}
          @value={{this.glare}}
          @description='The moving specular sheen. Chrome only (Law 6) — it never carries information and is aria-hidden.'
          @onInput={{this.setGlare}}
        />
        <Args.Bool
          @name='plate'
          @defaultValue={{true}}
          @value={{this.plate}}
          @description='Give the tilted thing a real Pretui card surface — radius plus elevation that lifts on engage. This is the resting state; with it off the component is invisible in a still frame and is pure decoration.'
          @onInput={{this.setPlate}}
        />
        <Args.Bool
          @name='press'
          @defaultValue={{true}}
          @value={{this.press}}
          @description='Tip toward and sink at the press point on pointerdown. The one part of Tilt that encodes a state transition — it survives on touch, where the rotation does not.'
          @onInput={{this.setPress}}
        />
        <Args.Yield
          @name='default'
          @description='The tilted content, rendered inside the plate. It keeps its own events; the glare layer is pointer-events: none and aria-hidden.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-tilt-surface'
          @type='color'
          @description='Plate surface color when @plate is on — defaults to the --card token.'
        />
        <Css.Basic
          @name='pretui-tilt-radius'
          @type='length'
          @description='Plate corner radius — defaults to the --radius token.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .tilt-card {
        width: 240px;
        padding: 16px;
        display: grid;
        gap: 6px;
        justify-items: start;
      }
      .tilt-eyebrow {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground);
      }
      .tilt-title {
        margin: 0;
        font-size: var(--text-heading-sm, 15px);
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--card-foreground);
      }
      .tilt-meta {
        margin: 0 0 6px;
        font-size: var(--text-ui-md, 12.5px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TILT: Record<string, unknown> = {
  Tilt: TiltUsage,
};
