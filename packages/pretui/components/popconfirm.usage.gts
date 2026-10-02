// Pretui — Popconfirm usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Popconfirm } from './popconfirm';
import type { PopupPlacement } from '../internal/overlay';

const PC_PLACEMENTS = ['top', 'bottom', 'left', 'right', 'top-start', 'bottom-end'];


class PopconfirmUsage extends GlimmerComponent {
  @tracked placement = 'top';
  @tracked showCancel = true;
  @tracked rows = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Nyeri'];
  @tracked log = '—';

  setPlacement = (value: string) => (this.placement = value);
  setShowCancel = (value: boolean) => (this.showCancel = value);

  get placementValue() {
    return this.placement as PopupPlacement;
  }

  dropFirst = () => {
    let [head, ...rest] = this.rows;
    if (!head) {
      return;
    }
    this.rows = rest;
    this.log = 'Removed ' + head;
  };

  kept = () => (this.log = 'Kept');

  restore = () => {
    this.rows = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Nyeri'];
    this.log = '—';
  };

  <template>
    <FreestyleUsage
      @name='Popconfirm'
      @description="Ant's inline are-you-sure, anchored to the control it guards. Reach for it when the object of the verb is the thing you just clicked and it is still on screen — deleting this row, revoking this key — because the bubble points at the object, so the question needs no noun. Reach for AlertDialog instead when the consequence is not visible from where the click happened, needs more than a line to state, spans more than one object, or is genuinely irreversible. The tell that a Popconfirm should have been an AlertDialog: you find yourself wanting a third paragraph, a checkbox, or a type-the-name-to-confirm field in it."
    >
      <:example>
        <ul class='oc-list'>
          {{#each this.rows as |lot|}}
            <li class='oc-lotrow'>
              <span>{{lot}}</span>
            </li>
          {{/each}}
        </ul>
        <div class='oc-row'>
          <Popconfirm
            @title='Remove the top lot?'
            @description='It leaves the board straight away.'
            @confirmLabel='Remove'
            @cancelLabel='Keep'
            @placement={{this.placementValue}}
            @showCancel={{this.showCancel}}
            @onConfirm={{this.dropFirst}}
            @onCancel={{this.kept}}
          >
            <:trigger as |isOpen toggle|>
              <Button
                @tone='danger'
                @appearance='plain'
                @size='s'
                {{on 'click' toggle}}
              >{{if isOpen 'Cancel' 'Remove top lot'}}</Button>
            </:trigger>
          </Popconfirm>
          <Button @tone='neutral' @appearance='outlined' @size='s' {{on 'click' this.restore}}>
            Restore
          </Button>
          <span class='oc-log'>last action: <strong>{{this.log}}</strong></span>
        </div>
        <p class='oc-hint'>Open it and focus is already on
          <em>Keep</em>. Escape cancels and puts focus back on the trigger;
          clicking elsewhere closes it without swallowing that click, so
          pressing a button behind the bubble takes one press rather than two.</p>
      </:example>
      <:api as |Args|>
        <Args.Base
          @name='open / onOpenChange / defaultOpen'
          @description='Same overlay contract as every other Pretui layer.'
          @hideControls={{true}}
        />
        <Args.String
          @name='placement'
          @description='Where the bubble sits, through the same anchorTo primitive Popover and Menu use, so it flips and shifts near a viewport edge. Ant defaults to top and so does this.'
          @value={{this.placement}}
          @options={{PC_PLACEMENTS}}
          @defaultValue='top'
          @onInput={{this.setPlacement}}
        />
        <Args.Bool
          @name='showCancel'
          @description="Ant's own arg name. With no cancel the confirm button takes the opening focus instead, so there is never an opening state where focus is nowhere."
          @value={{this.showCancel}}
          @defaultValue={{true}}
          @onInput={{this.setShowCancel}}
        />
        <Args.Base
          @name='confirmLabel / cancelLabel'
          @description='okText and cancelText are accepted as aliases, because that is what an agent trained on Ant will type. Defaults are Yes and No, which is the one place a bare yes/no is right — the question is one line and the object is on screen.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='tone / busy / disabled'
          @description='Tone defaults to danger. Busy holds the bubble open with the confirm pending. Disabled makes the trigger inert without removing it.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='trigger / default / footer'
          @description='The trigger block yields the open state and a toggle; whatever focusable control it contains is given aria-haspopup=dialog and a live aria-expanded, and both are restored on teardown so the element is left as it was found. Ant gives the trigger no ARIA at all.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .oc-list {
        list-style: none;
        margin: 0 0 var(--space-4, 11px);
        padding: 0;
        display: grid;
        gap: 2px;
        max-width: 260px;
      }
      .oc-lotrow {
        padding: 5px 9px;
        border-radius: var(--radius-control, 6px);
        background: var(--inset, var(--boxel-100));
        font-size: var(--text-ui-md, 12.5px);
      }
      .oc-row {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        flex-wrap: wrap;
      }
      .oc-log {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .oc-log strong {
        color: var(--foreground);
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

export const DEMOS_POPCONFIRM: Record<string, unknown> = {
  Popconfirm: PopconfirmUsage,
};
