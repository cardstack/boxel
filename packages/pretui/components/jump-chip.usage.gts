// Pretui — JumpChip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { JumpChip, scrollEdge } from './jump-chip';

// ── JumpChip ─────────────────────────────────────────────────────────────
const STREAM = [
  'Pulled the Kandy auction catalogue — 18 lots.',
  'Lot 104 scores 84.1; below the 2025 mean once freight is netted out.',
  'Lot 118 scores 88.6 and is still unsold.',
  'Checked the 2024 comparables: 118 cleared at 12% over the mean.',
  'Freight from Colombo is quoted flat this quarter, so the netting holds.',
  'Rewrote the pricing rule to filter on unsold status.',
  'Re-ran the valuation: 118 clears at 9.4% over.',
  'Drafted the buying note.',
  'Attached the contract for signature.',
  'Waiting on your approval before the bid goes in.',
];

class JumpChipUsage extends GlimmerComponent {
  @tracked atEnd = true;
  @tracked news = 3;
  private scroller?: HTMLElement;

  setNews = (n: number) => (this.news = n);

  get visible(): boolean {
    return !this.atEnd || this.news > 0;
  }

  // One boolean latch, reported only when the answer changes — a scroll
  // handler that wrote on every event would re-render the list on every
  // wheel tick.
  edgeChanged = (atEnd: boolean, element: HTMLElement) => {
    this.atEnd = atEnd;
    this.scroller = element;
    if (atEnd) {
      this.news = 0;
    }
  };

  jump = () => {
    let element = this.scroller;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    this.news = 0;
  };

  addNews = () => (this.news = this.news + 1);

  <template>
    <FreestyleUsage
      @name='JumpChip'
      @description='Scroll orientation for a stream that grows while you are reading it, doing two jobs in one control: "3 new messages" when something arrived, "Back to bottom" when nothing did. It is presentational by contract — the caller owns the scroller — but the measurement ships beside it as `scrollEdge`, an ember-modifier that attaches ONE passive scroll listener and reports only when the at-the-bottom answer changes. That boolean latch is the whole design: a handler that wrote state on every scroll event would re-render the transcript on every wheel tick, and a debounce would be a re-arming timer, which a realm forbids. The chip positions itself against the nearest positioned ancestor; give the scroll frame `position: relative` and it lands.'
    >
      <:example>
        <div class='demo-frame'>
          <div
            class='demo-scroll'
            {{scrollEdge this.edgeChanged threshold=16}}
          >
            {{#each STREAM as |line|}}
              <p class='demo-line'>{{line}}</p>
            {{/each}}
          </div>
          <JumpChip
            @visible={{this.visible}}
            @count={{this.news}}
            @onJump={{this.jump}}
          />
        </div>
        <p class='demo-hint'>Scroll up in the frame and the chip appears;
          scroll back down and it leaves. “New message” adds to the count and
          switches the chip to its news voice — reaching the bottom clears it.</p>
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.addNews}}
        >New message</Button>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='visible'
          @description='Whether the chip is offered. Hidden means hidden: no pointer events, no tab stop, no hit area — the whole chip goes inert.'
          @value={{this.visible}}
          @hideControls={{true}}
        />
        <Args.Number
          @name='count'
          @description='Items that arrived while the reader was away. Non-zero switches the chip to its news voice and puts the number in the label — never in colour alone.'
          @value={{this.news}}
          @onInput={{this.setNews}}
          @defaultValue={{0}}
          @min={{0}}
          @max={{9}}
        />
        <Args.Base
          @name='label / direction / onJump'
          @description='The @label arg overrides the derived wording entirely. @direction flips the chip to the top edge and rotates its arrow, for a stream that grows upward.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='scrollEdge (modifier)'
          @description='Applied as a modifier on the scroll container, with an onChange handler and an optional threshold (default 24px). onChange receives (atEnd, element) — the element comes with it so the caller can scroll it later without a second ref mechanism. The listener is passive and is removed in the modifier’s destructor.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-frame {
        position: relative;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .demo-scroll {
        height: 11rem;
        overflow-y: auto;
        padding: 12px 14px;
        background: var(--card);
      }
      .demo-line {
        margin: 0 0 10px;
        max-width: 62ch;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .demo-hint {
        margin: var(--space-4, 11px) 0 var(--space-3, 7px);
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_JUMP_CHIP: Record<string, unknown> = {
  JumpChip: JumpChipUsage,
};
