import Component from '@glimmer/component';

import HostModeStackItem from './host-mode-stack-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardIds: string[];
    close?: (cardId: string) => void;
  };
}

export default class HostModeStack extends Component<Signature> {
  get stackItems() {
    return this.args.cardIds.slice(1, this.args.cardIds.length);
  }

  <template>
    <div class='host-mode-stack' ...attributes>
      <div class='inner'>
        {{#each this.stackItems as |cardId index|}}
          <HostModeStackItem
            @cardId={{cardId}}
            @index={{index}}
            @stackItems={{this.stackItems}}
            @close={{@close}}
          />
        {{/each}}
      </div>
    </div>

    <style scoped>
      :global(:root) {
        --host-mode-stack-padding-top: var(--boxel-sp-xxl);
        --host-mode-stack-padding-bottom: var(--boxel-sp-xxl);
        --host-mode-stack-padding-inline: var(--boxel-sp-xxl);
      }

      .host-mode-stack {
        z-index: 0;
        height: 100%;
        width: 100%;
        background-color: rgba(0, 0, 0, 0.35);
        background-position: center;
        background-size: cover;
        padding-top: var(--host-mode-stack-padding-top);
        padding-inline: var(--host-mode-stack-padding-inline);
        padding-bottom: var(--host-mode-stack-padding-bottom);
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        transition: padding-top var(--boxel-transition);
      }

      .inner {
        height: 100%;
        position: relative;
        display: flex;
        justify-content: center;
        margin: 0 auto;
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
