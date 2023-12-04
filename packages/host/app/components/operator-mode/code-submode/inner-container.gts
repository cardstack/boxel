import Component from '@glimmer/component';

import type { ComponentLike } from '@glint/template';

interface ContentSignature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

class InnerContainerContent extends Component<ContentSignature> {
  <template>
    <section class='inner-container__content' ...attributes>
      {{yield}}
    </section>
    <style>
      .inner-container__content {
        position: relative;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
        height: 100%;
      }
    </style>
  </template>
}
interface HeaderSignature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

class InnerContainerHeader extends Component<HeaderSignature> {
  <template>
    <header class='inner-container__header' ...attributes>
      {{yield}}
    </header>
    <style>
      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}

interface Signature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: {
    default: [ComponentLike<ContentSignature>, ComponentLike<HeaderSignature>];
  };
}

export default class CodeSubmodeInnerContainer extends Component<Signature> {
  <template>
    <div class='inner-container' ...attributes>
      {{yield
        (component InnerContainerContent)
        (component InnerContainerHeader)
      }}
    </div>
    <style>
      .inner-container {
        height: 100%;
        position: relative;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: hidden;
      }
    </style>
  </template>
}
