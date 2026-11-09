import type { TemplateOnlyComponent } from '@ember/component/template-only';

import LoadingIndicatorIcon from '../../icons/loading-indicator.gts';
import setCssVar from '../../modifiers/set-css-var.ts';

interface Signature {
  Args: {
    color?: string;
    size?: string;
  };
  Element: HTMLSpanElement;
}

// The color and size are written through the CSSOM (`setCssVar`) rather than
// a bound `style` attribute, so the indicator renders under a Content Security
// Policy that refuses inline style, such as the secure origin's.
const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <span
    class='boxel-loading-indicator'
    {{setCssVar
      icon-color=(if @color @color 'var(--loading-indicator-color)')
      boxel-loading-indicator-size=@size
    }}
    data-test-loading-indicator
    ...attributes
  >
    <LoadingIndicatorIcon role='presentation' />
  </span>
  <style scoped>
    /* zero specificity default sizing */
    :where(.boxel-loading-indicator) {
      --loading-indicator-size: var(
        --boxel-loading-indicator-size,
        var(--boxel-icon-sm)
      );
      --loading-indicator-color: var(
        --boxel-loading-indicator-color,
        currentColor
      );
      display: inline-block;
      width: var(--loading-indicator-size);
      height: var(--loading-indicator-size);
      flex-shrink: 0;
    }

    .boxel-loading-indicator :deep(svg) {
      display: block;
      width: var(--loading-indicator-size);
      height: var(--loading-indicator-size);
    }

    /* Only animate if the user has not said that they want reduced motion */
    @media (prefers-reduced-motion: no-preference) {
      .boxel-loading-indicator :deep(svg) {
        animation: var(--boxel-infinite-spin-animation);
      }
    }
  </style>
</template>;

export default LoadingIndicator;
