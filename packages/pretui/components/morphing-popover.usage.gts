// Pretui — MorphingPopover usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { MorphingPopover } from './morphing-popover';
import type { PopupPlacement } from '../internal/overlay';

// ── MorphingPopover ──────────────────────────────────────────────────────
export class MorphingPopoverUsage extends Component {
  @tracked placement: PopupPlacement = 'bottom-start';

  placementOptions = [
    'top-start',
    'top',
    'top-end',
    'bottom-start',
    'bottom',
    'bottom-end',
    'left',
    'right',
  ];

  setPlacement = (v: string) => {
    this.placement = v as PopupPlacement;
  };

  get usage(): string {
    return [
      "<MorphingPopover @label='Filters'>",
      '  <:trigger>Filters</:trigger>',
      '  <:default as |close|>…</:default>',
      '</MorphingPopover>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='MorphingPopover'
      @description='A trigger that grows into its own anchored panel. It WRAPS Popup, so placement, flipping, shifting and re-placement on scroll are anchorTo’s. Added here: the morph out of the trigger’s rectangle, Escape in the capture phase so one keypress cannot mean two things, outside-pointer dismissal, focus into the panel on open, and focus back to the trigger on every dismissal path.'
      @source={{this.usage}}
    >
      <:example>
        <div class='mp-stage'>
          <MorphingPopover @label='Filters' @placement={{this.placement}}>
            <:trigger>Filters</:trigger>
            <:default as |close|>
              <div class='mp-panel'>
                <p class='mp-title'>Filter lots</p>
                <ul class='mp-list'>
                  <li>Cleared and bonded</li>
                  <li>Awaiting cupping</li>
                  <li>Held at the dock</li>
                </ul>
                <button type='button' class='mp-done' {{on 'click' close}}>
                  Done
                </button>
              </div>
            </:default>
          </MorphingPopover>
          <p class='mp-note'>Tab to the trigger and press Enter: focus lands
            inside the panel, Escape closes it, and focus returns to the
            trigger. The
            <code>close</code>
            action is yielded, so a control inside the panel can dismiss it
            without the caller tracking any state.</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='Accessible name for the panel, which carries role=dialog.'
        />
        <Args.String
          @name='placement'
          @description='Where the panel sits relative to the trigger. anchorTo flips and shifts it to stay on screen.'
          @options={{this.placementOptions}}
          @value={{this.placement}}
          @onInput={{this.setPlacement}}
          @defaultValue='bottom-start'
        />
        <Args.Number
          @name='distance'
          @description='Gap between trigger and panel in px.'
          @defaultValue={{8}}
        />
        <Args.Bool
          @name='matchWidth'
          @description='Match the panel’s minimum width to the trigger’s.'
          @defaultValue={{false}}
        />
        <Args.Bool
          @name='open'
          @description='Controlled open state. Omit for uncontrolled.'
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires with the next open state on every change, including Escape and an outside click.'
        />
        <Args.Yield
          @name='default'
          @description='The panel contents. Receives a close action.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-morph-popover-width'
          @type='dimension'
          @description='Minimum panel width.'
          @defaultValue='240px'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .mp-stage {
        display: grid;
        gap: var(--space-4, 11px);
        justify-items: start;
        padding: var(--space-6, 19px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .mp-panel {
        display: grid;
        gap: var(--space-3, 8px);
      }
      .mp-title {
        margin: 0;
        font-weight: var(--weight-strong, 600);
      }
      .mp-list {
        margin: 0;
        padding-inline-start: 1.1em;
        display: grid;
        gap: 3px;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .mp-done {
        justify-self: end;
        padding: 5px 12px;
        min-block-size: 28px;
        border: 0;
        border-radius: var(--radius-control, 7px);
        background: var(--primary);
        color: var(--primary-foreground);
        font: inherit;
        font-size: var(--text-ui-sm, 11.5px);
        cursor: pointer;
      }
      .mp-done:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .mp-note {
        margin: 0;
        max-inline-size: 58ch;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .mp-note code {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_MORPHING_POPOVER: Record<string, unknown> = {
  MorphingPopover: MorphingPopoverUsage,
};
