import { concat } from '@ember/helper';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import cn from '../../helpers/cn.ts';

export type RealmDisplayInfo = {
  iconURL: string | null;
  isIndexing?: boolean;
  name: string;
};
interface Signature {
  Args: {
    canAnimate?: boolean;
    realmInfo: RealmDisplayInfo;
  };
  Element: HTMLElement;
}

const setBackgroundImage = modifier(
  (element: HTMLElement, [url]: [string | null]) => {
    if (url) {
      element.style.backgroundImage = `url(${url})`;
    }
  },
);

export default class RealmIcon extends Component<Signature> {
  private get showAnimation() {
    return this.args.canAnimate && this.args.realmInfo?.isIndexing;
  }
  <template>
    <div
      role='img'
      aria-label={{if
        this.showAnimation
        (concat 'indexing ' @realmInfo.name)
        @realmInfo.name
      }}
      class={{cn
        'realm-icon-img'
        can-animate=@canAnimate
        indexing=this.showAnimation
      }}
      data-test-realm-indexing-indicator={{this.showAnimation}}
      data-test-realm-icon-url={{@realmInfo.iconURL}}
      {{! hide this from percy since it might be animating !}}
      data-test-percy-hide={{@canAnimate}}
      {{setBackgroundImage @realmInfo.iconURL}}
      ...attributes
    />

    <style scoped>
      @layer {
        .realm-icon-img {
          --border-radius: var(
            --boxel-realm-icon-border-radius,
            var(--boxel-border-radius-xs)
          );
          width: var(--boxel-realm-icon-size, var(--boxel-icon-sm));
          height: var(--boxel-realm-icon-size, var(--boxel-icon-sm));
          background-size: contain;
          background-position: center;
          background-repeat: no-repeat;
          background-clip: padding-box;
          background-color: var(
            --boxel-realm-icon-background-color,
            transparent
          );
          border-radius: var(--border-radius);
          flex-shrink: 0;
        }
        .can-animate {
          --border-width: var(--boxel-realm-icon-border-width, 1px);
          border-width: var(--border-width);
          border-style: var(--boxel-realm-icon-border-style, solid);
          border-color: var(--boxel-realm-icon-border-color, transparent);
        }
        .can-animate::after {
          content: '';
          background-color: var(--boxel-dark);
          opacity: 0;
          display: block;
          height: 100%;
          border-radius: calc(var(--border-radius) - var(--border-width));
        }
        .indexing {
          animation: pulse-border 2.5s linear infinite;
        }
        .indexing::after {
          animation: pulse-icon 2.5s linear infinite;
        }
        @keyframes pulse-border {
          0%,
          10% {
            border-color: var(--boxel-highlight);
          }
          40% {
            border-color: var(--boxel-light);
          }
          100% {
            border-color: var(--boxel-highlight);
          }
        }
        @keyframes pulse-icon {
          0%,
          10% {
            opacity: 0;
            background-color: var(--boxel-dark);
          }
          40% {
            opacity: 0.7;
            background-color: var(--boxel-dark);
          }
          60%,
          70% {
            opacity: 0.7;
            background-color: var(--boxel-light);
          }
          100% {
            opacity: 0;
            background-color: var(--boxel-light);
          }
        }
      }
    </style>
  </template>
}
