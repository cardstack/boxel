// Pretui — Skeleton: a placeholder shape shown while content loads.
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

export interface SkeletonSignature {
  Args: { width?: string; height?: string };
  Element: HTMLSpanElement;
}

export class Skeleton extends Component<SkeletonSignature> {
  get style() {
    return cssStyleFrom([
      cssDeclaration('--_w', this.args.width ?? '100%'),
      cssDeclaration('--_h', this.args.height ?? '12px'),
    ]);
  }
  <template>
    <span class='pretui-skeleton' style={{this.style}} aria-hidden='true' data-test-pretui-skeleton ...attributes></span>
    <style scoped>
      @keyframes pretui-shimmer {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
      .pretui-skeleton {
        display: block;
        width: var(--_w, 100%);
        height: var(--_h, 12px);
        border-radius: 6px;
        background: linear-gradient(90deg, var(--inset, var(--boxel-100)) 40%, var(--hover, var(--boxel-100)) 50%, var(--inset, var(--boxel-100)) 60%);
        background-size: 200% 100%;
        animation: pretui-shimmer 1.6s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-skeleton {
          animation: none;
        }
      }
    </style>
  </template>
}
