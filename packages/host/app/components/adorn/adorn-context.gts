import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';

import AdornLabel, { type AdornLabelSignature } from './adorn-label';
import AdornSelectChip, {
  type AdornSelectChipSignature,
} from './adorn-select-chip';

import type { ComponentLike } from '@glint/template';

// AdornContext: the entry point for the Adorn visual treatment.
// Wraps the consumer's markup in a transparent (display:contents)
// container that:
//
//   - Declares the Adorn color tokens (`--adorn-accent-light`,
//     `--adorn-accent`) so descendant Adorn primitives pick them up
//     by inheritance without polluting the global stylesheet.
//   - Provides the hover / selection outline rules. Any descendant
//     that carries the `.adorn-stroke` class gets the standard 2px
//     teal hover, 4px selected, darker teal selected+hover treatment
//     (the rules respond to both `:hover` and an explicit `.hovered`
//     class so consumers driving hover from JS can opt in too).
//   - Yields `{ Label, SelectChip }` — component references already
//     curried with `@compact`, so the consumer can render them
//     without re-passing the context's compactness.
//
// Usage:
//
//   <AdornContext @compact={{isCompact}} as |adorn|>
//     <div class={{cn 'my-card adorn-stroke' selected=isSelected}}>
//       <adorn.Label>
//         <:text>{{cardTypeName}}</:text>
//       </adorn.Label>
//       <adorn.SelectChip @selected={{isSelected}} />
//     </div>
//   </AdornContext>
interface AdornContextSignature {
  Args: {
    compact?: boolean;
  };
  Blocks: {
    default: [
      {
        Label: ComponentLike<AdornLabelSignature>;
        SelectChip: ComponentLike<AdornSelectChipSignature>;
      },
    ];
  };
}

const AdornContext: TemplateOnlyComponent<AdornContextSignature> = <template>
  <div class='adorn-context'>
    {{yield
      (hash
        Label=(component AdornLabel compact=@compact)
        SelectChip=(component AdornSelectChip compact=@compact)
      )
    }}
  </div>
  <style scoped>
    /* `display: contents` so the wrapper is not visually
       represented; the CSS variables and `:deep()` rules below still
       attach to this element and cascade / match against descendants
       normally. */
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
       the `:hover` pseudo-class or a `.hovered` class. Using
       `:deep()` to reach the descendant keeps the rules encapsulated
       to AdornContext — they only fire inside its subtree. */
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
