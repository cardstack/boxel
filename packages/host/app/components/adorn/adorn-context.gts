import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
//     that carries the `.adorn-stroke` class gets the standard 2px
//     teal hover, 4px selected, darker teal selected+hover treatment
//     (the rules respond to both `:hover` and an explicit `.hovered`
//     class so consumers that drive hover from JS can opt in too).
//   - Marks the bounding region for dynamic label positioning. The
//     `<AdornLabel>` component's overflow-tracking modifier finds
//     the closest enclosing `.adorn-context` and uses that
//     element's bounding rect as the boundary the label must stay
//     inside.
//
// Consumers wrap a list of adornable items once and render
// `<AdornLabel>` / `<AdornSelectChip>` directly inside each item.
//
// Usage:
//
//   <AdornContext>
//     {{#each cards as |card|}}
//       <div class={{cn 'my-card adorn-stroke' selected=card.selected}}>
//         <AdornLabel><:text>{{card.typeName}}</:text></AdornLabel>
//         <AdornSelectChip @selected={{card.selected}} />
//       </div>
//     {{/each}}
//   </AdornContext>
interface AdornContextSignature {
  Element: HTMLDivElement;
  Blocks: {
    default: [];
  };
}

const AdornContext: TemplateOnlyComponent<AdornContextSignature> = <template>
  <div class='adorn-context' ...attributes>
    {{yield}}
  </div>
  <style scoped>
    /* `display: contents` so the wrapper is not visually
       represented; the CSS variables and `:deep()` rules below still
       attach to this element and cascade / match against descendants
       normally. The element is also the boundary that
       trackLabelOverflow reads (via `cardEl.closest('.adorn-context')`)
       so its `getBoundingClientRect()` defines where the label may
       extend. */
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
