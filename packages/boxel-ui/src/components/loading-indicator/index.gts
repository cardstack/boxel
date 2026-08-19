import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cssVar from '../../helpers/css-var.ts';
import LoadingIndicatorIcon from '../../icons/loading-indicator.gts';

interface Signature {
  Args: {
    color?: string;
    size?: string;
  };
  Element: HTMLSpanElement;
}

const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <span
    class='boxel-loading-indicator'
    style={{cssVar
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
