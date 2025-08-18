import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';

import cssVar from '../../helpers/css-var.ts';
import LoadingIndicatorIcon from '../../icons/loading-indicator.gts';

interface Signature {
  Args: {
    color?: string;
    variant?: 'primary' | 'secondary' | 'muted' | 'destructive' | 'default';
  };
  Element: HTMLSpanElement;
}

const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <span
    class='boxel-loading-indicator
      {{if @variant (concat "variant-" @variant) "variant-default"}}'
    data-test-loading-indicator
    ...attributes
  >
    <LoadingIndicatorIcon
      style={{cssVar
        icon-color=(if @color @color 'var(--loading-indicator-color)')
      }}
      role='presentation'
    />
  </span>
  <style scoped>
    /* zero specificity default sizing */
    :where(.boxel-loading-indicator) {
      --loading-indicator-size: var(
        --boxel-loading-indicator-size,
        var(--boxel-icon-sm)
      );
      display: inline-block;
      width: var(--loading-indicator-size);
      height: var(--loading-indicator-size);
      flex-shrink: 0;
    }

    .variant-default {
      --loading-indicator-color: var(--foreground);
    }

    .variant-primary {
      --loading-indicator-color: var(--primary-foreground);
    }

    .variant-secondary {
      --loading-indicator-color: var(--secondary-foreground);
    }

    .variant-muted {
      --loading-indicator-color: var(--muted-foreground);
    }

    .variant-destructive {
      --loading-indicator-color: var(--destructive-foreground);
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
