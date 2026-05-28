import type { TemplateOnlyComponent } from '@ember/component/template-only';

// AdornLabel: the teal "flag tab" type-label used by the Adorn hover
// treatment. Renders only the outer shaped chip; the caller yields
// the inner content (typically `.adorn-label-icon`,
// `.adorn-label-text`, and an optional `.adorn-label-dropdown` for
// an in-tab menu) and is responsible for positioning the label and
// for driving the `data-side` attribute when flipping below the card.
//
// The visual styling (flag clip-path, colors, drop-shadow, the inner
// `.adorn-label-*` content-class rules) lives in `app/styles/app.css`
// alongside the other Adorn primitives, so consumers can place
// children with those class names and the rules apply.
interface AdornLabelSignature {
  Element: HTMLDivElement;
  Blocks: {
    default: [];
  };
}

const AdornLabel: TemplateOnlyComponent<AdornLabelSignature> = <template>
  <div class='adorn-label' ...attributes>
    {{yield}}
  </div>
</template>;

export default AdornLabel;
