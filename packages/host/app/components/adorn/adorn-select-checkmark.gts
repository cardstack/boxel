import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
      <path
        d='M6.5 10.5L8.5 12.5L13.5 7.5'
        stroke='var(--adorn-accent-light)'
        stroke-width='1.5'
        stroke-linecap='round'
        stroke-linejoin='round'
      />
    </svg>
  </template>;
