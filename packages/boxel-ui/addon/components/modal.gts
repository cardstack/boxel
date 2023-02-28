import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { eq } from '../helpers/truth-helpers';
import cssVar from '../helpers/css-var';
import cn from '../helpers/cn';
// import onKey from 'ember-keyboard/helpers/on-key';
// import setBodyClass from 'ember-set-body-class/helpers/set-body-class';
import { initStyleSheet, attachStyles } from '../attach-styles';

interface Signature {
  Element: HTMLDialogElement;
  Args: {
    imgURL?: string;
    size?: 'small' | 'medium' | 'large';
    layer?: 'urgent';
    isOpen?: boolean;
    isOverlayDismissalDisabled?: boolean;
    onClose: () => void;
  };
  Blocks: {
    default: [];
  };
}

let modalStyles = initStyleSheet(`
  .boxel-modal {
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

  .boxel-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background-color: rgb(0 0 0 / 75%);
    text-align: left;
    z-index: calc(var(--boxel-modal-z-index) - 1);
  }

  .boxel-modal--small {
    --boxel-modal-max-width: 36.25rem; /* 580px */
  }

  .boxel-modal--medium {
    --boxel-modal-max-width: 43.75rem; /* 700px */
  }

  .boxel-modal--large {
    --boxel-modal-offset-top: var(--boxel-sp-lg);
    --boxel-modal-max-width: 65rem; /* 1040px */
  }

  .boxel-modal__inner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    margin: auto;
    max-width: var(--boxel-modal-max-width, 65rem);
  }
  .boxel-modal__inner > * {
    width: 100%;
    pointer-events: auto;
  }
`);

export default class Modal extends Component<Signature> {
  <template>
    {{#if @isOpen}}
      {{!-- {{setBodyClass "has-modal"}} --}}
      {{!-- {{onKey "Escape" @onClose event="keydown"}} --}}
      <div
        style={{cssVar
          boxel-modal-z-index=(if
            (eq @layer 'urgent')
            'var(--boxel-layer-modal-urgent)'
            'var(--boxel-layer-modal-default)'
          )
        }}
        {{attachStyles modalStyles}}
      >
        <button
          disabled={{@isOverlayDismissalDisabled}}
          type='button'
          {{on 'click' @onClose}}
          class='boxel-modal-overlay'
          tabindex='-1'
        >
          <span class='boxel-sr-only'>Close modal</span>
        </button>

        <dialog
          class={{cn
            'boxel-modal'
            boxel-modal--small=(eq @size 'small')
            boxel-modal--medium=(eq @size 'medium')
            boxel-modal--large=(eq @size 'large')
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
  </template>
}
