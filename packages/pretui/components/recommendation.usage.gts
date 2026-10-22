// Pretui — Recommendation usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Recommendation } from './recommendation';
import type { RecommendationOption } from './recommendation';

// ── Recommendation ───────────────────────────────────────────────────────
const OPTIONS: RecommendationOption[] = [
  {
    key: 'lot118',
    body: 'Bid on lot 118 at 9.4% over the 2025 mean. It is the only unsold lot scoring above 88, the 2024 comparable cleared at 12% over, and Colombo freight is quoted flat this quarter — so the netting that killed lot 104 does not apply here.',
    short: 'Bid lot 118 at +9.4%',
    level: 3,
    label: 'High confidence',
    cta: 'Accept and draft the bid',
  },
  {
    key: 'lot104',
    body: 'Bid on lot 104 at the mean. It is cheaper per kilo, but it scores 84.1 and the freight netting pushes the landed cost above lot 118 — the saving is nominal rather than real.',
    short: 'Bid lot 104 at the mean',
    level: 1,
    label: 'Low confidence',
    hue: 'var(--chart-4)',
  },
  {
    key: 'wait',
    body: 'Wait for the November catalogue. Two comparable estates are expected to list, which would give a second reference price — at the cost of missing this auction entirely.',
    short: 'Wait for the November catalogue',
    level: 2,
    label: 'Medium confidence',
    hue: 'var(--chart-2)',
    cta: 'Accept and hold',
  },
];

class RecommendationUsage extends GlimmerComponent {
  @tracked log = '—';

  accepted = (option: RecommendationOption) => (this.log = 'accepted: ' + option.short);
  selected = (option: RecommendationOption) => (this.log = 'switched to: ' + option.short);

  <template>
    <FreestyleUsage
      @name='Recommendation'
      @description='The agent has an opinion and the reader has to decide. One recommendation forward with its reasoning, its confidence as segments beside a word, and the alternatives one keystroke away rather than hidden. Switching to an alternative is a state change the reader made, so it goes to a polite live region; the original merely cross-faded the body, which tells a sighted reader something happened and a screen-reader user nothing at all. The confidence scale is the kit’s own Meter, so a recommendation and a data table express a level the same way.'
    >
      <:example>
        <Recommendation
          @question='How should we bid on the Kandy catalogue?'
          @options={{OPTIONS}}
          @onAccept={{this.accepted}}
          @onSelect={{this.selected}}
        />
        <p class='demo-log'>last:
          <strong>{{this.log}}</strong></p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='Best first: { key, body, short, level, label, hue?, cta? }. `level` is 0..3 for the Meter’s segments and `label` is the word beside them — both are required, because a level with no label is a colour with no meaning. `hue` is a caller string and goes through the kit-wide cssValue allowlist.'
          @value={{OPTIONS}}
        />
        <Args.String
          @name='question'
          @description='What is being decided. Rendered as the block’s heading.'
          @value='How should we bid on the Kandy catalogue?'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='body'
          @description='Rich body for the active option, receiving the option itself — for a recommendation whose argument contains Token pills, an inline chart or an embedded card rather than a paragraph.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='selectedKey / onSelect / accepted / onAccept'
          @description='Selection and acceptance are both controllable and both default to internal state, so the simplest call site is @question + @options and nothing else. @onAccept receives the option that was accepted, never just its key.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='acceptedLabel / alternativesLabel'
          @description='The two wordings the component owns. The accept face otherwise comes from the active option’s own `cta`, so "Accept and draft the bid" and "Accept and hold" can differ per option.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-log {
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .demo-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
    </style>
  </template>
}

export const DEMOS_RECOMMENDATION: Record<string, unknown> = {
  Recommendation: RecommendationUsage,
};
