import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  BoxelInput,
  BoxelSelect,
  Button,
} from '@cardstack/boxel-ui/components';
import {
  type FittedFormatId,
  type FittedFormatSpec,
  FITTED_FORMAT_SIZES,
  fittedFormatById,
} from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import {
  serializeBfmRef,
  serializeBfmSizeSpec,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import type { CardDef, FileDef } from 'https://cardstack.com/base/card-api';

import PlacementToggle from './placement-toggle';
import MarkdownEmbedPreview from './preview';

type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';
type FormatCategory = 'atom' | 'embedded' | 'fitted' | 'isolated' | 'custom';
export type OptionValue =
  | 'atom'
  | 'embedded'
  | 'isolated'
  | FittedFormatId
  | 'custom';

interface FormatOption {
  value: OptionValue;
  formatLabel: string;
  sizeLabel: string;
  category: FormatCategory;
  dividerAfter?: boolean;
}

// Flat dropdown list (no group headers): Atom, Embedded, Isolated, every
// Fitted variant, then Custom — matching the designer's dropdown. `Custom`
// is labelled `Fitted - Custom size` for grouping but is its own CTA
// category. Every option works in both inline and block placement.
function buildFormatOptions(): FormatOption[] {
  let options: FormatOption[] = [
    {
      value: 'atom',
      formatLabel: 'Atom',
      sizeLabel: 'Variable size',
      category: 'atom',
      dividerAfter: true,
    },
    {
      value: 'embedded',
      formatLabel: 'Embedded',
      sizeLabel: 'Variable size',
      category: 'embedded',
      dividerAfter: true,
    },
    {
      value: 'isolated',
      formatLabel: 'Isolated',
      sizeLabel: 'Variable size',
      category: 'isolated',
      dividerAfter: true,
    },
  ];
  for (let spec of FITTED_FORMAT_SIZES) {
    options.push({
      value: spec.id,
      formatLabel: 'Fitted',
      sizeLabel: `${spec.title} (${spec.width}x${spec.height})`,
      category: 'fitted',
    });
  }
  options.push({
    value: 'custom',
    formatLabel: 'Fitted',
    sizeLabel: 'Custom size',
    category: 'custom',
  });
  return options;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    // Resolved instance being previewed. Its `id` is the BFM ref URL. May be
    // undefined when the chooser is open but the user hasn't picked a row yet;
    // the pane keeps the format/W×H controls visible (disabled CTA) so the
    // layout doesn't jump when a target arrives.
    target?: CardDef | FileDef;
    // Which BFM keyword to emit: `:card[...]` vs `:file[...]`.
    refType: 'card' | 'file';
    // Receives the serialized BFM directive when the CTA is clicked. The host
    // owns actual cursor insertion (a later ticket).
    onInsert: (bfm: string) => void;
    // Edit-mode preload: seed the format dropdown, W×H inputs, and placement
    // toggle from the BFM directive the user is editing. Read once at
    // construction; later updates are ignored so the pane is free to mutate
    // its own state as the user edits.
    initialFormat?: OptionValue;
    initialWidth?: number | string;
    initialHeight?: number;
    initialKind?: 'inline' | 'block';
    // Fired with `true` once the pane's state diverges from the initial
    // preload (and back to `false` if it matches again). The parent uses this
    // to flip the CTA label between 'DONE' and 'ACCEPT' in edit mode.
    onDirtyChange?: (dirty: boolean) => void;
    // Overrides the dynamic "Insert as …" CTA label. Used in edit mode to
    // show 'DONE' (clean) or 'ACCEPT' (dirty) per the design spec.
    ctaLabelOverride?: string;
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

  // Frozen snapshot of the initial pane state, captured once on mount from the
  // edit-mode preload args. Used by `dirty` to detect divergence so the parent
  // can flip the CTA between DONE and ACCEPT.
  private initialSelectedValue: OptionValue;
  private initialKind: 'inline' | 'block';
  private initialWidthInput: string;
  private initialHeightInput: string;
  private initialTargetUrl: string | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    if (args.initialFormat !== undefined) {
      this.selectedValue = args.initialFormat;
    }
    if (args.initialKind !== undefined) {
      this.kind = args.initialKind;
    } else if (args.initialFormat !== undefined) {
      // Mirror `selectFormat`'s placement default (atom → inline, sized →
      // block) when no explicit initial kind is supplied.
      let cat = this.formatOptions.find(
        (o) => o.value === args.initialFormat,
      )?.category;
      this.kind = cat === 'atom' ? 'inline' : 'block';
    }
    if (args.initialWidth !== undefined) {
      this.widthInput = String(args.initialWidth);
    }
    if (args.initialHeight !== undefined) {
      this.heightInput = String(args.initialHeight);
    }
    this.initialSelectedValue = this.selectedValue;
    this.initialKind = this.kind;
    this.initialWidthInput = this.widthInput;
    this.initialHeightInput = this.heightInput;
    this.initialTargetUrl = args.target?.id;
  }

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
      case 'isolated':
        return 'isolated';
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
      case 'isolated':
        return 'Isolated';
      case 'custom':
        return 'Custom';
      case 'fitted':
      default:
        return 'Fitted';
    }
  }

  private get ctaLabel(): string {
    if (this.args.ctaLabelOverride !== undefined) {
      return this.args.ctaLabelOverride;
    }
    return `Insert as ${this.categoryLabel}`;
  }

  // True once any tracked piece of state (format, placement, W×H, or the
  // resolved target URL) has diverged from the constructor snapshot. The
  // parent watches via `onDirtyChange` to drive its CTA label.
  get isDirty(): boolean {
    return (
      this.selectedValue !== this.initialSelectedValue ||
      this.kind !== this.initialKind ||
      this.widthInput !== this.initialWidthInput ||
      this.heightInput !== this.initialHeightInput ||
      (this.args.target?.id ?? undefined) !== this.initialTargetUrl
    );
  }

  // Re-runs on every render. Auto-tracking re-evaluates `isDirty` whenever any
  // of its dependencies changes; the equality guard keeps onDirtyChange from
  // firing on every render in addition to genuine transitions.
  private lastReportedDirty: boolean | undefined;
  private reportDirty = () => {
    let dirty = this.isDirty;
    if (dirty !== this.lastReportedDirty) {
      this.lastReportedDirty = dirty;
      this.args.onDirtyChange?.(dirty);
    }
  };

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
      case 'isolated':
        return 'isolated';
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
    let url = this.args.target?.id;
    if (!url) {
      return '';
    }
    return serializeBfmRef(this.args.refType, url, {
      kind: this.kind,
      size: this.sizeSpecifier,
    });
  }

  private get isCtaDisabled(): boolean {
    return !this.args.target?.id;
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
    let bfm = this.bfmString;
    if (!bfm) return;
    this.args.onInsert(bfm);
  }

  <template>
    {{this.reportDirty}}
    <section
      class='markdown-embed-preview-pane'
      data-test-markdown-embed-preview-pane
      ...attributes
    >
      <div class='markdown-embed-preview-pane__header'>
        <BoxelSelect
          class='markdown-embed-preview-pane__format-select'
          @dropdownClass='markdown-embed-preview-pane__format-dropdown'
          @options={{this.formatOptions}}
          @selected={{this.selectedOption}}
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
        {{#if @target}}
          <MarkdownEmbedPreview
            @target={{@target}}
            @format={{this.previewFormat}}
            @sizeSpec={{this.sizeSpec}}
            @kind={{this.kind}}
            @showSurroundingText={{true}}
          />
        {{else}}
          <p
            class='markdown-embed-preview-pane__empty'
            data-test-markdown-embed-preview-empty
          >
            Pick a
            {{@refType}}
            to preview its embed.
          </p>
        {{/if}}
      </div>

      <footer class='markdown-embed-preview-pane__footer'>
        <PlacementToggle @selected={{this.kind}} @onChange={{this.setKind}} />

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
            <IconX
              class='markdown-embed-preview-pane__size-x'
              aria-hidden='true'
            />
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
          @size='small'
          @disabled={{this.isCtaDisabled}}
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
      /* The divider sits in the gap *between* options so the row's hover /
         selected background (painted inside the <li>'s border-box) can't
         engulf it. The dropdown is rendered in the basic-dropdown wormhole,
         so :deep() — which requires a scoped ancestor — can't reach it;
         :global() with this component's unique class names is the correct
         escape hatch. The trigger has no .ember-power-select-option
         ancestor, so the divider is automatically suppressed there. */
      .markdown-embed-preview-pane__format-dropdown
        .ember-power-select-option:has(
          .markdown-embed-preview-pane__format-option.has-divider
        ) {
        position: relative;
        margin-bottom: var(--boxel-sp-xs);
      }

      .markdown-embed-preview-pane__format-dropdown
        .ember-power-select-option:has(
          .markdown-embed-preview-pane__format-option.has-divider
        )::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: calc(-1 * var(--boxel-sp-xs) / 2 - 0.5px);
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
        background-color: var(--boxel-light);
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
      .markdown-embed-preview-pane__empty {
        margin: 0;
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        text-align: center;
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
