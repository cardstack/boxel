// Pretui — HoverCard usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { HoverCard } from './hover-card';
import type { PopupPlacement } from '../internal/overlay';

const HC_PLACEMENTS = ['bottom-start', 'bottom', 'top', 'right-start', 'left-start'];

// Glimmer accepts decimal number literals, but `{{0.5}}` reads like the
// `{{foo.0}}` numeric-path form the transpiler rejects. Named constants keep
// the template unambiguous.
const DELAY_STEP = 0.1;
const DELAY_MAX = 2;
const DELAY_MIN = 0;
const OPEN_DELAY_DEFAULT = 0.5;
const CLOSE_DELAY_DEFAULT = 0.3;


class HoverCardUsage extends GlimmerComponent {
  @tracked placement = 'bottom-start';
  @tracked openDelay = 0.5;
  @tracked closeDelay = 0.3;

  setPlacement = (value: string) => (this.placement = value);
  setOpenDelay = (value: number | null) => (this.openDelay = value ?? 0.5);
  setCloseDelay = (value: number | null) => (this.closeDelay = value ?? 0.3);

  get placementValue() {
    return this.placement as PopupPlacement;
  }

  <template>
    <FreestyleUsage
      @name='HoverCard'
      @description='The rich link preview: a Popup with hover intent in front of it. Accessibility is the whole problem, because content that only appears on hover is content a keyboard user, a screen reader and every touch device cannot reach. Focus opens it with no delay, since a reader who deliberately tabbed to the trigger has already expressed the intent. The card keeps its own tab stops, so Tab walks into it and out again — Radix sets tabindex=-1 on everything inside, which prevents a trap by making the card useless to exactly the people it was made reachable for. And a tap opens it on a coarse pointer, where Radix simply excludes touch and the card does not exist at all.'
    >
      <:example>
        <p class='oc-prose'>Lot 4417 was cupped by
          <HoverCard
            @placement={{this.placementValue}}
            @openDelay={{this.openDelay}}
            @closeDelay={{this.closeDelay}}
            @label='Ama Boateng'
          >
            <:trigger>
              <a class='oc-mention' href='#lot-4417'>Ama Boateng</a>
            </:trigger>
            <:default>
              <div class='oc-card'>
                <span class='oc-card-name'>Ama Boateng</span>
                <span class='oc-card-role'>Q grader · Accra desk</span>
                <p class='oc-card-note'>Scores East African naturals; keeps the
                  arrivals board honest about moisture.</p>
                <a class='oc-card-link' href='#profile'>Open profile</a>
              </div>
            </:default>
          </HoverCard>
          on the 14th, three days after arrival.</p>
        <p class='oc-hint'>Tab to the link and the card opens at once. Tab again
          and focus moves
          <em>into</em>
          the card, onto its own link. Tab past it and it closes. Escape closes
          it and puts focus back on the mention.</p>
      </:example>
      <:api as |Args|>
        <Args.Base
          @name='open / onOpenChange / defaultOpen'
          @description='The overlay contract. A controlled HoverCard is how a tour or a test drives it without a pointer.'
          @hideControls={{true}}
        />
        <Args.String
          @name='placement'
          @description="Radix's side and align collapsed into one logical placement, resolved through the kit's own anchorTo."
          @value={{this.placement}}
          @options={{HC_PLACEMENTS}}
          @defaultValue='bottom-start'
          @onInput={{this.setPlacement}}
        />
        <Args.Number
          @name='openDelay'
          @description='Seconds of hover before it opens. Seconds, not the 700 Radix passes — a bare number in a prop is a unit no caller can check. Focus ignores this entirely.'
          @value={{this.openDelay}}
          @min={{DELAY_MIN}}
          @max={{DELAY_MAX}}
          @step={{DELAY_STEP}}
          @defaultValue={{OPEN_DELAY_DEFAULT}}
          @onInput={{this.setOpenDelay}}
        />
        <Args.Number
          @name='closeDelay'
          @description='Seconds after the pointer leaves before it closes. The pair matters more than either number: the close delay is the bridge across the gap between trigger and card, and setting it to zero makes the card unreachable by pointer no matter how good the open delay is.'
          @value={{this.closeDelay}}
          @min={{DELAY_MIN}}
          @max={{DELAY_MAX}}
          @step={{DELAY_STEP}}
          @defaultValue={{CLOSE_DELAY_DEFAULT}}
          @onInput={{this.setCloseDelay}}
        />
        <Args.Bool
          @name='tapToOpen'
          @description='On a coarse pointer a tap opens the card without swallowing the trigger, so a link stays a link and a preview is still available. This is the arg Radix does not have.'
          @value={{true}}
          @defaultValue={{true}}
          @hideControls={{true}}
        />
        <Args.Yield
          @name='trigger / default'
          @description='The trigger block holds the link or control; whatever focusable it contains gets aria-expanded and aria-controls pointing at the card, a relationship neither Radix nor shadcn establishes. The default block receives a close function for a card that wants its own dismiss.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .oc-prose {
        margin: 0;
        max-width: 54ch;
        font-size: var(--text-body, 15px);
        line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
      }
      .oc-mention {
        color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        text-decoration: underline;
        text-underline-offset: 2px;
        text-decoration-style: dotted;
      }
      .oc-mention:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
        border-radius: 3px;
      }
      .oc-card {
        display: grid;
        gap: 3px;
      }
      .oc-card-name {
        font-weight: 600;
      }
      .oc-card-role {
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 11.5px);
      }
      .oc-card-note {
        margin: var(--space-2, 6px) 0 0;
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.5;
      }
      .oc-card-link {
        margin-top: var(--space-3, 8px);
        color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 600;
      }
      .oc-hint {
        margin: var(--space-4, 11px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .oc-hint em {
        font-style: normal;
        font-weight: 600;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_HOVER_CARD: Record<string, unknown> = {
  HoverCard: HoverCardUsage,
};
