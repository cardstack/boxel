import Component from '@glimmer/component';

import type { MenuDivider } from '../../helpers/menu-divider.ts';
import type { MenuItem } from '../../helpers/menu-item.ts';
import CaretDown from '../../icons/caret-down.gts';
import BoxelButton from '../button/index.gts';
import BoxelDropdown from '../dropdown/index.gts';
import Menu from '../menu/index.gts';
import SelectionCheckmark from '../selection-checkmark/index.gts';

// SelectionMenu: a primary dropdown control for bulk selection. The trigger
// shows a selection checkmark, the current count, and a caret that flips
// while the menu is open; the menu body is whatever the caller supplies via
// `@items`.
//
// It is deliberately content-agnostic — actions such as "Select All" /
// "Deselect All" (and the inert count header) are app concerns the consumer
// builds and passes in, so the design system owns only the trigger styling
// and the dropdown shell, not the selection semantics.
//
// The caller decides when to render it (typically only once something is
// selected) and what the items do.
interface Signature {
  Args: {
    items: Array<MenuItem | MenuDivider>;
    // Accessible name for the trigger; defaults to the count.
    label?: string;
    selectedCount: number;
  };
  Blocks: {};
  Element: HTMLButtonElement;
}

export default class SelectionMenu extends Component<Signature> {
  private get triggerLabel(): string {
    return (
      this.args.label ?? `Selection menu, ${this.args.selectedCount} selected`
    );
  }

  <template>
    {{! Wrap so the trigger and ember-basic-dropdown's content-origin count
        as ONE flex item in the parent toolbar. BasicDropdown renders no
        wrapper of its own, so without this the origin becomes a sibling
        flex item when the menu opens — adding a parent gap and shifting the
        trigger sideways. }}
    <div class='selection-menu-root'>
      <BoxelDropdown
        @contentClass='selection-menu-content'
        @matchTriggerWidth={{false}}
      >
        <:trigger as |bindings|>
          {{! The trigger is a standard primary Button so it inherits the
            design system's highlight colors, hover, and focus-ring; the
            class only adds what Button doesn't: layout gap, the readable
            highlight foreground, the open-state deepening, and the caret
            flip. }}
          <BoxelButton
            @kind='primary'
            @rectangular={{true}}
            @class='selection-menu-trigger'
            aria-label={{this.triggerLabel}}
            {{bindings}}
            data-test-selection-dropdown-trigger
            ...attributes
          >
            <SelectionCheckmark class='selection-menu-icon' />
            <span class='selection-menu-count'>{{@selectedCount}}</span>
            <CaretDown
              class='selection-menu-caret'
              width='13px'
              height='13px'
            />
          </BoxelButton>
        </:trigger>
        <:content as |dd|>
          <Menu
            class='selection-menu-list'
            @items={{@items}}
            @closeMenu={{dd.close}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style scoped>
      /* Hold the trigger + basic-dropdown origin as a single flex item so
         opening the menu doesn't shift the trigger (see template note). */
      .selection-menu-root {
        display: inline-flex;
      }
      /* The trigger is a primary BoxelButton; it supplies the highlight
         fill, hover, and disabled handling. These rules only add what
         Button's defaults don't fit here: a gap between the icon/count/
         caret, the readable highlight foreground (Button's primary text
         defaults to --boxel-dark), a tighter radius, and compact sizing —
         the base size's wide --boxel-sp-xl padding + 5rem min-width make
         this count trigger far too wide, so collapse both to fit content. */
      .selection-menu-trigger {
        gap: var(--boxel-sp-xxs);
        --boxel-button-text-color: var(--boxel-highlight-foreground);
        --boxel-button-border-radius: var(--boxel-border-radius-sm);
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-width: 0;
      }
      /* Keyboard focus ring: a lighter tint of the current fill, so it stays
         visible against the highlight button (a highlight-colored ring would
         blend into it) while tracking the fill as it darkens. Sits snug
         against the button (1px) rather than floating off it. Defined here
         rather than on BoxelButton because boxel-ui's unlayered global
         `button:focus` rule overrides the button's own layered focus styles. */
      .selection-menu-trigger:focus-visible {
        outline: var(--boxel-outline-width) var(--boxel-outline-style)
          color-mix(in oklab, var(--boxel-button-color) 70%, white);
        outline-offset: 1px;
      }
      /* Deepen the fill while the menu is open, matching Button's hover; the
         focus ring's color-mix tracks the fill, so it darkens to match. */
      .selection-menu-trigger[aria-expanded='true'] {
        --boxel-button-color: var(--boxel-highlight-hover);
      }
      .selection-menu-icon {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
      }
      .selection-menu-count {
        line-height: 1;
        white-space: nowrap;
        /* Reserve a stable width (and equal-width digits) so the trigger
           doesn't shift when the count crosses 1↔2 digits, e.g. during a
           Select All that jumps 9→10. */
        min-width: 2ch;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .selection-menu-caret {
        flex-shrink: 0;
        transition: transform var(--boxel-transition);
      }
      /* Caret flips to point up while the menu is open, matching the standard
         dropdown affordance. */
      .selection-menu-trigger[aria-expanded='true'] .selection-menu-caret {
        transform: rotate(180deg);
      }
      .selection-menu-list {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
    </style>
  </template>
}
