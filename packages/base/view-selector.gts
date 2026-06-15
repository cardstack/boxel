import GlimmerComponent from '@glimmer/component';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

export type ViewMode = 'compose' | 'source' | 'preview';

interface ViewOption {
  value: ViewMode;
  label: string;
}

const VIEW_OPTIONS: ViewOption[] = [
  { value: 'compose', label: 'Compose' },
  { value: 'source', label: 'Source' },
  { value: 'preview', label: 'Preview' },
];

interface Signature {
  Args: {
    mode: ViewMode;
    onChange: (mode: ViewMode) => void;
  };
  Element: HTMLElement;
}

/**
 * Presentational view-selector for the markdown editor toolbar. Wraps
 * BoxelSelect to switch between the Compose, Source, and Preview views.
 * Always enabled — unlike the formatting controls, the view selector works
 * regardless of editor focus.
 */
export default class ViewSelector extends GlimmerComponent<Signature> {
  get selectedOption(): ViewOption {
    return (
      VIEW_OPTIONS.find((o) => o.value === this.args.mode) ?? VIEW_OPTIONS[0]
    );
  }

  handleChange = (option: ViewOption | undefined) => {
    if (option) {
      this.args.onChange(option.value);
    }
  };

  <template>
    <BoxelSelect
      class='view-selector'
      @options={{VIEW_OPTIONS}}
      @selected={{this.selectedOption}}
      @onChange={{this.handleChange}}
      @searchEnabled={{false}}
      @renderInPlace={{true}}
      @matchTriggerWidth={{false}}
      @dropdownClass='view-selector-dropdown'
      data-test-view-selector={{this.selectedOption.value}}
      ...attributes
      as |option|
    >
      <span data-test-view-option={{option.value}}>{{option.label}}</span>
    </BoxelSelect>

    <style scoped>
      .view-selector {
        /* Compact the trigger: tight padding and a small label↔caret gap,
           via the BoxelSelect trigger tokens. */
        --boxel-select-trigger-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        --boxel-select-trigger-gap: var(--boxel-sp-xxs);
        /* Teal brand accent on hover/open, matching the mock and the
           selected-option highlight (rather than the default dark border). */
        --boxel-select-focus-border-color: var(--boxel-highlight);
        width: auto;
      }
      /* The open menu is a detached rounded card, so keep the trigger fully
         rounded when open. The default attaches the menu by squaring the
         trigger's bottom corners; !important wins without depending on
         ember-power-select's internal class names. */
      .view-selector[aria-expanded='true'] {
        border-radius: var(--boxel-form-control-border-radius) !important;
      }
    </style>
    {{! The dropdown sizes to its widest label rather than collapsing to the
        narrow trigger width. Targeted by a class because the dropdown renders
        outside this component's scoped-style reach (mirrors BoxelSelect). }}
    {{! template-lint-disable require-scoped-style }}
    <style>
      .boxel-select__dropdown.view-selector-dropdown {
        width: max-content;
        min-width: 7rem;
      }
      .view-selector-dropdown .boxel-select-option-text {
        white-space: nowrap;
      }
    </style>
  </template>
}
