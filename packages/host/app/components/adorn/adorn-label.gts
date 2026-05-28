import type { TemplateOnlyComponent } from '@ember/component/template-only';

// AdornLabel: the teal "flag tab" type-label used by the Adorn hover
// treatment. The component renders only the outer shaped chip; the
// caller yields the inner content (typically `.adorn-label-icon`,
// `.adorn-label-text`, and an optional `.adorn-label-dropdown` for an
// in-tab menu) and is responsible for positioning the label and for
// driving the `data-side` attribute when flipping below the card.
//
// Background defaults to `var(--adorn-accent-light)` but can be
// overridden by setting `--adorn-label-bg` on any ancestor (operator-
// mode uses this to switch to the darker accent when the underlying
// card is selected).
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
  <style scoped>
    /* :global so this rule applies to the rendered .adorn-label div
       regardless of which consumer mounted it, and so consumers can
       safely use the inner-content class names on yielded children. */
    :global(.adorn-label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 12px 3px 7px;
      background: var(--adorn-label-bg, var(--adorn-accent-light));
      color: #0a2e1c;
      font: 700 10px/1 var(--boxel-font-family, inherit);
      letter-spacing: 0.5px;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      border-radius: 5px 0 0 5px;
      clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 100%, 0 100%);
      z-index: 1;
      filter: drop-shadow(0 5px 8px rgba(0, 0, 0, 0.2));
    }
    /* When the label flips below the card, mirror the polygon
       vertically so the slope still points toward the card edge. */
    :global(.adorn-label[data-side='bottom']) {
      clip-path: polygon(0 100%, calc(100% - 13px) 100%, 100% 0, 0 0);
    }
    :global(.adorn-label-icon) {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: #0a2e1c;
    }
    :global(.adorn-label-text) {
      /* `min-width: 0` lets the flex item shrink below its
         min-content size when the label is capped by a max-width;
         without it, text-overflow:ellipsis can't kick in. */
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Wrap any in-tab menu (e.g. BoxelDropdown) in
       `<span class='adorn-label-dropdown'>` so its trigger and the
       portal-origin element it ships count as a single flex item of
       the label. Otherwise the label's natural width grows by one
       flex-gap when the menu opens (the open-state wormhole-origin
       becomes a flex item where the closed-state placeholder was
       display:none), shifting the label on every menu open/close. */
    :global(.adorn-label-dropdown) {
      display: inline-flex;
      align-items: center;
    }
  </style>
</template>;

export default AdornLabel;
