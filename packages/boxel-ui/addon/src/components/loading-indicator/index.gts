import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cssVar from '../../helpers/css-var.ts';
import LoadingIndicatorIcon from '../../icons/loading-indicator.gts';

interface Signature {
  Args: {
    color?: string;
  };
  Element: HTMLDivElement;
}

const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <div
    class='boxel-loading-indicator'
    data-test-loading-indicator
    ...attributes
  >
    <LoadingIndicatorIcon
      style={{cssVar icon-color=(if @color @color '#000')}}
      role='presentation'
    />
  </div>
  <style scoped>
    /* zero specificity default sizing */
    :where(.boxel-loading-indicator) {
      --loading-indicator-size: var(
        --boxel-loading-indicator-size,
        var(--boxel-icon-sm)
      );
      width: var(--loading-indicator-size);
      height: var(--loading-indicator-size);
      flex-shrink: 0;
    }

    /*
      Only animate if the user has not said that they want reduced motion
    */
    @media (prefers-reduced-motion: no-preference) {
      .boxel-loading-indicator :deep(svg) {
        animation: spin 6000ms linear infinite;
        width: var(--loading-indicator-size);
        height: var(--loading-indicator-size);
      }
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</template>;

export default LoadingIndicator;
