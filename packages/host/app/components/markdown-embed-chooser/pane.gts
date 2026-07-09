import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Component from '@glimmer/component';

import {
  BoxelInput,
  BoxelSelect,
  Button,
} from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import { serializeBfmRef } from '@cardstack/runtime-common/bfm-card-references';

import PlacementToggle from './placement-toggle';

import MarkdownEmbedPreview from './preview';

import type EmbedFormatSelection from './format-selection';
import type { FormatOption, OptionValue } from './format-selection';
import type { CardDef, FileDef } from '@cardstack/base/card-api';

export { type OptionValue };

interface Signature {
  Element: HTMLElement;
  Args: {
    // Resolved instance being previewed. Its `id` is the BFM ref URL. Always a
    // real target — the parent (tab-panel) only mounts the pane once a row is
    // picked and its instance resolves, rendering its own placeholder until then.
    target: CardDef | FileDef;
    // Which BFM keyword to emit: `:card[...]` vs `:file[...]`.
    refType: 'card' | 'file';
    // The shared format/placement/size selection. Owned by the modal and shared
    // across both tabs so the choice survives a tab switch; this pane is a pure
    // view over it plus the resolved target.
    selection: EmbedFormatSelection;
    // Receives the serialized BFM directive when the CTA is clicked. The host
    // owns actual cursor insertion.
    onInsert: (bfm: string) => void;
    // Overrides the dynamic "Insert as …" CTA label. Used in edit mode to
    // show 'DONE' (clean) or 'ACCEPT' (dirty) per the design spec.
    ctaLabelOverride?: string;
  };
}

// Right-hand companion to the mini choosers: a live preview plus the controls
// that decide how a card/file embeds — format dropdown, always-on W×H inputs
// for Fitted (with smart variant matching), an Inline/Block toggle, and a
// dynamic "Insert as …" CTA. All format state lives on the shared
// `@selection`; this component only renders it and serializes the directive.
export default class MarkdownEmbedPreviewPane extends Component<Signature> {
  private get ctaLabel(): string {
    if (this.args.ctaLabelOverride !== undefined) {
      return this.args.ctaLabelOverride;
    }
    return `Insert as ${this.args.selection.categoryLabel}`;
  }

  private get bfmString(): string {
    let url = this.args.target.id;
    if (!url) {
      return '';
    }
    return serializeBfmRef(this.args.refType, url, {
      kind: this.args.selection.kind,
      size: this.args.selection.sizeSpecifier,
    });
  }

  @action
  private selectFormat(option: FormatOption) {
    this.args.selection.selectFormat(option);
  }

  @action
  private setWidth(value: string) {
    this.args.selection.setWidth(value);
  }

  @action
  private setHeight(value: string) {
    this.args.selection.setHeight(value);
  }

  @action
  private setKind(kind: 'inline' | 'block') {
    this.args.selection.setKind(kind);
  }

  @action
  private insert() {
    let bfm = this.bfmString;
    if (!bfm) return;
    this.args.onInsert(bfm);
  }

  <template>
    <section
      class='markdown-embed-preview-pane'
      data-test-markdown-embed-preview-pane
      ...attributes
    >
      <div class='markdown-embed-preview-pane__header'>
        <BoxelSelect
          class='markdown-embed-preview-pane__format-select'
          @dropdownClass='markdown-embed-preview-pane__format-dropdown'
          @options={{@selection.formatOptions}}
          @selected={{@selection.selectedOption}}
          @onChange={{this.selectFormat}}
          @searchEnabled={{false}}
          @matchTriggerWidth={{true}}
          data-test-markdown-embed-preview-format-select
          as |option|
        >
          <span
            class='markdown-embed-preview-pane__format-option
              {{if option.dividerAfter "has-divider"}}'
            data-test-format-option={{option.value}}
          >
            <span
              class='markdown-embed-preview-pane__format-option-name'
            >{{option.formatLabel}}</span>
            -
            <span>{{option.sizeLabel}}</span>
          </span>
        </BoxelSelect>
      </div>

      <div class='markdown-embed-preview-pane__viewport'>
        <MarkdownEmbedPreview
          @target={{@target}}
          @format={{@selection.previewFormat}}
          @sizeSpec={{@selection.sizeSpec}}
          @kind={{@selection.kind}}
          @showSurroundingText={{true}}
        />
      </div>

      <footer class='markdown-embed-preview-pane__footer'>
        <PlacementToggle
          @selected={{@selection.kind}}
          @onChange={{this.setKind}}
        />

        {{#if @selection.showSizeInputs}}
          <div
            class='markdown-embed-preview-pane__size'
            data-test-markdown-embed-preview-size
          >
            <BoxelInput
              class='markdown-embed-preview-pane__size-input'
              @value={{@selection.widthInput}}
              @onInput={{this.setWidth}}
              aria-label='Width'
              data-test-markdown-embed-preview-width
            />
            <IconX
              class='markdown-embed-preview-pane__size-x'
              aria-hidden='true'
            />
            <BoxelInput
              class='markdown-embed-preview-pane__size-input'
              @value={{@selection.heightInput}}
              @onInput={{this.setHeight}}
              aria-label='Height'
              data-test-markdown-embed-preview-height
            />
          </div>
        {{/if}}

        <Button
          @kind='primary'
          @size='small'
          class='markdown-embed-preview-pane__cta'
          data-test-markdown-embed-preview-cta
          {{on 'click' this.insert}}
        >
          {{this.ctaLabel}}
        </Button>
      </footer>
    </section>
    {{! template-lint-disable require-scoped-style }}
    <style>
      /* Taller dropdown so more of the format options show before scrolling,
         but never taller than the window. The trigger sits near the top of a
         centered modal, so `100dvh - 150px` (reserving the trigger's offset
         from the top plus a margin) leaves room for the dropdown to open below
         without running off-screen; the `min()` keeps 579px as the ceiling on
         tall windows. ember-power-select then still renders below and the inner
         list scrolls for the overflow.

         Two caps must be clamped together: the outer dropdown container clips
         via --boxel-select-max-height (default 12.5rem) + overflow:hidden, and
         the inner scrollable options list is capped by ember-power-select's own
         `.ember-power-select-options[role="listbox"] { max-height: 12.25em }`
         default, which wins the cascade over boxel's var-driven rule — so the
         list must be overridden directly (a CSS var does nothing here). The
         compound dropdown class + descendant options selector out-specifies the
         ember-power-select default. */
      .markdown-embed-preview-pane__format-dropdown {
        --boxel-select-max-height: min(579px, calc(100dvh - 150px));
      }

      .boxel-select__dropdown.markdown-embed-preview-pane__format-dropdown
        .ember-power-select-options {
        max-height: min(579px, calc(100dvh - 150px));
      }

      /* Denser rows: tighten the boxel-ui per-option padding and drop the
         default inter-row margin. The compound class (the dropdown element
         carries both classes) beats boxel-ui's 2-class default rule. Divider
         rows re-add a small margin below. */
      .boxel-select__dropdown.markdown-embed-preview-pane__format-dropdown
        .ember-power-select-option {
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
        margin-bottom: 0;
      }

      /* The divider sits in the gap *between* options so the row's hover /
         selected background (painted inside the <li>'s border-box) can't
         engulf it. The dropdown is rendered in the basic-dropdown wormhole,
         so :deep() — which requires a scoped ancestor — can't reach it;
         :global() with this component's unique class names is the correct
         escape hatch. The trigger has no .ember-power-select-option
         ancestor, so the divider is automatically suppressed there. */
      .boxel-select__dropdown.markdown-embed-preview-pane__format-dropdown
        .ember-power-select-option:has(
          .markdown-embed-preview-pane__format-option.has-divider
        ) {
        position: relative;
        margin-bottom: var(--boxel-sp-xxs);
      }

      .boxel-select__dropdown.markdown-embed-preview-pane__format-dropdown
        .ember-power-select-option:has(
          .markdown-embed-preview-pane__format-option.has-divider
        )::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: calc(-1 * var(--boxel-sp-xxs) / 2 - 0.5px);
        height: 1px;
        background-color: var(--boxel-border-color);
        pointer-events: none;
      }
    </style>
    <style scoped>
      .markdown-embed-preview-pane {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        /* Inherit the preview column's off-white surface; the inner card
           viewport supplies its own background. */
        background-color: transparent;
      }
      .markdown-embed-preview-pane__header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp-sm) var(--boxel-sp) var(--boxel-sp-xs);
      }
      .markdown-embed-preview-pane__viewport {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp);
        overflow: auto;
        background-color: var(--boxel-100);
      }
      .markdown-embed-preview-pane__format-select {
        flex: 1 1 auto;
        min-width: 0;
        max-width: 330px;
        --boxel-select-trigger-padding: var(--boxel-sp-2xs);
      }
      .markdown-embed-preview-pane__format-option-name {
        font-weight: 500;
      }
      .markdown-embed-preview-pane__size {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        --boxel-input-icon-size: fit-content;
      }
      .markdown-embed-preview-pane__size-input {
        --boxel-input-height: 30px;
        --boxel-input-width: 46px;
        padding: var(--boxel-sp-4xs);
        text-align: center;
      }
      .markdown-embed-preview-pane__size-input :deep(.boxel-input) {
        padding: 0;
        text-align: center;
        font: 600 var(--boxel-font-sm);
      }
      .markdown-embed-preview-pane__size-x {
        width: 0.5rem;
        height: 0.5rem;
        flex: 0 0 auto;
        --icon-color: var(--boxel-dark);
      }
      .markdown-embed-preview-pane__footer {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp) var(--boxel-sp);
      }
      .markdown-embed-preview-pane__cta {
        --boxel-button-padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
        font-weight: 600;
      }
    </style>
  </template>
}
