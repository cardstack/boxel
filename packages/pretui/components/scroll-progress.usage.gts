// Pretui — ScrollProgress usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { array } from '@ember/helper';
import { FreestyleUsage } from '../freestyle';
import { TASKS } from '../examples';
import { ScrollProgress } from './scroll-progress';

// ── ScrollProgress — fresh page (no upstream knob rig) ───────────────────
class ScrollProgressUsage extends Component {
  @tracked thickness = 3;
  @tracked track = true;
  @tracked affix: 'none' | 'top' | 'bottom' = 'top';
  @tracked announce = false;
  @tracked label = 'Harvest ledger read progress';
  setThickness = (v: number | null) => (this.thickness = v ?? 3);
  setTrack = (v: boolean) => (this.track = v);
  setAffix = (v: string) => (this.affix = v as 'none' | 'top' | 'bottom');
  setAnnounce = (v: boolean) => (this.announce = v);
  setLabel = (v: string) => (this.label = v);
  get paragraphs(): string[] {
    return TASKS.slice(0, 10) as string[];
  }
  get usage() {
    let bits = [
      `@source='nearest'`,
      `@affix='${this.affix}'`,
      `@thickness={{${this.thickness}}}`,
    ];
    if (!this.track) bits.push('@track={{false}}');
    if (this.announce) bits.push(`@announce={{true}} @label='${this.label}'`);
    return `<ScrollProgress ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='ScrollProgress'
      @description="Reading-progress ribbon bound to scroll position. The default path is a pure CSS scroll-driven animation (animation-timeline: scroll()), which runs off the main thread — no scroll listener, no frame loop, nothing to jank. Where scroll timelines are unavailable, a passive scroll listener in a modifier writes the same custom property, so one set of styles serves both paths. It is aria-hidden by default on purpose: the scroll container already reports position to assistive tech, and a second unlabelled progressbar is noise — pass @announce with @label when the ribbon is genuinely the primary readout."
      @source={{this.usage}}
    >
      <:example>
        <div class='sp-scroller'>
          <ScrollProgress
            @source='nearest'
            @affix={{this.affix}}
            @thickness={{this.thickness}}
            @track={{this.track}}
            @announce={{this.announce}}
            @label={{this.label}}
          />
          <h4 class='sp-title'>Harvest ledger — spring season</h4>
          {{#each this.paragraphs as |task|}}
            <p class='sp-para'>{{task}} before the Wuyishan curing room reopens.
              The cupping panel wants the scorecards filed alongside the
              humidity logs, and the customs paperwork trails the shipment by a
              week.</p>
          {{/each}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='source'
          @defaultValue='page'
          @options={{array 'page' 'nearest'}}
          @description="'page' tracks the document (scroll(root block)); 'nearest' tracks the closest scrolling ancestor, in which case the ribbon must live inside that scroller. Fixed to 'nearest' in this example so the effect is visible inside the workbench."
        />
        <Args.String
          @name='affix'
          @defaultValue='none'
          @value={{this.affix}}
          @options={{array 'none' 'top' 'bottom'}}
          @description="'none' leaves placement to the caller; 'top' / 'bottom' stick the ribbon to that edge of its scroll container."
          @onInput={{this.setAffix}}
        />
        <Args.Number
          @name='thickness'
          @defaultValue={{3}}
          @value={{this.thickness}}
          @min={{1}}
          @max={{16}}
          @step={{1}}
          @description='Ribbon thickness in px.'
          @onInput={{this.setThickness}}
        />
        <Args.Bool
          @name='track'
          @defaultValue={{true}}
          @value={{this.track}}
          @description='Show the unfilled remainder. This is what gives the component a defensible resting appearance at scroll position zero (Law 8) — turn it off only where another surface supplies the groove.'
          @onInput={{this.setTrack}}
        />
        <Args.Bool
          @name='announce'
          @defaultValue={{false}}
          @value={{this.announce}}
          @description='Expose the ribbon as role=progressbar with a live aria-valuenow. Off by default (see the description). Turning it on forces the scroll-listener path, because a CSS scroll timeline is not observable from script.'
          @onInput={{this.setAnnounce}}
        />
        <Args.String
          @name='label'
          @defaultValue=''
          @value={{this.label}}
          @description='Accessible name. Required whenever @announce is true; ignored otherwise.'
          @onInput={{this.setLabel}}
        />
        <Args.Base
          @name='--pretui-scrollprogress-fill'
          @type='CSS'
          @defaultValue='var(--primary)'
          @description='Colour of the filled portion.'
        />
        <Args.Base
          @name='--pretui-scrollprogress-track'
          @type='CSS'
          @defaultValue='foreground at 10%'
          @description='Colour of the unfilled groove.'
        />
        <Args.Base
          @name='--pretui-scrollprogress-thickness'
          @type='CSS'
          @defaultValue='3px'
          @description='Ribbon thickness; @thickness sets it.'
        />
        <Args.Base
          @name='--pretui-scrollprogress-radius'
          @type='CSS'
          @defaultValue='999px'
          @description='Ribbon corner radius — set 0 for a square-ended rule.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .sp-scroller {
        height: 240px;
        overflow-y: auto;
        padding: 0 var(--space-4, 11px) var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .sp-title {
        margin: var(--space-4, 11px) 0 var(--space-3, 8px);
        font-size: var(--text-ui-lg, 15px);
        font-weight: 600;
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
      .sp-para {
        margin: 0 0 var(--space-4, 11px);
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SCROLL_PROGRESS: Record<string, unknown> = {
  ScrollProgress: ScrollProgressUsage,
};
