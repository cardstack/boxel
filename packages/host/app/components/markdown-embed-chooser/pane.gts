import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  BoxelInput,
  BoxelSelect,
  Button,
} from '@cardstack/boxel-ui/components';
import {
  eq,
  type FittedFormatId,
  type FittedFormatSpec,
  FITTED_FORMAT_SIZES,
  fittedFormatById,
} from '@cardstack/boxel-ui/helpers';

import {
  serializeBfmRef,
  serializeBfmSizeSpec,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import type { CardDef, FileDef } from 'https://cardstack.com/base/card-api';

import MarkdownEmbedPreview from './preview';

type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';
type FormatCategory = 'atom' | 'embedded' | 'fitted' | 'custom';
type OptionValue = 'atom' | 'embedded' | FittedFormatId | 'custom';

interface FormatOption {
  value: OptionValue;
  label: string;
  category: FormatCategory;
}

// Flat dropdown list (no group headers): Atom, Embedded, every Fitted variant,
// then Custom — matching the designer's dropdown. `Custom` is labelled
// `Fitted - Custom size` for grouping but is its own CTA category.
function buildFormatOptions(): FormatOption[] {
  let options: FormatOption[] = [
    { value: 'atom', label: 'Atom - Variable size', category: 'atom' },
    {
      value: 'embedded',
      label: 'Embedded - Variable size',
      category: 'embedded',
    },
  ];
  for (let spec of FITTED_FORMAT_SIZES) {
    options.push({
      value: spec.id,
      label: `Fitted - ${spec.title} - ${spec.width}x${spec.height}`,
      category: 'fitted',
    });
  }
  options.push({
    value: 'custom',
    label: 'Fitted - Custom size',
    category: 'custom',
  });
  return options;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    // Resolved instance being previewed. Its `id` is the BFM ref URL.
    target: CardDef | FileDef;
    // Which BFM keyword to emit: `:card[...]` vs `:file[...]`.
    refType: 'card' | 'file';
    // Receives the serialized BFM directive when the CTA is clicked. The host
    // owns actual cursor insertion (a later ticket).
    onInsert: (bfm: string) => void;
  };
}

// Right-hand companion to the mini choosers: a live preview plus the controls
// that decide how a card/file embeds — format dropdown, always-on W×H inputs
// for Fitted (with smart variant matching), an Inline/Block toggle, and a
// dynamic "Insert as …" CTA.
export default class MarkdownEmbedPreviewPane extends Component<Signature> {
  private formatOptions: FormatOption[] = buildFormatOptions();

  // Atom is the default on first selection; atom is inline-only (see below).
  @tracked private selectedValue: OptionValue = 'atom';
  @tracked private kind: 'inline' | 'block' = 'inline';
  // Raw input strings so a partially-typed value (e.g. while clearing) doesn't
  // throw away the user's keystrokes. `%` widths are preserved verbatim.
  @tracked private widthInput = '';
  @tracked private heightInput = '';

  private get selectedOption(): FormatOption {
    return (
      this.formatOptions.find((o) => o.value === this.selectedValue) ??
      this.formatOptions[0]
    );
  }

  private get category(): FormatCategory {
    return this.selectedOption.category;
  }

  private get showSizeInputs(): boolean {
    return this.category === 'fitted' || this.category === 'custom';
  }

  // The preview renders the selected format in the chosen placement; format and
  // inline/block are independent (every format works in both modes).
  private get previewFormat(): EmbedFormat {
    switch (this.category) {
      case 'atom':
        return 'atom';
      case 'embedded':
        return 'embedded';
      default:
        return 'fitted';
    }
  }

  // px number, `%` string, or undefined for an unparseable/empty input.
  private get width(): number | string | undefined {
    let v = this.widthInput.trim();
    if (/^\d+%$/.test(v)) return v;
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    return undefined;
  }

  private get height(): number | undefined {
    let v = this.heightInput.trim();
    return /^\d+$/.test(v) ? parseInt(v, 10) : undefined;
  }

  private get sizeSpec(): BfmSizeSpec | undefined {
    if (!this.showSizeInputs) {
      return undefined;
    }
    return { format: 'fitted', width: this.width, height: this.height };
  }

  private get categoryLabel(): string {
    switch (this.category) {
      case 'atom':
        return 'Atom';
      case 'embedded':
        return 'Embedded';
      case 'custom':
        return 'Custom';
      case 'fitted':
      default:
        return 'Fitted';
    }
  }

  private get ctaLabel(): string {
    return `Insert as ${this.categoryLabel}`;
  }

  // Size specifier for the chosen format. Atom is the default for inline
  // placement, so an inline atom embed emits the size-less `:card[url]`;
  // every other combination carries an explicit specifier so the rendered
  // format matches the user's choice unambiguously.
  private get sizeSpecifier(): string | undefined {
    switch (this.category) {
      case 'atom':
        return this.kind === 'inline' ? undefined : 'atom';
      case 'embedded':
        return 'embedded';
      case 'fitted':
        return this.selectedValue;
      case 'custom':
        return serializeBfmSizeSpec({
          format: 'fitted',
          width: this.width,
          height: this.height,
        });
      default:
        return undefined;
    }
  }

  private get bfmString(): string {
    let url = this.args.target.id;
    return serializeBfmRef(this.args.refType, url, {
      kind: this.kind,
      size: this.sizeSpecifier,
    });
  }

  // An inline span carrying an embedded card has no intrinsic size to flow
  // with the surrounding text, so the preview collapses. Surface a hint so
  // the user understands why the preview is empty and how to recover.
  private get placementWarning(): string | undefined {
    if (this.kind !== 'inline') {
      return undefined;
    }
    if (this.category === 'embedded') {
      return 'Inline Embedded has no intrinsic width — pick a Fitted variant (or set custom W×H) to embed within a paragraph.';
    }
    if (this.category === 'custom' && !(this.width && this.height)) {
      return 'Set both width and height to render this inline embed.';
    }
    return undefined;
  }

  @action
  private selectFormat(option: FormatOption) {
    this.selectedValue = option.value;
    // Pick a sensible default placement for the format — atom reads as inline,
    // sized formats as block — but the toggle stays free, so the user can flip
    // either way afterward.
    this.kind = option.category === 'atom' ? 'inline' : 'block';
    if (option.category === 'fitted') {
      let spec = fittedFormatById.get(option.value as FittedFormatId);
      if (spec) {
        this.widthInput = String(spec.width);
        this.heightInput = String(spec.height);
      }
    }
  }

  // Bidirectional sync: editing either dimension re-points the dropdown to the
  // matching named variant, or to Custom when nothing matches exactly.
  private syncVariantFromSize() {
    let w = this.width;
    let h = this.height;
    if (typeof w === 'number' && typeof h === 'number') {
      let match = FITTED_FORMAT_SIZES.find(
        (s: FittedFormatSpec) => s.width === w && s.height === h,
      );
      this.selectedValue = match ? match.id : 'custom';
    } else {
      this.selectedValue = 'custom';
    }
  }

  @action
  private setWidth(value: string) {
    this.widthInput = value;
    this.syncVariantFromSize();
  }

  @action
  private setHeight(value: string) {
    this.heightInput = value;
    this.syncVariantFromSize();
  }

  @action
  private setKind(kind: 'inline' | 'block') {
    this.kind = kind;
  }

  @action
  private insert() {
    this.args.onInsert(this.bfmString);
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
          @options={{this.formatOptions}}
          @selected={{this.selectedOption}}
          @onChange={{this.selectFormat}}
          @searchEnabled={{false}}
          @matchTriggerWidth={{true}}
          data-test-markdown-embed-preview-format-select
          as |option|
        >
          <span data-test-format-option={{option.value}}>{{option.label}}</span>
        </BoxelSelect>
      </div>

      <div class='markdown-embed-preview-pane__viewport'>
        <MarkdownEmbedPreview
          @target={{@target}}
          @format={{this.previewFormat}}
          @sizeSpec={{this.sizeSpec}}
          @kind={{this.kind}}
          @showSurroundingText={{true}}
        />
      </div>

      {{#if this.placementWarning}}
        <p
          class='markdown-embed-preview-pane__warning'
          role='status'
          data-test-markdown-embed-preview-warning
        >
          {{this.placementWarning}}
        </p>
      {{/if}}

      <footer class='markdown-embed-preview-pane__footer'>
        <div
          class='markdown-embed-preview-pane__toggle'
          role='group'
          aria-label='Embed placement'
        >
          <button
            type='button'
            class='markdown-embed-preview-pane__toggle-option
              {{if (eq this.kind "inline") "is-active"}}'
            aria-pressed='{{if (eq this.kind "inline") "true" "false"}}'
            data-test-markdown-embed-preview-inline
            {{on 'click' (fn this.setKind 'inline')}}
          >
            Inline
          </button>
          <button
            type='button'
            class='markdown-embed-preview-pane__toggle-option
              {{if (eq this.kind "block") "is-active"}}'
            aria-pressed='{{if (eq this.kind "block") "true" "false"}}'
            data-test-markdown-embed-preview-block
            {{on 'click' (fn this.setKind 'block')}}
          >
            Block
          </button>
        </div>

        {{#if this.showSizeInputs}}
          <div
            class='markdown-embed-preview-pane__size'
            data-test-markdown-embed-preview-size
          >
            <BoxelInput
              class='markdown-embed-preview-pane__size-input'
              @value={{this.widthInput}}
              @onInput={{this.setWidth}}
              aria-label='Width'
              data-test-markdown-embed-preview-width
            />
            <span
              class='markdown-embed-preview-pane__size-x'
              aria-hidden='true'
            >×</span>
            <BoxelInput
              class='markdown-embed-preview-pane__size-input'
              @value={{this.heightInput}}
              @onInput={{this.setHeight}}
              aria-label='Height'
              data-test-markdown-embed-preview-height
            />
          </div>
        {{/if}}

        <Button
          @kind='primary'
          data-test-markdown-embed-preview-cta
          {{on 'click' this.insert}}
        >
          {{this.ctaLabel}}
        </Button>
      </footer>
    </section>
    <style scoped>
      .markdown-embed-preview-pane {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        background-color: var(--boxel-light);
      }
      .markdown-embed-preview-pane__header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        padding: var(--boxel-sp) var(--boxel-sp) var(--boxel-sp-xs);
      }
      .markdown-embed-preview-pane__viewport {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp);
        overflow: auto;
      }
      .markdown-embed-preview-pane__warning {
        flex: 0 0 auto;
        margin: 0 var(--boxel-sp) var(--boxel-sp-xxs);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--boxel-warning-100, var(--boxel-100));
        color: var(--boxel-warning-700, var(--boxel-600));
        font: var(--boxel-font-xs);
      }
      .markdown-embed-preview-pane__format-select {
        flex: 1 1 auto;
        min-width: 0;
      }
      .markdown-embed-preview-pane__size {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
      }
      .markdown-embed-preview-pane__size-input {
        width: 4rem;
        text-align: center;
      }
      .markdown-embed-preview-pane__size-x {
        color: var(--boxel-450);
      }
      .markdown-embed-preview-pane__footer {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp) var(--boxel-sp);
      }
      .markdown-embed-preview-pane__toggle {
        display: inline-flex;
        padding: 2px;
        border-radius: 999px;
        background-color: var(--boxel-light-200);
      }
      .markdown-embed-preview-pane__toggle-option {
        appearance: none;
        border: none;
        background: transparent;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        border-radius: 999px;
        font: var(--boxel-font-sm);
        font-weight: 600;
        color: var(--boxel-450);
        cursor: pointer;
      }
      .markdown-embed-preview-pane__toggle-option.is-active {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        box-shadow: var(--boxel-box-shadow);
      }
    </style>
  </template>
}
