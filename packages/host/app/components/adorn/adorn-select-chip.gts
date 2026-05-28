import type { TemplateOnlyComponent } from '@ember/component/template-only';

// AdornSelectChip: the small teal rounded-square selection chip shown
// at the bottom-right corner of an Adorn-treated card. Renders an
// unfilled circle outline by default and a filled-with-check icon
// when `@selected` is true. Positioning + interactivity are the
// caller's responsibility: operator-mode wraps the chip in a button
// so it can be clicked to toggle selection; purely-decorative callers
// (e.g. the card chooser) mount it as-is.
//
// The visual styling for `.adorn-select-chip` and `.adorn-select-icon`
// lives in `app/styles/app.css`.
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
  </template>;

export default AdornSelectChip;
