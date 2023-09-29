import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { Modal, CardContainer, Header, IconButton } from '@cardstack/boxel-ui';
import IconX from '@cardstack/boxel-ui/icons/icon-x';

interface Signature {
  Element: HTMLElement;
  Args: {
    title: string;
    onClose: () => void;
    zIndex?: number;
    size?: 'small' | 'medium' | 'large';
    centered?: boolean;
  };
  Blocks: {
    content: [];
    header: [];
    footer: [];
  };
}

export default class ModalContainer extends Component<Signature> {
  get size() {
    return this.args.size ?? 'large';
  }

  <template>
    <Modal
      @size={{this.size}}
      @isOpen={{true}}
      @onClose={{@onClose}}
      @centered={{@centered}}
      style={{this.styleString}}
      ...attributes
    >
      <CardContainer class='dialog-box' @displayBoundaries={{true}}>
        <Header @title={{@title}} class='dialog-box__header'>
          <IconButton
            @icon={{IconX}}
            @width='20'
            @height='20'
            {{on 'click' @onClose}}
            class='dialog-box__close'
            aria-label='close modal'
          />
          {{yield to='header'}}
        </Header>
        <div class='dialog-box__content'>
          {{yield to='content'}}
        </div>
        {{#if (has-block 'footer')}}
          <footer class='dialog-box__footer'>
            {{yield to='footer'}}
          </footer>
        {{/if}}
      </CardContainer>
    </Modal>
    <style>
      .dialog-box {
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr auto;
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .dialog-box__header {
        display: grid;
        gap: var(--boxel-sp-sm);
      }

      .dialog-box__content {
        padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
        height: 100%;
        overflow: auto;
      }

      .dialog-box__content > * + * {
        margin-top: var(--boxel-sp);
      }

      .dialog-box__close {
        --icon-color: var(--boxel-dark);
        border: none;
        background: none;
        font: var(--boxel-font-lg);
        position: absolute;
        top: 0;
        right: 0;
        width: 50px;
        height: 50px;
        padding: 0;
      }

      .dialog-box__close:hover {
        --icon-color: var(--boxel-highlight);
      }

      .dialog-box__footer {
        width: 100%;
        height: var(--stack-card-footer-height);
        padding: var(--boxel-sp);
        background-color: var(--boxel-light);
        border-top: 1px solid var(--boxel-300);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }
    </style>
  </template>

  get styleString() {
    return htmlSafe(`z-index: ${this.args.zIndex ?? 20}`);
  }
}
