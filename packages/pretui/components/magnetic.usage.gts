// Pretui — Magnetic usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Magnetic } from './magnetic';
import {
  SUPPLIERS,
  pick,
  seedFrom,
} from '../examples';

// ── Magnetic ─────────────────────────────────────────────────────────────
class MagneticUsage extends Component {
  @tracked range = 56;
  @tracked intensity = 0.35;
  @tracked halo = true;
  @tracked hue = '';
  setRange = (v: number | null) => (this.range = v ?? 56);
  setIntensity = (v: number | null) => (this.intensity = v ?? 0.35);
  setHalo = (v: boolean) => (this.halo = v);
  setHue = (v: string) => (this.hue = v);
  get supplier() {
    return pick(seedFrom('magnetic'), 0, SUPPLIERS);
  }
  get usage() {
    let bits = [
      `@range={{${this.range}}}`,
      `@intensity={{${this.intensity}}}`,
    ];
    if (!this.halo) bits.push('@halo={{false}}');
    if (this.hue) bits.push(`@hue='${this.hue}'`);
    return `<Magnetic ${bits.join(' ')}>\n  <Button>Confirm booking</Button>\n</Magnetic>`;
  }
  <template>
    <FreestyleUsage
      @name='Magnetic'
      @description='A control that leans toward an approaching pointer. Upstream (motion-primitives Magnetic, react-bits Magnet) attaches a document-level mousemove and springs the element by an invisible px range — nothing on screen says where the pull starts, and a still frame is just the button. Here the range is real layout: the wrapper reserves it as padding, so one local listener replaces the global one AND the reach zone can be drawn. That halo is both the resting state and the Law 5 encoding — it is a picture of the control’s true enlarged hit area, and it brightens with proximity, so affinity is legible before anything moves. Touch gets the halo but no lean (pulling a control out from under a fingertip is only ever a miss); focusing the control lights the halo to full. Dropped from upstream: actionArea (self/parent/global) and springOptions — the padded zone IS the action area, and a CSS transition is critically damped, so there is no wobble to tune. Honest limit: the range occupies real layout space, so a magnetic control needs room around it.'
      @source={{this.usage}}
    >
      <:example>
        <div class='mag-stage'>
          <Magnetic
            @range={{this.range}}
            @intensity={{this.intensity}}
            @halo={{this.halo}}
            @hue={{this.hue}}
          >
            <Button @size='m'>Confirm booking</Button>
          </Magnetic>
          <p class='mag-note'>{{this.supplier}}
            · spring allocation closes Friday</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='range'
          @defaultValue={{56}}
          @value={{this.range}}
          @min={{0}}
          @max={{140}}
          @step={{4}}
          @description='Reach in px, reserved as real padding around the control. This is the extra hit area the halo draws.'
          @onInput={{this.setRange}}
        />
        <Args.Number
          @name='intensity'
          @defaultValue={{0.35}}
          @value={{this.intensity}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='How far the control leans, as a fraction of the falloff-scaled pointer offset. Above ~0.6 the control outruns the pointer and reads as slippery.'
          @onInput={{this.setIntensity}}
        />
        <Args.Bool
          @name='halo'
          @defaultValue={{true}}
          @value={{this.halo}}
          @description='Draw the reach zone. Turning it off makes the component invisible in a still frame (the exact failure Law 8 names) — do it only when a neighbouring affordance already shows the target.'
          @onInput={{this.setHalo}}
        />
        <Args.String
          @name='hue'
          @value={{this.hue}}
          @description='Any CSS color for the halo. Empty falls back to the --primary token.'
          @onInput={{this.setHue}}
        />
        <Args.Yield
          @name='default'
          @description='The magnetized control. It keeps all of its own events — the halo is pointer-events: none and aria-hidden, and nothing is layered over the control.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-magnetic-halo-radius'
          @type='length'
          @description='Corner radius of the reach halo — default 999px (a pill). Set it to match a rectangular control.'
        />
        <Css.Basic
          @name='pretui-magnetic-range'
          @type='length'
          @description='Same channel @range writes to, for setting the reach from a stylesheet.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .mag-stage {
        display: grid;
        justify-items: center;
        gap: 4px;
        padding: 8px;
      }
      .mag-note {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_MAGNETIC: Record<string, unknown> = {
  Magnetic: MagneticUsage,
};
