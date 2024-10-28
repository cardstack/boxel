import Component from '@glimmer/component';

import { sanitizeHtml } from '@cardstack/runtime-common';

import { type SafeString, htmlSafe } from '@ember/template';
import { type EnhancedRealmInfo } from '@cardstack/host/services/realm';

interface Signature {
  Args: {
    realmInfo: EnhancedRealmInfo;
    canAnimate?: boolean;
    style?: SafeString; // setting style as an arg so splattributes don't collide with our own style tag
  };
  Element: HTMLElement;
}

export default class RealmIcon extends Component<Signature> {
  private get showAnimation() {
    return this.args.canAnimate && this.args.realmInfo.isIndexing;
  }
  private get style() {
    return htmlSafe(
      sanitizeHtml(
        `${
          this.args.realmInfo.iconURL
            ? 'background-image: url("' + this.args.realmInfo.iconURL + '");'
            : ''
        } ${this.args.style ?? ''}`.trim(),
      ),
    );
  }
  <template>
    <div
      style={{this.style}}
      alt='Icon for workspace {{@realmInfo.name}}'
      class='realm-icon-img {{if this.showAnimation "indexing"}}'
      data-test-realm-indexing-indicator={{this.showAnimation}}
      data-test-realm-icon-url={{@realmInfo.iconURL}}
      {{! hide this from percy since it might be animating !}}
      data-test-percy-hide={{@canAnimate}}
      ...attributes
    />

    <style scoped>
      .realm-icon-img::after {
        content: '';
        background-color: black;
        opacity: 0;
        display: block;
        height: 100%;
        border-radius: 6px;
      }
      .realm-icon-img {
        background-size: contain;
        height: 100%;
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
