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

  handleChange = (option: ModeOption | null) => {
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
      {{! Render the menu in the shared dropdown wormhole, not in place: this
          toolbar sits inside CodeMirrorEditor's `overflow: clip` corner-clip
          box, and an in-place menu would be swallowed by it once the toolbar
          docks at the bottom on scroll. BoxelSelect syncs the card theme onto
          the wormhole on open, so the themed look is preserved. }}
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
        /* Trim the trigger's corners: the default form-control radius reads a
           touch too rounded here, so drop it 2px (scoped to this select). */
        --boxel-form-control-border-radius: calc(
          var(--boxel-border-radius) - 2px
        );
        /* Compact the trigger: tight padding and a small label↔caret gap,
           via the BoxelSelect trigger tokens. */
        --boxel-select-trigger-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        --boxel-select-trigger-gap: var(--boxel-sp-xxs);
        /* Accent on hover/open: the theme ring/primary when themed, else the
           teal brand color — matching the mock and the selected-option
           highlight (rather than the default dark border). */
        --boxel-select-focus-border-color: var(
          --ring,
          var(--primary, var(--boxel-highlight))
        );
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
        /* The trigger's 2px-tighter radius arrives on the wormhole via
           BoxelSelect's `--boxel-form-control-border-radius` sync (resolved
           against the card theme at the trigger). Don't re-declare it here:
           this element sits at the app root, where the card's
           `--boxel-border-radius` doesn't apply, so a local `calc()` would
           override the synced value with the app default under a theme. */
        width: max-content;
        min-width: 7rem;
      }
      /* Shorter rows: tighten the vertical padding so the menu reads less tall.
         (0,3,0) specificity wins over BoxelSelect's own row rules regardless of
         stylesheet order. */
      .boxel-select__dropdown.markdown-editor-mode-select-dropdown
        .boxel-select-option-item {
        padding-block: var(--boxel-sp-3xs);
      }
      .markdown-editor-mode-select-dropdown .boxel-select-option-text {
        white-space: nowrap;
      }
    </style>
  </template>
}
