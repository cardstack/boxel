import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { CheckMark } from '@cardstack/boxel-ui/icons';

// The Adorn selection-chip artwork as standalone Icon components, so the
// selection control can be a shared boxel-ui ContextButton: the consumer
// passes the empty variant when unselected and the checked variant when
// selected via `@icon`, and ContextButton supplies the button chrome
// (standard sizing, toggle / aria-pressed, hover background).
//
// Both are two-color composites (teal chip background, highlight-foreground
// circle, teal check), so — like boxel-ui's SelectionCheckmark — they read
// their colors from CSS variables rather than `currentColor`. The chip
// background honors `--adorn-chip-bg` (falling back to the inherited
// `--adorn-accent-light`) so it can be themed independently of the label,
// matching the original AdornSelectChip. They are authored as
// `TemplateOnlyComponent`s whose root is an `<svg>`, so they satisfy the
// boxel-ui `Icon` type (`ComponentLike<{ Element: SVGSVGElement }>`) where
// passed to `@icon`.
interface Signature {
  Element: SVGSVGElement;
}

// Empty (unselected): teal rounded-square chip with a hollow circle.
export const AdornCheckmarkEmpty: TemplateOnlyComponent<Signature> = <template>
  <svg
    viewBox='0 0 20 20'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    ...attributes
  >
    <rect
      width='20'
      height='20'
      rx='5'
      fill='var(--adorn-chip-bg, var(--adorn-accent-light))'
    />
    <circle
      cx='10'
      cy='10'
      r='6.5'
      stroke='var(--boxel-highlight-foreground)'
      stroke-width='1.5'
    />
  </svg>
</template>;

// Selected: teal rounded-square chip with a filled circle and teal check.
export const AdornCheckmarkSelected: TemplateOnlyComponent<Signature> =
  <template>
    <svg
      class='adorn-checkmark-selected'
      viewBox='0 0 20 20'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      ...attributes
    >
      <rect
        width='20'
        height='20'
        rx='5'
        fill='var(--adorn-chip-bg, var(--adorn-accent-light))'
      />
      <circle cx='10' cy='10' r='7' fill='var(--boxel-highlight-foreground)' />
      <CheckMark x='6' y='6' width='8' height='8' />
    </svg>
    <style scoped>
      /* Tint the nested CheckMark glyph; the chip and circle keep their fills. */
      .adorn-checkmark-selected {
        --icon-color: var(--adorn-accent-light);
      }
    </style>
  </template>;
