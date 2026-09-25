// Pretui — SlidingHighlight usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { FreestyleUsage } from '../freestyle';
import { TASKS } from '../examples';
import { SlidingHighlight, slidingHighlight } from './sliding-highlight';

// ── SlidingHighlight — fresh page (no upstream knob rig) ─────────────────
class SlidingHighlightUsage extends Component {
  @tracked variant: 'pill' | 'underline' | 'soft' | 'outline' = 'pill';
  @tracked duration = 0.18;
  @tracked thickness = 2;
  @tracked active = TASKS[0] as string;
  setVariant = (v: string) =>
    (this.variant = v as 'pill' | 'underline' | 'soft' | 'outline');
  setDuration = (v: number | null) => (this.duration = v ?? 0.18);
  setThickness = (v: number | null) => (this.thickness = v ?? 2);
  select = (value: string) => (this.active = value);
  isActive = (value: string) => this.active === value;
  get options(): string[] {
    return ['Booking', 'Cupping', 'Curing', 'Customs'];
  }
  get usage() {
    return [
      `<div role='tablist' {{slidingHighlight}}>`,
      `  <SlidingHighlight @variant='${this.variant}' @duration={{${this.duration}}} />`,
      `  {{#each this.options as |o|}}`,
      `    <button role='tab' aria-selected={{...}}>{{o}}</button>`,
      `  {{/each}}`,
      `</div>`,
    ].join('\n');
  }
  <template>
    <FreestyleUsage
      @name='SlidingHighlight'
      @description="Law 5's travelling selection indicator: one absolutely-positioned element whose translate and size follow the active item, so the selection travels instead of cross-fading — the reader sees where it came from. It ships as two halves so any existing control can adopt it without surrendering its DOM: the slidingHighlight modifier on the item container measures and publishes --pretui-highlight-x/y/w/h, and <SlidingHighlight /> inside reads them. The modifier needs no arguments — a MutationObserver watches data-state / aria-selected / aria-current, so it stays correct whoever drives the selection. The first paint lands in place rather than sliding in from the corner, and reduced motion parks it on the active item instantly."
      @source={{this.usage}}
    >
      <:example>
        <div class='sh-stage'>
          <div class='sh-tabs' role='tablist' {{slidingHighlight}}>
            <SlidingHighlight
              @variant={{this.variant}}
              @duration={{this.duration}}
              @thickness={{this.thickness}}
            />
            {{#each this.options as |option|}}
              <button
                type='button'
                role='tab'
                class='sh-tab'
                aria-selected={{if (this.isActive option) 'true' 'false'}}
                {{on 'click' (fn this.select option)}}
              >{{option}}</button>
            {{/each}}
          </div>
          <p class='sh-note'>Selected stage:
            <strong>{{this.active}}</strong></p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='variant'
          @defaultValue='pill'
          @value={{this.variant}}
          @options={{array 'pill' 'underline' 'soft' 'outline'}}
          @description='pill is a raised card face behind the label (SegmentedControl); underline is a bar riding the bottom edge of the item box (Tabs); soft is an accent tint; outline is a ring only.'
          @onInput={{this.setVariant}}
        />
        <Args.Number
          @name='duration'
          @defaultValue={{0.18}}
          @value={{this.duration}}
          @min={{0.05}}
          @max={{1}}
          @step={{0.02}}
          @description='Travel duration in seconds. Defaults to the kit-wide --pretui-dur-snap.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='thickness'
          @defaultValue={{2}}
          @value={{this.thickness}}
          @min={{1}}
          @max={{8}}
          @step={{1}}
          @description='Bar thickness in px — the underline variant only.'
          @onInput={{this.setThickness}}
        />
        <Args.Base
          @name='radius'
          @type='Number'
          @defaultValue='var(--radius)'
          @description='Corner radius in px. Left unset it follows the control radius, or 1px under the underline variant. Documented rather than knob-driven — the preset radii are the intended path.'
        />
        <Args.Yield
          @name='default'
          @description='Optional slot for painting the indicator yourself — a gradient, a texture — while keeping the travel. Empty by default.'
        />
        <Args.Action
          @name='slidingHighlight (modifier)'
          @description="Install on the item container. Optional first positional argument is a custom active-item selector; the default matches [data-state='active'], [aria-selected='true'] and [aria-current]. The container is given position: relative if it is still static. ResizeObserver and MutationObserver both disconnect on teardown."
        />
        <Args.Base
          @name='--pretui-highlight-duration'
          @type='CSS'
          @defaultValue='var(--pretui-dur-snap, 180ms)'
          @description='Travel duration; @duration sets it.'
        />
        <Args.Base
          @name='--pretui-highlight-ease'
          @type='CSS'
          @defaultValue='var(--pretui-ease-snap)'
          @description='Travel easing.'
        />
        <Args.Base
          @name='--pretui-highlight-thickness'
          @type='CSS'
          @defaultValue='2px'
          @description='Underline bar thickness; @thickness sets it.'
        />
        <Args.Base
          @name='--pretui-highlight-radius'
          @type='CSS'
          @defaultValue='var(--radius)'
          @description='Indicator corner radius.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .sh-stage {
        display: grid;
        gap: var(--space-4, 11px);
        justify-items: start;
      }
      .sh-tabs {
        position: relative;
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        border-radius: calc(var(--radius) + 2px);
        background: var(--muted);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .sh-tab {
        position: relative;
        z-index: 1;
        height: 26px;
        padding: 0 12px;
        border: 0;
        background: none;
        border-radius: var(--radius);
        font-family: inherit;
        font-size: var(--text-ui, 12px);
        font-weight: 500;
        color: var(--muted-foreground);
        cursor: pointer;
        transition: color var(--pretui-dur-snap, 180ms)
          var(--pretui-ease-snap, ease);
      }
      .sh-tab[aria-selected='true'] {
        color: var(--foreground);
      }
      .sh-tab:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .sh-note {
        margin: 0;
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SLIDING_HIGHLIGHT: Record<string, unknown> = {
  SlidingHighlight: SlidingHighlightUsage,
};
