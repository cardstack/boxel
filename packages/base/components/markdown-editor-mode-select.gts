import GlimmerComponent from '@glimmer/component';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

export type MarkdownEditorMode = 'compose' | 'source' | 'preview';

interface ModeOption {
  value: MarkdownEditorMode;
  label: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'compose', label: 'Compose' },
  { value: 'source', label: 'Source' },
  { value: 'preview', label: 'Preview' },
];

interface Signature {
  Args: {
    mode: MarkdownEditorMode;
    onChange: (mode: MarkdownEditorMode) => void;
  };
  Element: HTMLElement;
}

/**
 * Mode selector for the markdown editor toolbar. Wraps BoxelSelect to switch
 * between the Compose, Source, and Preview modes. Always enabled — unlike the
 * formatting controls, it works regardless of editor focus.
 *
 * Named distinctly from boxel-ui's `ViewSelector` (a card/list/grid toggle),
 * which is a different affordance.
 */
export default class MarkdownEditorModeSelect extends GlimmerComponent<Signature> {
  get selectedOption(): ModeOption {
    return (
      MODE_OPTIONS.find((o) => o.value === this.args.mode) ?? MODE_OPTIONS[0]
    );
  }

  handleChange = (option: ModeOption | undefined) => {
    if (option) {
      this.args.onChange(option.value);
    }
  };

  <template>
    <BoxelSelect
      class='markdown-editor-mode-select'
      @options={{MODE_OPTIONS}}
      @selected={{this.selectedOption}}
      @onChange={{this.handleChange}}
      @searchEnabled={{false}}
      @renderInPlace={{true}}
      @matchTriggerWidth={{false}}
      @dropdownClass='markdown-editor-mode-select-dropdown'
      data-test-markdown-mode-select={{this.selectedOption.value}}
      ...attributes
      as |option|
    >
      <span
        data-test-markdown-mode-option={{option.value}}
      >{{option.label}}</span>
    </BoxelSelect>

    <style scoped>
      .markdown-editor-mode-select {
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
      .markdown-editor-mode-select[aria-expanded='true'] {
        border-radius: var(--boxel-form-control-border-radius) !important;
      }
    </style>
    {{! The dropdown sizes to its widest label rather than collapsing to the
        narrow trigger width. Targeted by a class because the dropdown renders
        outside this component's scoped-style reach (mirrors BoxelSelect). }}
    {{! template-lint-disable require-scoped-style }}
    <style>
      .boxel-select__dropdown.markdown-editor-mode-select-dropdown {
        width: max-content;
        min-width: 7rem;
      }
      .markdown-editor-mode-select-dropdown .boxel-select-option-text {
        white-space: nowrap;
      }
    </style>
  </template>
}
