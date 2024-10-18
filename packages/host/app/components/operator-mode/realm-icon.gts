import Component from '@glimmer/component';

import { type EnhancedRealmInfo } from '@cardstack/host/services/realm';

interface Signature {
  Args: {
    realmInfo: EnhancedRealmInfo;
    canAnimate?: boolean;
  };
  Element: HTMLElement;
}

export default class RealmIcon extends Component<Signature> {
  private get showAnimation() {
    return this.args.canAnimate && this.args.realmInfo.isIndexing;
  }
  <template>
    <img
      src={{@realmInfo.iconURL}}
      alt='Icon for workspace {{@realmInfo.name}}'
      class='realm-icon {{if this.showAnimation "indexing"}}'
      data-test-realm-indexing-indicator={{this.showAnimation}}
      data-test-realm-icon-url={{@realmInfo.iconURL}}
      ...attributes
    />

    <style scoped>
      .indexing {
        animation: pulse 0.75s ease infinite;
      }
      @keyframes pulse {
        0% {
          border-color: var(--boxel-light);
        }
        50% {
          border-color: var(--boxel-highlight);
        }
        100% {
          border-color: var(--boxel-light);
        }
      }
    </style>
  </template>
}
