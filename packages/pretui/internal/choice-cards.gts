// Pretui — RadioCard and CheckboxCard: a choice where each option is a card.
// The card is the label and the hit target; a real radio or checkbox sits
// inside it, so the keyboard model and the group semantics are the
// platform's, and `@name` makes the group a form field. Selection reads as the tone hairline around the card,
// not a heavier border, and the small mark in the corner echoes Checkbox and
// RadioGroup so the three read as one family.
//
// Every component here lives in its own module under components/; this
// module re-exports them so existing imports keep working.
//
// (the choice-cards group)

// Pretui — the card cloth and grid shared by RadioCard and CheckboxCard.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface ChoiceCardOption {
  value: string;
  title: string;
  description?: string;
  /** a short trailing figure — a price, a quota, a count */
  meta?: string;
  disabled?: boolean;
}

export type ChoiceCardOrientation = 'vertical' | 'horizontal';

interface OptionCardSignature {
  Args: {
    kind: 'radio' | 'checkbox';
    option: ChoiceCardOption;
    /** the form field name; radios also group by it */
    name?: string;
    selected: boolean;
    disabled: boolean;
    onChange: (ev: Event) => void;
    /** the owner has a default block that replaces the generated body */
    custom: boolean;
    /** the owner has a media block */
    hasMedia: boolean;
  };
  Blocks: {
    default: [option: ChoiceCardOption, selected: boolean];
    media: [option: ChoiceCardOption];
  };
  Element: HTMLLabelElement;
}

// The card cloth, written once for both kinds.
export const OptionCard: TemplateOnlyComponent<OptionCardSignature> = <template>
  <label
    class='pretui-optioncard'
    data-kind={{@kind}}
    data-selected={{if @selected 'true' 'false'}}
    data-disabled={{if @disabled 'true' 'false'}}
    ...attributes
  >
    <input
      type={{@kind}}
      class='pretui-optioncard-input'
      name={{@name}}
      value={{@option.value}}
      checked={{@selected}}
      disabled={{@disabled}}
      {{on 'change' @onChange}}
    />
    {{#if @hasMedia}}
      <span class='pretui-optioncard-media'>{{yield @option to='media'}}</span>
    {{/if}}
    <span class='pretui-optioncard-body'>
      {{#if @custom}}
        {{yield @option @selected}}
      {{else}}
        <span class='pretui-optioncard-title'>{{@option.title}}</span>
        {{#if @option.description}}
          <span class='pretui-optioncard-desc'>{{@option.description}}</span>
        {{/if}}
      {{/if}}
    </span>
    {{#if @option.meta}}
      <span class='pretui-optioncard-meta'>{{@option.meta}}</span>
    {{/if}}
    <span class='pretui-optioncard-mark' aria-hidden='true'></span>
  </label>
  <style scoped>
    @layer PretComponent {
      .pretui-optioncard {
        --oc-pad: var(--space-4, 0.6875rem);
        --oc-gap: var(--space-3, 0.5rem);
        --oc-text: var(--text-ui-md, 0.78rem);
        --oc-small: var(--text-ui-sm, 0.72rem);
        --oc-strong: var(--weight-strong, 600);
        --oc-radius: var(--radius-surface, 0.625rem);
        --oc-snap: var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
        --oc-shadow: var(--pretui-shadow-control, 0 1px 2px rgb(0 0 0 / 0.04));
        --oc-highlight: var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
        --oc-tone: var(--primary);
        --oc-mark: 0.9375rem;
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: var(--oc-gap);
        min-inline-size: 0;
        padding: var(--oc-pad);
        padding-inline-end: calc(var(--oc-pad) * 2 + var(--oc-mark));
        background-color: var(--card);
        color: var(--card-foreground);
        border-radius: var(--oc-radius);
        box-shadow:
          0 0 0 1px var(--border),
          var(--oc-shadow);
        font-size: var(--oc-text);
        cursor: pointer;
        transition:
          box-shadow var(--oc-snap),
          background-color var(--oc-snap);
      }
      .pretui-optioncard:hover {
        background-color: var(--hover);
      }
      .pretui-optioncard[data-selected='true'] {
        box-shadow:
          0 0 0 1px var(--oc-tone),
          0 0 0 4px color-mix(in oklch, var(--oc-tone) 12%, transparent),
          var(--oc-shadow);
      }
      .pretui-optioncard:has(.pretui-optioncard-input:focus-visible) {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-optioncard[data-disabled='true'] {
        opacity: 0.45;
        cursor: default;
      }
      /* the real control: in the tree and in the tab order, painted by the mark */
      .pretui-optioncard-input {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: 0;
        opacity: 0;
        pointer-events: none;
      }
      .pretui-optioncard-media {
        flex: none;
        display: inline-flex;
      }
      .pretui-optioncard-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-inline-size: 0;
      }
      .pretui-optioncard-title {
        font-weight: var(--oc-strong);
      }
      .pretui-optioncard-desc {
        font-size: var(--oc-small);
        color: var(--muted-foreground);
      }
      .pretui-optioncard-meta {
        flex: none;
        font-size: var(--oc-small);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pretui-optioncard-mark {
        position: absolute;
        inset-block-start: var(--oc-pad);
        inset-inline-end: var(--oc-pad);
        inline-size: var(--oc-mark);
        block-size: var(--oc-mark);
        display: grid;
        place-content: center;
        border-radius: 50%;
        background-color: var(--field);
        box-shadow: 0 0 0 1px var(--input);
        transition:
          background-color var(--oc-snap),
          box-shadow var(--oc-snap);
      }
      .pretui-optioncard[data-kind='checkbox'] .pretui-optioncard-mark {
        border-radius: 0.3125rem;
      }
      .pretui-optioncard[data-selected='true'] .pretui-optioncard-mark {
        background-color: var(--oc-tone);
        box-shadow:
          0 0 0 1px var(--oc-tone),
          var(--oc-highlight);
      }
      .pretui-optioncard[data-selected='true'] .pretui-optioncard-mark::before {
        content: '';
        display: block;
      }
      .pretui-optioncard[data-kind='radio'][data-selected='true'] .pretui-optioncard-mark::before {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        border-radius: 50%;
        background-color: var(--card);
        box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12);
      }
      .pretui-optioncard[data-kind='checkbox'][data-selected='true'] .pretui-optioncard-mark::before {
        inline-size: 0.5625rem;
        block-size: 0.5625rem;
        background-color: var(--primary-foreground);
        clip-path: polygon(14% 47%, 38% 70%, 86% 18%, 96% 30%, 39% 89%, 4% 58%);
      }
    }
  </style>
</template>;

interface ChoiceGridSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// The group's grid, written once for both kinds; role, name and data
// attributes arrive through `...attributes` from the owner.
export const ChoiceGrid: TemplateOnlyComponent<ChoiceGridSignature> = <template>
  <div class='pretui-choicecards' ...attributes>{{yield}}</div>
  <style scoped>
    @layer PretComponent {
      .pretui-choicecards {
        --cc-gap: var(--space-3, 0.5rem);
        --cc-min: 11rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--cc-gap);
      }
      .pretui-choicecards[data-orientation='horizontal'] {
        grid-template-columns: repeat(auto-fit, minmax(var(--cc-min), 1fr));
      }
      .pretui-choicecards[data-orientation='horizontal'][data-columns='2'] {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .pretui-choicecards[data-orientation='horizontal'][data-columns='3'] {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .pretui-choicecards[data-orientation='horizontal'][data-columns='4'] {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  </style>
</template>;

export interface ChoiceCardsSharedArgs {
  options?: ChoiceCardOption[];
  /** alias — the canonical flat-collection noun */
  items?: ChoiceCardOption[];
  disabled?: boolean;
  /** alias — React Aria / Base UI spelling of @disabled */
  isDisabled?: boolean;
  /** the group's accessible name when no label element points at it */
  label?: string;
  /** the form field name every input in the group submits under */
  name?: string;
  /** `vertical` (default) stacks the cards; `horizontal` lays them side by side */
  orientation?: ChoiceCardOrientation;
  /** a fixed column count for `horizontal` (2, 3 or 4); default: as many as fit */
  columns?: 2 | 3 | 4;
}
