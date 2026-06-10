import type { TemplateOnlyComponent } from '@ember/component/template-only';

import CheckMark from '../../icons/check-mark.gts';

// SelectionCheckmark: the dark-circle-with-highlight-check artwork used by
// selection affordances — the SelectionMenu trigger and its inert count
// header, and the card-header utility-menu trigger. The circle reads as the
// highlight foreground and the check as the highlight accent, so it stands
// out against a highlight-colored surface. It is a two-color composite (not
// a monochrome, currentColor icon), so it lives here as a component rather
// than in the generated icon set.
//
// The tick is the shared CheckMark glyph (nested as its own viewport, tinted
// via --icon-color) rather than a hand-rolled path, so every checkmark across
// the host UI chrome — menu items, checkboxes, and this pill — is the same
// glyph; only the surrounding chrome (circle vs. square) differs.
const SelectionCheckmark: TemplateOnlyComponent<{
  Element: SVGSVGElement;
}> = <template>
  <svg
    class='selection-checkmark'
    viewBox='0 0 14 14'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    ...attributes
  >
    <circle cx='7' cy='7' r='7' fill='var(--boxel-highlight-foreground)' />
    <CheckMark x='3' y='3' width='8' height='8' />
  </svg>
  <style scoped>
    /* Tint the nested CheckMark glyph; the circle keeps its own fill. */
    .selection-checkmark {
      --icon-color: var(--boxel-highlight);
    }
  </style>
</template>;

export default SelectionCheckmark;
