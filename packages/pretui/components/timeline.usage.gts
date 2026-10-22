// Pretui — Timeline usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Timeline } from './timeline';
import type { TimelineEvent } from './timeline';
import { NOW } from '../demo-structure-data';

// ── Timeline ← MUI Timeline / shadcn-community timelines ─────────────────
const NOW_OPTIONS = [
  '2026-04-03T10:00:00Z',
  '2026-05-20T10:00:00Z',
  '2026-08-12T10:00:00Z',
  '2027-01-09T10:00:00Z',
];

// Lot B-1181's life, from booking to the curing room. The events carry
// exactly the four composed pieces the component knows how to place: a
// StatusChip (hue derived from the value), a Token (the machine value), a
// RelativeTime (measured against @now), and an Avatar for the person.
const SHIPMENT: TimelineEvent[] = [
  {
    id: 'booked',
    title: 'Spring lot booked',
    at: '2026-03-14T09:20:00Z',
    status: 'confirmed',
    token: 'B-1181',
    person: 'Mei-Lin Chua',
    icon: 'check',
    body: 'Wuyi Origins confirmed 48 crates of Da Hong Pao against the spring booking. The deposit cleared the same afternoon and the pick window was fixed at two weeks either side of 12 April.',
  },
  {
    id: 'picked',
    title: 'Leaf picked at Wuyishan',
    at: '2026-04-02T23:40:00Z',
    status: 'complete',
    person: 'Ryo Katagiri',
    icon: 'sparkles',
    body: 'Four days early — the estate called the weather and moved. Yield came in at 51 crates, three over the booking, which the desk took at the quoted rate.',
  },
  {
    id: 'cupped',
    title: 'Cupping notes filed',
    at: '2026-04-19T08:05:00Z',
    status: 'approved',
    token: 'score 93',
    person: 'Ingrid Halvorsen',
    icon: 'star',
    body: 'Blind against the selling sample, three cups. Above the ninety band, so the lot goes to the ceremonial menu rather than the house blend.',
  },
  {
    id: 'shipped',
    title: 'Container left Fuzhou',
    at: '2026-05-07T16:00:00Z',
    status: 'in transit',
    token: 'MSKU-4471290',
    icon: 'send',
    body: 'Sea freight, paperwork sent ahead of the vessel with the cupping certificate attached.',
  },
  {
    id: 'held',
    title: 'Held for customs paperwork',
    at: '2026-06-11T11:30:00Z',
    status: 'blocked',
    person: 'Yusuf Demirci',
    icon: 'triangle-alert',
    body: 'Phytosanitary certificate named the cultivar but not the estate. Re-issued and cleared in nine days.',
  },
  {
    id: 'received',
    title: 'Received at the curing room',
    at: '2026-06-30T07:15:00Z',
    status: 'complete',
    token: '51 crates',
    person: 'Zanele Mokoena',
    icon: 'folder',
    body: 'Logged at 58% relative humidity. Re-weighed against the bill of lading with no discrepancy.',
  },
];

const TIMELINE_DENSITIES = ['expanded', 'compact'];

class TimelineUsage extends Component {
  events = SHIPMENT;
  densityOptions = TIMELINE_DENSITIES;
  nowOptions = NOW_OPTIONS;

  @tracked density = 'expanded';
  @tracked label = 'Lot B-1181 — shipment history';
  @tracked now = NOW;

  setDensity = (v: string) => (this.density = v);
  setLabel = (v: string) => (this.label = v);
  setNow = (v: string) => (this.now = v);

  get densityVal() {
    return this.density as 'compact' | 'expanded';
  }
  get usage() {
    let bits = ['@events={{this.events}}', `@label='${this.label}'`];
    if (this.density !== 'expanded') bits.push(`@density='${this.density}'`);
    bits.push(`@now='${this.now}'`);
    return `<Timeline\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='Timeline'
      @description="A chronological sequence — a shipment's life, an audit trail, a release history. Semantically it is an ordered list and nothing else: role='list' is stamped explicitly because list-style:none strips list semantics in Safari/VoiceOver, and the rail is a CSS pseudo-element while the marker span carries aria-hidden, so a screen reader hears '1. Spring lot booked, confirmed, B-1181, 5 months ago' and not a stream of bullet noise. Everything with meaning is composed from the kit rather than hand-drawn: StatusChip (hue derived from the value, never picked), Token for machine values, RelativeTime for the when, Avatar for the who. Relative times are timer-free — pass a fresh @now to re-derive them, which is what the 'now' knob below does. Honest limits: no left/right alternating layout and no opposite-content slot (they double the CSS, halve the line length, and read as two unrelated columns at narrow widths), and no per-event duration bars — compose a <Meter> or <ProgressBar> into the default block instead."
      @source={{this.usage}}
    >
      <:example>
        <div class='sd-pad'>
          <Timeline
            @events={{this.events}}
            @density={{this.densityVal}}
            @label={{this.label}}
            @now={{this.now}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='events'
          @required={{true}}
          @value={{this.events}}
          @description='The events, in the order you want them rendered and numbered — oldest-first or newest-first, the component does not sort. Each TimelineEvent is { id, title, at?, status?, token?, person?, body?, icon? }.'
        />
        <Args.String
          @name='density'
          @value={{this.density}}
          @options={{this.densityOptions}}
          @defaultValue='expanded'
          @description="'expanded' gives each event a body and a ringed marker; 'compact' tightens the rail to 16px, drops the marker ring and collapses each event toward a single line."
          @onInput={{this.setDensity}}
        />
        <Args.String
          @name='now'
          @value={{this.now}}
          @options={{this.nowOptions}}
          @description='The instant relative times are measured against. Nothing ticks — the realm forbids timers — so move this to re-derive every phrase at once.'
          @onInput={{this.setNow}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Timeline'
          @description='Accessible name for the list.'
          @onInput={{this.setLabel}}
        />
        <Args.Yield
          @name=':default'
          @description='Replaces the event body. Receives the event, so a caller can render a diff, a card, or a Meter where the paragraph would go.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name=':marker'
          @description='Replaces the marker glyph. Receives the event. The marker stays aria-hidden whatever you put in it — it is chrome by construction, so put nothing in it that a reader must parse.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .sd-pad {
        padding: var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        min-width: 0;
      }
    </style>
  </template>
}

export const DEMOS_TIMELINE: Record<string, unknown> = {
  Timeline: TimelineUsage,
};
