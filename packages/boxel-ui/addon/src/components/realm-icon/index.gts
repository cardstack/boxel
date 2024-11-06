import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

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
    return this.args.canAnimate && this.args.realmInfo.isIndexing;
  }
  <template>
    <div
      alt={{@realmInfo.name}}
      class='realm-icon-img {{if this.showAnimation "indexing"}}'
      data-test-realm-indexing-indicator={{this.showAnimation}}
      data-test-realm-icon-url={{@realmInfo.iconURL}}
      {{! hide this from percy since it might be animating !}}
      data-test-percy-hide={{@canAnimate}}
      {{setBackgroundImage @realmInfo.iconURL}}
      ...attributes
    />

    <style scoped>
      .realm-icon-img {
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
        border-radius: var(--boxel-realm-icon-border-radius, 0);
        background-color: var(--boxel-realm-icon-background-color, transparent);
        border: var(--boxel-realm-icon-border, 1px solid transparent);
      }
      .realm-icon-img::after {
        content: '';
        background-color: var(--boxel-dark);
        opacity: 0;
        display: block;
        height: 100%;
        border-radius: 6px;
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
          background-color: black;
        }
        40% {
          opacity: 0.7;
          background-color: black;
        }
        60%,
        70% {
          opacity: 0.7;
          background-color: white;
        }
        100% {
          opacity: 0;
          background-color: black;
        }
      }
    </style>
  </template>
}
