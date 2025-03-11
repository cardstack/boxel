import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import {
  CardContainer,
  Header,
  IconButton,
  Modal,
} from '@cardstack/boxel-ui/components';

import { IconX } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLElement;
  Args: {
    title: string;
    onClose: () => void;
    size?: 'small' | 'medium' | 'large';
    centered?: boolean;
    cardContainerClass?: string;
    isOpen?: boolean;
    layer?: 'urgent';
  };
  Blocks: {
    content: [];
    header: [];
    footer: [];
    sidebar: [];
  };
}

export default class ModalContainer extends Component<Signature> {
  get size() {
    return this.args.size ?? 'large';
  }
  get isOpen() {
    return this.args.isOpen ?? true;
  }

  <template>
    <Modal
      @size={{this.size}}
      @isOpen={{this.isOpen}}
      @onClose={{@onClose}}
      @centered={{@centered}}
      @layer={{@layer}}
      ...attributes
    >
      <CardContainer
        class='dialog-box
          {{@cardContainerClass}}
          {{if (has-block "sidebar") "dialog-box--with-sidebar"}}'
        @displayBoundaries={{true}}
      >
        {{#if (has-block 'sidebar')}}
          <section class='dialog-box__sidebar-header'></section>
          <aside class='dialog-box__sidebar'>
            {{yield to='sidebar'}}
          </aside>
        {{/if}}
        <Header @size='large' @title={{@title}} class='dialog-box__header'>
          <IconButton
            @icon={{IconX}}
            @width='12'
            @height='12'
            {{on 'click' @onClose}}
            class='dialog-box__close'
            aria-label='close modal'
            data-test-close-modal
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
    <style scoped>
      .dialog-box {
        height: 100%;
        display: grid;
        grid-template-areas:
          'header'
          'content'
          'footer';
        grid-template-rows: auto 1fr auto;
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .dialog-box--with-sidebar {
        grid-template-areas:
          'sidebar-header header'
          'sidebar content'
          'sidebar footer';
        grid-template-columns: 300px 1fr;
      }

      .dialog-box__sidebar-header {
        grid-area: sidebar-header;
        background-color: var(--boxel-100);
        border-top-left-radius: var(--boxel-border-radius);
      }

      .dialog-box__sidebar {
        grid-area: sidebar;
        background-color: var(--boxel-100);

        border-bottom-left-radius: var(--boxel-border-radius);
      }

      .dialog-box__header {
        display: grid;
        grid-area: header;
        gap: var(--boxel-sp-sm);
      }

      .dialog-box__content {
        grid-area: content;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xl) var(--boxel-sp-xl);
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
        top: 1px;
        right: 1px;
        width: 50px;
        height: 50px;
        border-top-right-radius: calc(var(--boxel-border-radius) - 1px);
      }

      .dialog-box__close:hover {
        --icon-color: var(--boxel-highlight);
      }

      .dialog-box__footer {
        grid-area: footer;
        width: 100%;
        height: var(--stack-card-footer-height);
        padding: var(--boxel-sp);
        background-color: var(--boxel-light);
        border-top: 1px solid var(--boxel-300);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
        display: flex;
      }
    </style>
  </template>
}
