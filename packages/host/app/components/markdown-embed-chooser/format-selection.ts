import { tracked } from '@glimmer/tracking';

import {
  type FittedFormatId,
  type FittedFormatSpec,
  FITTED_FORMAT_SIZES,
  fittedFormatById,
} from '@cardstack/boxel-ui/helpers';

import {
  parseBfmSizeSpec,
  serializeBfmSizeSpec,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

export type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';
type FormatCategory = 'atom' | 'embedded' | 'fitted' | 'isolated' | 'custom';
export type OptionValue =
  | 'atom'
  | 'embedded'
  | 'isolated'
  | FittedFormatId
  | 'custom';

export interface FormatOption {
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
export function buildFormatOptions(): FormatOption[] {
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

export interface FormatSelectionSeeds {
  format?: OptionValue;
  width?: number | string;
  height?: number;
  kind?: 'inline' | 'block';
}

function normalizeSizeSpec(
  input: BfmSizeSpec | string | undefined,
): BfmSizeSpec | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') {
    return parseBfmSizeSpec(input) ?? undefined;
  }
  return input;
}

// Translates the BFM directive being edited (its size specifier + `::`/`:`
// placement) into the seed state for a fresh `EmbedFormatSelection`. The
// directive's explicit placement always wins over the format's default so the
// edited embed round-trips its inline/block nature.
export function deriveFormatSeeds(
  sizeSpec: BfmSizeSpec | string | undefined,
  kind?: 'inline' | 'block',
): FormatSelectionSeeds {
  let spec = normalizeSizeSpec(sizeSpec);
  if (!spec) {
    // Size-less directive. The renderer defaults a block embed to `embedded`
    // and an inline embed to `atom`, so seed the format the directive actually
    // renders as — this preserves `::card[url]` as a block embed instead of
    // silently collapsing it to an inline atom.
    if (kind === 'block') {
      return { format: 'embedded', kind: 'block' };
    }
    return { kind: kind ?? 'inline' };
  }
  let seeds: FormatSelectionSeeds;
  switch (spec.format) {
    case 'atom':
      seeds = { format: 'atom', kind: 'inline' };
      break;
    case 'embedded':
      seeds = { format: 'embedded', kind: 'block' };
      break;
    case 'isolated':
      seeds = { format: 'isolated', kind: 'block' };
      break;
    default:
      // Fitted with optional W×H.
      seeds = {
        format: 'custom',
        width: spec.width,
        height: spec.height,
        kind: 'block',
      };
  }
  if (kind) {
    seeds.kind = kind;
  }
  return seeds;
}

// The format/placement/size choice for a markdown embed, lifted out of the
// preview pane so a single instance can be shared across the chooser's Cards
// and Files tabs — switching tabs keeps the user's format selection (the pane
// is per-tab and would otherwise reset to atom). The modal owns one instance
// per chooser request; both tab panels' panes read and mutate it.
export default class EmbedFormatSelection {
  readonly formatOptions: FormatOption[] = buildFormatOptions();

  // Atom is the default on first selection; atom is inline-only (see below).
  @tracked selectedValue: OptionValue = 'atom';
  @tracked kind: 'inline' | 'block' = 'inline';
  // Raw input strings so a partially-typed value (e.g. while clearing) doesn't
  // throw away the user's keystrokes. `%` widths are preserved verbatim.
  @tracked widthInput = '';
  @tracked heightInput = '';

  // Frozen snapshot of the seeded state, captured once on construction from the
  // edit-mode preload. `isDirty` compares against it so the parent can flip the
  // CTA between DONE and ACCEPT.
  private initialSelectedValue: OptionValue;
  private initialKind: 'inline' | 'block';
  private initialWidthInput: string;
  private initialHeightInput: string;

  constructor(seeds: FormatSelectionSeeds = {}) {
    if (seeds.format !== undefined) {
      this.selectedValue = seeds.format;
    }
    if (seeds.kind !== undefined) {
      this.kind = seeds.kind;
    } else if (seeds.format !== undefined) {
      // Mirror `selectFormat`'s placement default (atom → inline, sized →
      // block) when no explicit kind is supplied.
      let cat = this.formatOptions.find(
        (o) => o.value === seeds.format,
      )?.category;
      this.kind = cat === 'atom' ? 'inline' : 'block';
    }
    if (seeds.width !== undefined) {
      this.widthInput = String(seeds.width);
    }
    if (seeds.height !== undefined) {
      this.heightInput = String(seeds.height);
    }
    this.initialSelectedValue = this.selectedValue;
    this.initialKind = this.kind;
    this.initialWidthInput = this.widthInput;
    this.initialHeightInput = this.heightInput;
  }

  get selectedOption(): FormatOption {
    return (
      this.formatOptions.find((o) => o.value === this.selectedValue) ??
      this.formatOptions[0]
    );
  }

  get category(): FormatCategory {
    return this.selectedOption.category;
  }

  get showSizeInputs(): boolean {
    return this.category === 'fitted' || this.category === 'custom';
  }

  // The preview renders the selected format in the chosen placement; format and
  // inline/block are independent (every format works in both modes).
  get previewFormat(): EmbedFormat {
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
  get width(): number | string | undefined {
    let v = this.widthInput.trim();
    if (/^\d+%$/.test(v)) return v;
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    return undefined;
  }

  get height(): number | undefined {
    let v = this.heightInput.trim();
    return /^\d+$/.test(v) ? parseInt(v, 10) : undefined;
  }

  get sizeSpec(): BfmSizeSpec | undefined {
    if (!this.showSizeInputs) {
      return undefined;
    }
    return { format: 'fitted', width: this.width, height: this.height };
  }

  get categoryLabel(): string {
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

  // Size specifier for the chosen format. Atom is the default for inline
  // placement, so an inline atom embed emits the size-less `:card[url]`;
  // every other combination carries an explicit specifier so the rendered
  // format matches the user's choice unambiguously.
  get sizeSpecifier(): string | undefined {
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

  // True once any format/placement/size field has diverged from the seeded
  // snapshot. Target identity (the user swapped in a different card/file) is
  // tracked separately by the tab panel, which owns the resolved target.
  get isDirty(): boolean {
    return (
      this.selectedValue !== this.initialSelectedValue ||
      this.kind !== this.initialKind ||
      this.widthInput !== this.initialWidthInput ||
      this.heightInput !== this.initialHeightInput
    );
  }

  selectFormat = (option: FormatOption) => {
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
  };

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

  setWidth = (value: string) => {
    this.widthInput = value;
    this.syncVariantFromSize();
  };

  setHeight = (value: string) => {
    this.heightInput = value;
    this.syncVariantFromSize();
  };

  setKind = (kind: 'inline' | 'block') => {
    this.kind = kind;
  };
}
