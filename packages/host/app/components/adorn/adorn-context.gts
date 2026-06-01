import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { hash } from '@ember/helper';

// AdornContext: the entry point for the Adorn visual treatment.
// Wraps the consumer's outer container of Adorn-decorated items
// (the operator-mode overlay row, the search-results list, the card-
// chooser grid) in a layout-transparent (`display: contents`) div
// that:
//
//   - Declares the Adorn color tokens (`--adorn-accent-light`,
//     `--adorn-accent`) so descendant Adorn primitives pick them up
//     by inheritance without polluting the global stylesheet.
//   - Provides the hover / selection outline rules. Any descendant
//     that carries the stroke class gets the standard 2px teal hover,
//     4px selected, darker teal selected+hover treatment (the rules
//     respond to both `:hover` and an explicit `.hovered` class so
//     consumers that drive hover from JS can opt in too).
//   - Resolves the bounding region for dynamic label positioning via
//     the yielded `getBoundaryElement` function. Given any descendant,
//     it returns the visible container that bounds label growth (see
//     the function below).
//
// The stroke class and the boundary resolver are yielded as a
// block-param hash (`strokeClass`, `getBoundaryElement`) so consumers
// go through AdornContext rather than hard-coding its internal class
// names or duplicating the boundary walk.
//
// Mount AdornContext as a child of whatever visible element should
// bound label growth (operator-mode mounts it inside the stack
// item's content area; the search results pane mounts it inside the
// search-sheet content; the card chooser inside the catalog modal).
// Then render `<AdornLabel>` / `<AdornSelectChip>` directly inside
// each item.
//
// Usage:
//
//   <div class='outer-container'>
//     <AdornContext as |adorn|>
//       {{#each cards as |card|}}
//         <div class={{cn 'my-card' adorn.strokeClass selected=card.selected}}>
//           <AdornLabel><:text>{{card.typeName}}</:text></AdornLabel>
//           <AdornSelectChip @selected={{card.selected}} />
//         </div>
//       {{/each}}
//     </AdornContext>
//   </div>

// Given any descendant of an AdornContext, return the visible region
// that bounds Adorn label growth: the parent of the nearest context
// wrapper. AdornContext renders as `display: contents`, so its own
// rect is empty — its parent is the element the consumer mounted it
// inside, which is the region we want. Yielded to consumers so the
// `.adorn-context` marker stays an implementation detail of this
// component.
function getBoundaryElement(el: HTMLElement): HTMLElement | null {
  let marker = el.closest<HTMLElement>('.adorn-context');
  return marker?.parentElement ?? null;
}

interface AdornContextSignature {
  Element: HTMLDivElement;
  Blocks: {
    default: [
      {
        strokeClass: string;
        getBoundaryElement: (el: HTMLElement) => HTMLElement | null;
      },
    ];
  };
}

const AdornContext: TemplateOnlyComponent<AdornContextSignature> = <template>
  <div class='adorn-context' ...attributes>
    {{yield
      (hash strokeClass='adorn-stroke' getBoundaryElement=getBoundaryElement)
    }}
  </div>
  <style scoped>
    /* `display: contents` so the wrapper is not visually
       represented; the CSS variables and `:deep()` rules below still
       attach to this element and cascade / match against descendants
       normally. This element is also the marker `getBoundaryElement`
       walks up to; its parent's `getBoundingClientRect()` defines
       where the label may extend. */
    .adorn-context {
      display: contents;

      /* Token definitions live with the context, not in the global
         stylesheet. --boxel-teal is the light accent shipped by
         boxel-ui; the darker accent is exclusive to the Adorn
         treatment and used when both hovered and selected. */
      --adorn-accent-light: var(--boxel-teal);
      --adorn-accent: #00da9f;
    }
    /* Stroke utility. The consumer applies `.adorn-stroke` to
       whichever descendant should carry the outline (typically the
       card-like element itself), then drives `.selected` and either
       the `:hover` pseudo-class or a `.hovered` class. */
    .adorn-context :deep(.adorn-stroke:hover:not(.selected)),
    .adorn-context :deep(.adorn-stroke.hovered:not(.selected)) {
      box-shadow: 0 0 0 2px var(--adorn-accent-light);
    }
    .adorn-context :deep(.adorn-stroke.selected) {
      box-shadow: 0 0 0 4px var(--adorn-accent-light);
    }
    .adorn-context :deep(.adorn-stroke.selected:hover),
    .adorn-context :deep(.adorn-stroke.selected.hovered) {
      box-shadow: 0 0 0 4px var(--adorn-accent);
    }
  </style>
</template>;

export default AdornContext;
