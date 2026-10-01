// Pretui — Handle usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Handle } from './handle';
import { dragsSurface } from '../internal/design-tools';
import type { SurfaceFrame } from '../internal/design-tools';

// ── Handle ───────────────────────────────────────────────────────────────
const SHAPES = ['point', 'bar', 'square'];

class HandleUsage extends Component {
  shapeOptions = SHAPES;
  @tracked shape = 'point';
  @tracked x = 50;
  @tracked y = 50;
  @tracked hitArea = 8;
  @tracked selected = false;
  @tracked disabled = false;

  setShape = (v: string) => (this.shape = v);
  setHitArea = (v: number) => (this.hitArea = v);
  setSelected = (v: boolean) => (this.selected = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  get shapeVal() {
    return this.shape as 'point' | 'bar' | 'square';
  }
  get valueText() {
    return Math.round(this.x) + '%, ' + Math.round(this.y) + '%';
  }
  onDrag = (part: SurfaceFrame) => {
    if (this.disabled) {
      return;
    }
    this.x = part.nx * 100;
    this.y = part.ny * 100;
  };
  nudge = (dx: number, dy: number) => {
    if (dx === -Infinity) {
      this.x = 0;
      return;
    }
    if (dx === Infinity) {
      this.x = 100;
      return;
    }
    this.x = Math.min(100, Math.max(0, this.x + dx));
    this.y = Math.min(100, Math.max(0, this.y + dy));
  };
  get usage() {
    return (
      '<div class="surface" {{dragsSurface this.onDrag}}>\n' +
      '  <Handle @x={{this.x}} @y={{this.y}} @label="Origin" @valueText={{this.valueText}} @onNudge={{this.nudge}} />\n' +
      '</div>'
    );
  }
  <template>
    <FreestyleUsage
      @name='Handle'
      @description='A draggable grip on a 2D surface — a real <button>, so it is focusable, named and activatable, with arrow-key movement carrying the same Shift/Alt multipliers as every other gesture in the territory. It does NOT own the drag: the surface does, via the dragsSurface modifier, which is what lets a surface with six stops keep one listener set and lets a handle dragged past the edge keep tracking. Ported from figui3 fig-handle; its hit-area idea is kept and simplified to one number.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-handle-demo'>
          <div
            class='pretui-handle-surface'
            {{dragsSurface this.onDrag this.disabled}}
          >
            <Handle
              @x={{this.x}}
              @y={{this.y}}
              @shape={{this.shapeVal}}
              @hitArea={{this.hitArea}}
              @selected={{this.selected}}
              @disabled={{this.disabled}}
              @label='Origin'
              @valueText={{this.valueText}}
              @onNudge={{this.nudge}}
            />
          </div>
          <p class='pretui-demo-readout' data-test-handle-readout>
            {{this.valueText}}
          </p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='x'
          @description='Horizontal position within the surface, 0–100 (percent). Clamped through Math before it reaches the inline style.'
        />
        <Args.Number
          @name='y'
          @description='Vertical position, 0–100.'
        />
        <Args.String
          @name='shape'
          @defaultValue='point'
          @value={{this.shape}}
          @options={{this.shapeOptions}}
          @description="'point' is the round dot; 'bar' is the vertical stop marker a gradient bar uses; 'square' is a resize grip."
          @onInput={{this.setShape}}
        />
        <Args.Number
          @name='hitArea'
          @defaultValue={{6}}
          @value={{this.hitArea}}
          @min={{0}}
          @max={{24}}
          @description='Invisible px added on every side. An 11px dot is an 11px target without it; a coarse pointer always gets 16px regardless.'
          @onInput={{this.setHitArea}}
        />
        <Args.Bool
          @name='selected'
          @defaultValue={{false}}
          @value={{this.selected}}
          @description='Selected state, carried on aria-pressed as well as the fill.'
          @onInput={{this.setSelected}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='label'
          @description='REQUIRED accessible name — “Start point”, “Stop 2”, “Origin”.'
        />
        <Args.String
          @name='valueText'
          @description='Current position, folded into the accessible name (a button has no aria-valuetext).'
        />
        <Args.Number
          @name='index'
          @description='Identity a parent surface reads off SurfaceFrame.origin to know which handle a drag grabbed.'
        />
        <Args.Action
          @name='onNudge'
          @description='Arrow keys. Receives (dx, dy, modifiers) in percent, already multiplied; ±Infinity dx means Home/End.'
        />
        <Args.Action
          @name='onActivate'
          @description='Enter/Space, and a click that did not become a drag.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-handle-demo {
        max-width: 220px;
      }
      .pretui-handle-surface {
        position: relative;
        width: 100%;
        aspect-ratio: 1 / 1;
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        box-shadow: inset 0 0 0 1px var(--border);
        touch-action: none;
      }
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export const DEMOS_HANDLE: Record<string, unknown> = {
  Handle: HandleUsage,
};
