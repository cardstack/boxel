// Pretui — InView usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import {
  AMOUNTS,
  PLACES,
  SUPPLIERS,
  TEAS,
} from '../examples';
import { InView, normalizeRootMargin } from './in-view';
import type { MotionPreset } from '../internal/motion-core';
import { PRESETS } from '../demo-motion-core';

// ── InView — fresh page (no upstream knob rig) ───────────────────────────
interface Lot {
  tea: string;
  place: string;
  supplier: string;
  amount: string;
}

function lots(count: number): Lot[] {
  let out: Lot[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      tea: TEAS[i % TEAS.length] as string,
      place: PLACES[i % PLACES.length] as string,
      supplier: SUPPLIERS[i % SUPPLIERS.length] as string,
      amount: AMOUNTS[i % AMOUNTS.length] as string,
    });
  }
  return out;
}

class InViewUsage extends Component {
  @tracked enter: MotionPreset = 'rise';
  @tracked once = true;
  @tracked threshold = 0.2;
  @tracked rootMargin = '0px';
  @tracked stagger = 0.06;
  @tracked duration = 0.48;
  @tracked distance = 14;
  @tracked run = 0;
  setEnter = (v: string) => (this.enter = v as MotionPreset);
  setOnce = (v: boolean) => (this.once = v);
  setThreshold = (v: number | null) => (this.threshold = v ?? 0.2);
  setRootMargin = (v: string) => (this.rootMargin = normalizeRootMargin(v));
  setStagger = (v: number | null) => (this.stagger = v ?? 0.06);
  setDuration = (v: number | null) => (this.duration = v ?? 0.48);
  setDistance = (v: number | null) => (this.distance = v ?? 14);
  replay = () => (this.run = this.run + 1);
  get runKey(): number[] {
    return [this.run];
  }
  get lots(): Lot[] {
    return lots(8);
  }
  get usage() {
    let bits = [
      `@items={{this.lots}}`,
      `@enter='${this.enter}'`,
      `@stagger={{${this.stagger}}}`,
      `@duration={{${this.duration}}}`,
      `@threshold={{${this.threshold}}}`,
    ];
    if (!this.once) bits.push('@once={{false}}');
    if (this.rootMargin !== '0px') bits.push(`@rootMargin='${this.rootMargin}'`);
    return `<InView ${bits.join(' ')}>\n  <:item as |lot|>{{lot.tea}}</:item>\n</InView>`;
  }
  <template>
    <FreestyleUsage
      @name='InView'
      @description='Entrance choreography that fires when content scrolls into view. An IntersectionObserver inside a modifier flips one attribute; the reveal itself is a CSS transition, and the stagger is a precomputed index × interval delay — no engine, no timers, one style recalc for the whole list. The resting style is the finished state, so a still frame, a prerender or a JavaScript-free render all show real content rather than a blank box. Scroll the panel below to trip it.'
      @source={{this.usage}}
    >
      <:example>
        <div class='inview-stage'>
          <div class='inview-scroller'>
            <p class='inview-hint'>Scroll down — the ledger reveals as it
              enters.</p>
            {{#each this.runKey key='@identity' as |run|}}
              <InView
                @items={{this.lots}}
                @enter={{this.enter}}
                @once={{this.once}}
                @threshold={{this.threshold}}
                @rootMargin={{this.rootMargin}}
                @stagger={{this.stagger}}
                @duration={{this.duration}}
                @distance={{this.distance}}
                class='inview-list'
                data-run={{run}}
              >
                <:item as |lot|>
                  <div class='inview-row'>
                    <span class='inview-tea'>{{lot.tea}}</span>
                    <span class='inview-meta'>{{lot.supplier}}</span>
                    <span class='inview-amount'>{{lot.amount}}</span>
                  </div>
                </:item>
              </InView>
            {{/each}}
          </div>
          <div class='inview-replay'>
            <Button
              @size='xs'
              @appearance='outlined'
              {{on 'click' this.replay}}
            >Replay</Button>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='enter'
          @defaultValue='fade'
          @value={{this.enter}}
          @options={{PRESETS}}
          @description='Entrance preset, shared vocabulary with Presence: fade, rise, fall, scale, slide.'
          @onInput={{this.setEnter}}
        />
        <Args.Bool
          @name='once'
          @defaultValue={{true}}
          @value={{this.once}}
          @description='Reveal once and disconnect the observer (the default, and the honest reading of an entrance). false re-hides on the way out, so the reveal replays each pass.'
          @onInput={{this.setOnce}}
        />
        <Args.Number
          @name='threshold'
          @defaultValue={{0.2}}
          @value={{this.threshold}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='IntersectionObserver threshold: the fraction of the block that must be visible before it trips.'
          @onInput={{this.setThreshold}}
        />
        <Args.String
          @name='rootMargin'
          @defaultValue='0px'
          @value={{this.rootMargin}}
          @description="IntersectionObserver rootMargin. '0px 0px -12% 0px' trips a little late, so content settles before it is read."
          @onInput={{this.setRootMargin}}
        />
        <Args.Number
          @name='stagger'
          @defaultValue={{0}}
          @value={{this.stagger}}
          @min={{0}}
          @max={{0.4}}
          @step={{0.01}}
          @description='Seconds between consecutive children. Meaningful only with @items — the delay is precomputed as index × stagger, not sequenced by a timer.'
          @onInput={{this.setStagger}}
        />
        <Args.Number
          @name='duration'
          @defaultValue={{0.48}}
          @value={{this.duration}}
          @min={{0.1}}
          @max={{2}}
          @step={{0.02}}
          @description='Transition duration in seconds, per child.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='distance'
          @defaultValue={{8}}
          @value={{this.distance}}
          @min={{0}}
          @max={{60}}
          @step={{2}}
          @description='Travel in px for rise / fall / slide.'
          @onInput={{this.setDistance}}
        />
        <Args.Object
          @name='items'
          @value={{this.lots}}
          @description='Optional list. With it, each entry renders through the :item block and gets its own staggered delay. Without it, the whole default block reveals as one unit.'
        />
        <Args.Yield
          @name='item'
          @description='Block for one entry, yielded (item, index). Wrapped in a div whose display comes from --pretui-inview-item-display.'
        />
        <Args.Yield
          @name='default'
          @description='Used when @items is absent: the entire block reveals as a single unit.'
        />
        <Args.Base
          @name='--pretui-inview-display'
          @type='CSS'
          @defaultValue='block'
          @description='Display of the observed container — set it to grid or flex to make the container carry the layout.'
        />
        <Args.Base
          @name='--pretui-inview-item-display'
          @type='CSS'
          @defaultValue='block'
          @description='Display of each item wrapper.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .inview-stage {
        display: grid;
        gap: var(--space-4, 11px);
      }
      .inview-scroller {
        height: 220px;
        overflow-y: auto;
        padding: var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .inview-hint {
        margin: 0 0 200px;
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
      }
      /* the documented way to give the observed container a layout role —
         set the knob, don't fight .pretui-inview for the display property */
      .inview-list {
        --pretui-inview-display: grid;
        gap: var(--space-3, 8px);
        padding-bottom: 120px;
      }
      .inview-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px var(--space-4, 11px);
        padding: var(--space-3, 8px) var(--space-4, 11px);
        border-radius: var(--radius);
        background: var(--muted);
      }
      .inview-tea {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--foreground);
      }
      .inview-amount {
        grid-row: span 2;
        align-self: center;
        font-variant-numeric: tabular-nums;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
      }
      .inview-meta {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_IN_VIEW: Record<string, unknown> = {
  InView: InViewUsage,
};
