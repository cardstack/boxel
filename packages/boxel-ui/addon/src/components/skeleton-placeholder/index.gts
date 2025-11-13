import Component from '@glimmer/component';

interface Signature {
  Args: {
    animation?: 'wave' | 'pulse' | 'none';
  };
  Element: HTMLDivElement;
}

export default class SkeletonPlaceholder extends Component<Signature> {
  get animationClass(): string {
    return this.args.animation ?? 'wave';
  }

  <template>
    <div
      class='boxel-skeleton-placeholder {{this.animationClass}}'
      data-test-boxel-skeleton-placeholder
      ...attributes
    />

    <style scoped>
      .boxel-skeleton-placeholder {
        --skeleton-background: var(
          --boxel-skeleton-background,
          var(--boxel-200)
        );
        --skeleton-highlight: var(--boxel-skeleton-highlight, var(--boxel-150));
        --skeleton-width: var(--boxel-skeleton-width, 100%);
        --skeleton-height: var(--boxel-skeleton-height, 1.5em);
        --skeleton-border-radius: var(
          --boxel-skeleton-border-radius,
          var(--boxel-border-radius-sm)
        );
        width: var(--skeleton-width);
        height: var(--skeleton-height);
        border-radius: var(--skeleton-border-radius);
        background-color: var(--skeleton-background);
        position: relative;
        overflow: hidden;
      }

      .wave::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        animation: wave 1.6s linear 0.5s infinite;
        background: linear-gradient(
          90deg,
          transparent,
          var(--skeleton-highlight),
          transparent
        );
        transform: translateX(-100%);
      }

      .pulse {
        animation: pulse 1.5s ease-in-out 0.5s infinite;
      }

      @keyframes wave {
        0% {
          transform: translateX(-200%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      @keyframes pulse {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
        100% {
          opacity: 1;
        }
      }
    </style>
  </template>
}
