// Pretui — Popover usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Popover } from './popover';
import type { PopupPlacement } from '../internal/overlay';
import { Button } from './button';
import { PLACEMENT_OPTIONS } from '../demo-structure';

// Dropped knobs: contentClass (no class arg); variant (styling rides theme
// tokens); matchTriggerWidth (exposed on the Popup primitive as @matchWidth,
// not on Popover); registerAPI (no public-API object — the trigger block
// yields open/toggle instead); onClose + autoClose (backdrop click and
// Escape close the panel by design).
class PopoverUsage extends GlimmerComponent {
  @tracked placement = 'bottom-start';
  @tracked distance = 6;
  setPlacement = (v: string) => (this.placement = v);
  setDistance = (v: number | null) => (this.distance = v ?? 6);
  get placementVal() {
    return this.placement as PopupPlacement;
  }
  get usage() {
    return `<Popover @placement='${this.placement}' @distance={{${this.distance}}}>…</Popover>`;
  }
  <template>
    <FreestyleUsage
      @name='Popover'
      @description='This component is a building block for more complex components. It anchors a floating panel to its trigger with fixed positioning — flipping and shifting when out of room — and closes via backdrop click or Escape, so no #-in-element rendering or focus-trap addon is needed.'
      @source={{this.usage}}
    >
      <:example>
        <Popover
          @placement={{this.placementVal}}
          @distance={{this.distance}}
          @label='Demo popover'
        >
          <:trigger as |open toggle|>
            <Button @tone='neutral' @appearance='outlined' {{on 'click' toggle}}>
              {{if open 'Close' 'Trigger'}}
            </Button>
          </:trigger>
          <:default as |close|>
            <div class='pop-body'>
              <p class='pop-copy'>A building block for more complex overlays —
                anchored to its trigger, flipping when out of room.</p>
              <Button @tone='primary' @size='s' {{on 'click' close}}>Done</Button>
            </div>
          </:default>
        </Popover>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='placement'
          @description='Preferred side and alignment of the panel relative to the trigger; flips to the opposite side when out of room.'
          @value={{this.placement}}
          @options={{PLACEMENT_OPTIONS}}
          @defaultValue='bottom-start'
          @onInput={{this.setPlacement}}
        />
        <Args.Number
          @name='distance'
          @description='Gap in pixels between the trigger and the panel.'
          @value={{this.distance}}
          @min={{0}}
          @max={{24}}
          @step={{1}}
          @defaultValue='6'
          @onInput={{this.setDistance}}
        />
        <Args.String
          @name='label'
          @description='Accessible label for the panel dialog.'
          @defaultValue='Popover'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='trigger'
          @description='Content to be used as the trigger. Yields the open state and a toggle action — replaces the bindings modifier that applied aria- attributes and event handling.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Content to show in the panel; rendered while open. Yields a close action to close the popover.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pop-body {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
      }
      .pop-copy {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_POPOVER: Record<string, unknown> = {
  Popover: PopoverUsage,
};
