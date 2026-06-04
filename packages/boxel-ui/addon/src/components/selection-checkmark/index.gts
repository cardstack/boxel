import type { TemplateOnlyComponent } from '@ember/component/template-only';

// SelectionCheckmark: the dark-circle-with-highlight-check artwork used by
// selection affordances — the SelectionMenu trigger and its inert count
// header, and the card-header utility-menu trigger. The circle reads as the
// highlight foreground and the check as the highlight accent, so it stands
// out against a highlight-colored surface. It is a two-color composite (not
// a monochrome, currentColor icon), so it lives here as a component rather
// than in the generated icon set.
const SelectionCheckmark: TemplateOnlyComponent<{
  Element: SVGSVGElement;
}> = <template>
  <svg
    viewBox='0 0 14 14'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    ...attributes
  >
    <circle cx='7' cy='7' r='7' fill='var(--boxel-highlight-foreground)' />
    <path
      d='M3.5 7.5L5.5 9.5L10.5 4.5'
      stroke='var(--boxel-highlight)'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
    />
  </svg>
</template>;

export default SelectionCheckmark;
