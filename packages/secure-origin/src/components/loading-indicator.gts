// boxel-ui's LoadingIndicator, with its icon's path copied in. boxel-ui
// takes `@color` and `@size` and binds them to a `style` attribute, which the
// page's policy refuses. Here a caller sets them from a scoped rule of its
// own on the indicator: `--boxel-loading-indicator-color` (or
// `--loading-indicator-color`) for the colour, and
// `--boxel-loading-indicator-size` for the size.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLSpanElement;
}

const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <span
    class='boxel-loading-indicator'
    data-test-loading-indicator
    ...attributes
  >
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='15.5'
      height='15.5'
      viewBox='0 0 15.5 15.5'
      role='presentation'
    ><g
        fill='none'
        stroke-linecap='round'
        stroke-linejoin='round'
        stroke-width='1.5'
      ><path
          d='M7.75.75v2.8M7.75 11.95v2.8M2.801 2.801l1.981 1.981M10.718 10.718l1.981 1.981M.75 7.75h2.8M11.95 7.75h2.8M2.801 12.699l1.981-1.981M10.718 4.782l1.981-1.981'
        /></g></svg>
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
      --icon-color: var(--loading-indicator-color);
      display: inline-block;
      width: var(--loading-indicator-size);
      height: var(--loading-indicator-size);
      flex-shrink: 0;
    }

    svg {
      display: block;
      width: var(--loading-indicator-size);
      height: var(--loading-indicator-size);
    }

    g {
      stroke: var(--icon-color, currentColor);
    }

    /* Only animate if the user has not said that they want reduced motion */
    @media (prefers-reduced-motion: no-preference) {
      svg {
        animation: var(--boxel-infinite-spin-animation);
      }
    }

    @keyframes boxel-spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</template>;

export default LoadingIndicator;
