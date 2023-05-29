import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { eq } from '../../helpers/truth-helpers';
import cssVar from '../../helpers/css-var';
import cn from '../../helpers/cn';
import setBodyClass from 'ember-set-body-class/helpers/set-body-class';

interface Signature {
  Element: HTMLDialogElement;
  Args: {
    imgURL?: string;
    size?: 'small' | 'medium' | 'large';
    layer?: 'urgent';
    isOpen?: boolean;
    isOverlayDismissalDisabled?: boolean;
    onClose: () => void;
    boxelModalOverlayColor?: string;
  };
  Blocks: {
    default: [];
  };
}

export default class Modal extends Component<Signature> {
  <template>
    {{#if @isOpen}}
      {{setBodyClass 'has-modal'}}
      <div
        style={{cssVar
          boxel-modal-z-index=(if
            (eq @layer 'urgent')
            'var(--boxel-layer-modal-urgent)'
            'var(--boxel-layer-modal-default)'
          )
        }}
      >
        <button
          disabled={{@isOverlayDismissalDisabled}}
          type='button'
          {{on 'click' @onClose}}
          class='overlay'
          style={{cssVar boxel-modal-overlay-color=@boxelModalOverlayColor}}
          tabindex='-1'
        >
          <span class='boxel-sr-only'>Close modal</span>
        </button>

        <dialog
          class={{cn
            small=(eq @size 'small')
            medium=(eq @size 'medium')
            large=(eq @size 'large')
          }}
          open={{@isOpen}}
          aria-modal='true'
          ...attributes
        >
          <div class='boxel-modal__inner'>
            {{yield}}
          </div>
        </dialog>
      </div>
    {{/if}}
    <style>
      dialog {
        /* Unit is required to be used on calc */
        --boxel-modal-offset-top: 0px;
        --boxel-modal-offset-left: 0px;
        --boxel-modal-offset-right: 0px;

        position: fixed;
        width: 100%;
        height: calc(100vh - var(--boxel-modal-offset-top));
        top: var(--boxel-modal-offset-top);
        left: var(--boxel-modal-offset-left);
        right: var(--boxel-modal-offset-right);
        padding: 0 var(--boxel-sp);
        background: none;
        border: none;
        overflow: hidden;
        z-index: var(--boxel-modal-z-index);
        pointer-events: none;
      }

      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        padding: 0;
        border: none;
        background-color: var(--boxel-modal-overlay-color, rgb(0 0 0 / 75%));
        text-align: left;
        z-index: calc(var(--boxel-modal-z-index) - 1);
      }

      .small {
        --boxel-modal-max-width: 36.25rem; /* 580px */
      }

      .medium {
        --boxel-modal-max-width: 43.75rem; /* 700px */
      }

      .large {
        --boxel-modal-offset-top: var(--boxel-sp-lg);
        --boxel-modal-max-width: 65rem; /* 1040px */
      }

      :global(.boxel-modal__inner) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        margin: auto;
        max-width: var(--boxel-modal-max-width, 65rem);
      }

      :global(.boxel-modal__inner > *) {
        width: 100%;
        pointer-events: auto;
      }
    </style>
  </template>
}
