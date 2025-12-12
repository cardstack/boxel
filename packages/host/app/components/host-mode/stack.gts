import type { TemplateOnlyComponent } from '@ember/component/template-only';

import HostModeStackItem from './stack-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    stackItemCardIds: string[];
    close?: (cardId: string) => void;
  };
}

const HostModeStack: TemplateOnlyComponent<Signature> = <template>
  <div class='host-mode-stack' ...attributes>
    <div class='inner'>
      {{#each @stackItemCardIds key='cardId' as |cardId index|}}
        <HostModeStackItem
          @cardId={{cardId}}
          @index={{index}}
          @stackItemCardIds={{@stackItemCardIds}}
          @close={{@close}}
        />
      {{/each}}
    </div>
  </div>

  <style scoped>
    .host-mode-stack {
      z-index: 1;
      height: 100%;
      width: 100%;
      background-color: rgba(0, 0, 0, 0.35);
      background-position: center;
      background-size: cover;
      padding-top: var(--boxel-sp-xxl);
      padding-inline: var(--boxel-sp-xxl);
      padding-bottom: var(--boxel-sp-xxl);
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
</template>;

export default HostModeStack;
