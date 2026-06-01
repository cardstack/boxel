import type { TemplateOnlyComponent } from '@ember/component/template-only';

// AdornSelectChip: small teal rounded-square selection chip shown at
// the bottom-right corner of an Adorn-treated card. Renders an
// unfilled circle outline by default and a filled-with-check icon
// when `@selected` is true.
//
// `@compact` shrinks the chip + icon for narrow containers (atom-
// format cards in operator-mode).
//
// Positioning and interactivity are the consumer's responsibility:
// operator-mode wraps the chip in a button so it can be clicked to
// toggle selection; purely-decorative consumers (search results,
// card chooser) mount it as-is.
export interface AdornSelectChipSignature {
  Args: {
    selected?: boolean;
    compact?: boolean;
  };
  Element: HTMLSpanElement;
}

const AdornSelectChip: TemplateOnlyComponent<AdornSelectChipSignature> =
  <template>
    <span class='adorn-select-chip {{if @compact "compact"}}' ...attributes>
      {{#if @selected}}
        <svg
          class='adorn-select-icon'
          viewBox='0 0 14 14'
          fill='none'
          aria-hidden='true'
        >
          <circle cx='7' cy='7' r='7' fill='#0a2e1c' />
          <path
            d='M3.5 7.5L5.5 9.5L10.5 4.5'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
            stroke-linejoin='round'
          />
        </svg>
      {{else}}
        <svg
          class='adorn-select-icon'
          viewBox='-1 -1 16 16'
          fill='none'
          aria-hidden='true'
        >
          <circle cx='7' cy='7' r='6.5' stroke='#0a2e1c' stroke-width='1.5' />
        </svg>
      {{/if}}
    </span>
    <style scoped>
      .adorn-select-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 3px;
        border-radius: 5px;
        /* Chip-specific token so the chip can be themed independently
           of the label — reading the label's `--adorn-label-bg` here
           would let a label-selection override (operator-mode sets it
           to the darker accent) bleed into the chip. */
        background: var(--adorn-chip-bg, var(--adorn-accent-light));
        color: var(--adorn-accent-light);
        z-index: 1;
      }
      .adorn-select-chip.compact {
        width: 16px;
        height: 16px;
        padding: 2px;
      }
      .adorn-select-icon {
        display: block;
        width: 14px;
        height: 14px;
      }
      .adorn-select-chip.compact .adorn-select-icon {
        width: 12px;
        height: 12px;
      }
    </style>
  </template>;

export default AdornSelectChip;
