import type { TemplateOnlyComponent } from '@ember/component/template-only';

// AdornSelectChip: the small teal rounded-square selection chip shown
// at the bottom-right corner of an Adorn-treated card. Renders an
// unfilled circle outline by default and a filled-with-check icon
// when `@selected` is true. Positioning + interactivity are the
// caller's responsibility: operator-mode wraps the chip in a button
// so it can be clicked to toggle selection, while purely-decorative
// callers can mount it as-is.
interface AdornSelectChipSignature {
  Args: {
    selected?: boolean;
  };
  Element: HTMLSpanElement;
}

const AdornSelectChip: TemplateOnlyComponent<AdornSelectChipSignature> =
  <template>
    <span class='adorn-select-chip' ...attributes>
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
      :global(.adorn-select-chip) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 3px;
        border-radius: 5px;
        background: var(--adorn-label-bg, var(--adorn-accent-light));
        color: var(--adorn-accent-light);
        z-index: 1;
      }
      :global(.adorn-select-icon) {
        display: block;
        width: 14px;
        height: 14px;
      }
    </style>
  </template>;

export default AdornSelectChip;
